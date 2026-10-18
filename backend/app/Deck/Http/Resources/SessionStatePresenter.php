<?php

namespace App\Deck\Http\Resources;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Deck\Broadcasts\DeckChannels;
use App\Deck\Broadcasts\Payloads\ParticipantCountUpdatedPayload;
use App\Deck\Broadcasts\Payloads\SlideStateChangedPayload;
use App\Deck\Sessions\QuizRuntime;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quiz\AbstractQuizType;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Services\Live\LiveAggregateService;

/**
 * Live session views (snake_case, like the broadcast payloads):
 *
 * - lookup(): GET by-code. Public, so only what a join page needs.
 * - host(): GET state as the host, and the body of start / advance / end.
 *   Owner only: every run, the current run's presenter view WITH the live
 *   aggregate, participant count and join info.
 * - participant(): GET state with X-Participant-Token (or the
 *   participant-state alias). The current run's participant view for this
 *   participant (never an aggregate or answer key inside it; quiz runs in
 *   their own keyed option order, `options: []` + `options_hidden: true`
 *   until voting, AbstractQuizType::serializeForViewer) as `current_run`
 *   and, under the plan §7.6 name, `current_slide_run`; the participant's
 *   own answer to it as `my_submission_for_current_slide` (null when none);
 *   `aggregate` only when LiveAggregateService::resultsVisibility() says
 *   public.
 *
 * Timer fields (seconds_remaining, ends_at, duration_seconds) are derived
 * like slide.state.changed and are null for untimed states; clients count
 * down from ends_at corrected by server_time.
 *
 * Quiz sessions add `quiz` to both views: {submitted_count (answers on the
 * current run by participants still in the room), spin (spinner result
 * {option_id, target_angle} or null), leaderboard (top N when the current
 * run is a leaderboard slide, else null)}; the participant view's `quiz`
 * also has participant_count (participants in the room, left_at null; the
 * host view has it top-level), plus `standing` {participant_id, total_points,
 * rank, points_delta}. Totals only move when a run is revealed, so standing
 * and leaderboards never change while a run takes answers. Before a quiz run is revealed a participant still never sees
 * its aggregate or correct answer; afterwards `aggregate` is the public
 * reveal aggregate and `my_submission_for_current_slide` carries
 * correctness (myAnswer()).
 */
class SessionStatePresenter
{
    /** Frontend route of the participant join page (/play/[code]; /join stays the legacy v1 page). */
    public const JOIN_PATH = '/play/';

    /** @return array{session_id:int, join_code:string, product:?string, deck_title:?string, status:string, public_channel_key:string} */
    public static function lookup(DeckSession $session): array
    {
        $session->loadMissing('deck');

        return [
            'session_id' => (int) $session->id,
            'join_code' => $session->join_code,
            'product' => $session->deck?->product,
            'deck_title' => $session->deck?->title,
            'status' => $session->status,
            'public_channel_key' => $session->public_channel_key,
        ];
    }

    public static function host(DeckSession $session): array
    {
        $session->loadMissing('deck');
        $runs = $session->runs()->get()->each(fn (DeckSessionSlideRun $run) => $run->setRelation('session', $session));
        $current = $runs->firstWhere('id', $session->current_slide_run_id);
        $channels = app(DeckChannels::class);

        return [
            'session_id' => (int) $session->id,
            'join_code' => $session->join_code,
            'public_channel_key' => $session->public_channel_key,
            'session' => self::session($session, $runs->count()),
            'join' => [
                'join_code' => $session->join_code,
                'join_url' => self::joinUrl($session->join_code),
                'public_channel_key' => $session->public_channel_key,
            ],
            'channels' => [
                'public' => $channels->publicChannel($session),
                'host' => $channels->hostChannel($session),
            ],
            'participant_count' => ParticipantCountUpdatedPayload::countFor($session),
            // The host's run list keeps quiz options in every state (they are only hidden from phones).
            'runs' => $runs->map(fn (DeckSessionSlideRun $run) => self::participantRun($run, null, false))->values()->all(),
            'current_run' => $current ? self::presenterRun($current) : null,
            'results_visibility' => $current ? self::visibility($current) : null,
            ...self::timer($current),
            ...self::quiz($session, $current),
            'server_time' => now()->toISOString(),
        ];
    }

    public static function participant(DeckSession $session, DeckParticipant $participant): array
    {
        $session->loadMissing('deck');
        $current = $session->current_slide_run_id === null ? null : DeckSessionSlideRun::query()
            ->where('deck_session_id', $session->id)
            ->find($session->current_slide_run_id);
        $current?->setRelation('session', $session);

        $visibility = $current ? self::visibility($current) : null;
        $currentRun = $current ? self::participantRun($current, $participant) : null;
        $answer = $current === null ? null : DeckParticipantAnswer::query()
            ->where('deck_participant_id', $participant->id)
            ->where('slide_run_id', $current->id)
            ->first();

        return [
            'session_id' => (int) $session->id,
            'session' => self::session($session, $session->runs()->count()) + [
                'public_channel_key' => $session->public_channel_key,
            ],
            'participant' => [
                'id' => (int) $participant->id,
                'display_name' => $participant->display_name,
                'emoji_avatar' => $participant->emoji_avatar,
            ],
            'current_run' => $currentRun,
            'current_slide_run' => $currentRun,
            'has_answered' => $answer !== null,
            'my_submission_for_current_slide' => $answer ? self::myAnswer($answer, $current, $participant) : null,
            'results_visibility' => $visibility,
            // Same rule as the aggregate broadcasts: hidden results never reach participants.
            'aggregate' => $visibility === BroadcastPayload::VISIBILITY_PUBLIC ? self::publicAggregate($current) : null,
            ...self::timer($current),
            ...self::quiz($session, $current, $participant),
            'server_time' => now()->toISOString(),
        ];
    }

    /**
     * GET .../my-answer for $participant's $answer on $run: submission(),
     * plus {is_correct, points_awarded, correct_answer, total_points, rank}
     * once a scored quiz run is revealed (never before).
     */
    public static function myAnswer(DeckParticipantAnswer $answer, DeckSessionSlideRun $run, DeckParticipant $participant): array
    {
        $quiz = app(QuizRuntime::class);

        return self::submission($answer) + ($quiz->showsCorrectness($run) ? $quiz->answerExtras($answer, $run, $participant) : []);
    }

    /** The aggregate participants may see (visibility public): revealed quiz runs come from the reveal cache. */
    private static function publicAggregate(DeckSessionSlideRun $run): array
    {
        return $run->isRevealed() ? app(QuizRuntime::class)->aggregate($run) : app(SlideTypeRegistry::class)->aggregate($run);
    }

    /** Quiz-only state keys (see the class docblock); [] for other products. */
    private static function quiz(DeckSession $session, ?DeckSessionSlideRun $current, ?DeckParticipant $participant = null): array
    {
        if ($session->deck?->product !== Deck::PRODUCT_QUIZ) {
            return [];
        }

        $quiz = app(QuizRuntime::class);
        $block = [
            'submitted_count' => $current ? ParticipantCountUpdatedPayload::answeredCountFor($current) : 0,
            'spin' => $current ? QuizRuntime::spinResult($current) : null,
            'leaderboard' => $current && $quiz->isLeaderboard($current)
                ? $quiz->leaderboard($session, $quiz->leaderboardSize($current))
                : null,
        ];

        if (! $participant) {
            return ['quiz' => $block];
        }

        // Phones rebuild "x / y answered" and the lobby count from here after a reload.
        $block['participant_count'] = ParticipantCountUpdatedPayload::countFor($session);

        return ['quiz' => $block, 'standing' => $quiz->standing($session, $participant)];
    }

    /**
     * The run as participants see it (SlideTypeContract::serializeForParticipant;
     * no aggregate, no answer keys). Quiz types (AbstractQuizType) serialise
     * for $participant (their own keyed option order; null = the run-level
     * order public broadcasts carry) and hide the options until voting
     * unless $hideUntilVoting is false (host run list, post-session review).
     */
    public static function participantRun(DeckSessionSlideRun $run, ?DeckParticipant $participant = null, bool $hideUntilVoting = true): array
    {
        $registry = app(SlideTypeRegistry::class);

        if ($registry->has((string) $run->type_snapshot)) {
            $type = $registry->for($run->type_snapshot);

            return $type instanceof AbstractQuizType
                ? $type->serializeForViewer($run, $participant ? (int) $participant->id : null, $hideUntilVoting)
                : $type->serializeForParticipant($run);
        }

        // A type the registry no longer knows: identity and state only, no config.
        return [
            'id' => (int) $run->id,
            'slide_id' => $run->slide_id,
            'type' => $run->type_snapshot,
            'category' => null,
            'reveal_model' => null,
            'accepts_answers' => false,
            'position' => (int) $run->position_snapshot,
            'title' => $run->title_snapshot,
            'state' => $run->state,
            'state_version' => (int) $run->state_version,
        ];
    }

    /** The run as the presenter sees it: participant view + the live `aggregate`. Host only. */
    public static function presenterRun(DeckSessionSlideRun $run): array
    {
        $registry = app(SlideTypeRegistry::class);

        if (! $registry->has((string) $run->type_snapshot)) {
            return self::participantRun($run) + ['aggregate' => []];
        }

        return $registry->for($run->type_snapshot)->serializeForPresenter($run, $registry->aggregate($run));
    }

    /** The participant's own answer, shaped like GET .../slide-runs/{run}/my-answer. */
    public static function submission(DeckParticipantAnswer $answer): array
    {
        return [
            'slide_run_id' => (int) $answer->slide_run_id,
            'answer_payload' => ($answer->answer_payload ?? []) === [] ? (object) [] : $answer->answer_payload,
            'time_to_answer_ms' => $answer->time_to_answer_ms,
            'submitted_at' => $answer->submitted_at?->toISOString(),
        ];
    }

    public static function joinUrl(string $joinCode): string
    {
        $base = (string) (config('app.frontend_url') ?: env('NEXT_PUBLIC_APP_URL', ''));

        return rtrim($base, '/') . self::JOIN_PATH . rawurlencode($joinCode);
    }

    private static function session(DeckSession $session, int $totalSlides): array
    {
        return [
            'id' => (int) $session->id,
            'deck_id' => (int) $session->deck_id,
            'product' => $session->deck?->product,
            'deck_title' => $session->deck?->title,
            // Live deck setting (not snapshotted), so phones match the host's palette.
            'theme' => self::theme($session),
            'status' => $session->status,
            'current_slide_run_id' => $session->current_slide_run_id,
            'total_slides' => $totalSlides,
            'started_at' => $session->started_at?->toISOString(),
            'ended_at' => $session->ended_at?->toISOString(),
        ];
    }

    /** Deck colour preset (settings.theme), 'default' when unset. */
    public static function theme(DeckSession $session): string
    {
        $theme = $session->deck?->settings['theme'] ?? null;

        return is_string($theme) && $theme !== '' ? $theme : 'default';
    }

    private static function visibility(DeckSessionSlideRun $run): string
    {
        return app(SlideTypeRegistry::class)->has((string) $run->type_snapshot)
            ? app(LiveAggregateService::class)->resultsVisibility($run)
            : BroadcastPayload::VISIBILITY_HOST;
    }

    /** @return array{seconds_remaining:?int, ends_at:?string, duration_seconds:?int} */
    private static function timer(?DeckSessionSlideRun $run): array
    {
        if (! $run) {
            return ['seconds_remaining' => null, 'ends_at' => null, 'duration_seconds' => null];
        }

        $state = SlideStateChangedPayload::fromRun($run)->toArray();

        return [
            'seconds_remaining' => $state['seconds_remaining'],
            'ends_at' => $state['ends_at'],
            'duration_seconds' => $state['duration_seconds'],
        ];
    }
}
