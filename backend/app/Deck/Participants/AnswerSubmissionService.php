<?php

namespace App\Deck\Participants;

use App\Deck\Broadcasts\DeckBroadcaster;
use App\Deck\Broadcasts\Payloads\AnswerSubmittedPayload;
use App\Deck\Exceptions\DeckException;
use App\Deck\Http\DeckValidation;
use App\Deck\Sessions\QuizRuntime;
use App\Deck\Sessions\SessionStateMachine;
use App\Deck\Slides\AppendsSubmissions;
use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Deck\Broadcasts\LiveAggregateService;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * POST /slide-runs/{run}/answers (plan §3.3 + the AppendsSubmissions flow).
 *
 * 1. The run's type must accept answers and be offered by the session's product.
 * 2. The session must be live, the run its current run, and the run `voting`
 *    (409 invalid_state otherwise; checked again under the run's row lock).
 * 3. validateAnswer() against config_snapshot + options_snapshot; errors come
 *    back keyed `answer_payload.*` (422).
 * 4. One transaction: the run row is locked FOR SHARE (a host close/advance,
 *    which UPDATEs it, waits for in-flight answers, and an answer arriving
 *    after a close sees `closed`), then INSERT ... ON CONFLICT DO NOTHING on
 *    unique(deck_participant_id, slide_run_id). When a row already exists it
 *    is locked FOR UPDATE and merged (AppendsSubmissions) or replaced, so two
 *    racing submissions never drop an entry.
 * 5. After the commit: LiveAggregateService::schedule($run) and a host-only
 *    `answer.submitted` (total_responses counted after the commit) whose
 *    `answer` is this submission only, cut to fit a Reverb publish
 *    (AnswerBroadcastPreview); the stored row may hold several appended ones.
 *
 * Quiz sessions (QuizRuntime::scores): answers are final. A participant's
 * first answer is scored in the same transaction (ScoringService, from
 * config_snapshot.scoring and the time since voting opened) into
 * is_correct / points_awarded; a second one is 409 invalid_state with
 * data.reason already_answered (checked before validation and again by the
 * unique row under the run lock), and the first answer and its points stay.
 * deck_participants.total_points is NOT touched here: the reveal adds the
 * run's points (QuizRuntime::applyRevealedPoints), so nothing a player can
 * read during voting (standing, leaderboard) depends on correctness. After
 * the commit, SessionStateMachine::revealIfAllAnswered() reveals the run
 * once every participant still in the room has answered. The response
 * stays 204: correctness is only shown after the reveal (my-answer). Quest
 * is never scored and keeps replacing / merging re-submissions.
 *
 * An answer from a participant who had left (POST .../participants/leave)
 * brings them back into the room (ParticipantPresence::returned).
 */
class AnswerSubmissionService
{
    /** Insert-or-lock rounds before giving up (a conflicting row that vanished, e.g. its participant was deleted). */
    public const MAX_ATTEMPTS = 3;

    /** Answers this long after a timed slide's deadline still count (network latency). */
    public const DEADLINE_GRACE_MS = 1000;

    /** time_to_answer_ms is an `integer` column. */
    private const MAX_TIME_MS = 2_147_483_647;

    public function __construct(
        private readonly SlideTypeRegistry $registry,
        private readonly LiveAggregateService $aggregates,
        private readonly DeckBroadcaster $broadcaster,
    ) {}

    /**
     * @param  DeckSessionSlideRun  $run  a run of $session
     *
     * @throws DeckException 409 invalid_state (data.reason …, already_answered on a scored quiz run), 422 unsupported_type
     * @throws \Illuminate\Validation\ValidationException keyed answer_payload.*
     */
    public function submit(DeckSession $session, DeckParticipant $participant, DeckSessionSlideRun $run, array $payload): SubmittedAnswer
    {
        $type = $this->answerType($session, $run);
        // Cheap early answers; repeated under the lock below.
        self::assertAccepting($session, $run);
        $scored = app(QuizRuntime::class)->scores($session, $type);
        if ($scored && $this->answerQuery($participant, $run)->exists()) {
            throw self::alreadyAnswered($run);
        }

        $incoming = DeckValidation::prefixed('answer_payload', fn () => $type->validateAnswer(
            $payload,
            $run->config_snapshot ?? [],
            $run->options_snapshot ?? [],
        ));

        /** @var array{0: SubmittedAnswer, 1: DeckSessionSlideRun} $saved */
        $saved = DeckValidation::prefixed('answer_payload', fn () => DB::transaction(
            fn () => $this->persist($session, $participant, $run, $type, $incoming),
            3,
        ));
        [$result, $lockedRun] = $saved;

        $result->answer->setRelation('participant', $participant);
        // The event carries this submission only, size-capped (AnswerBroadcastPreview), not the merged row.
        $event = clone $result->answer;
        $event->answer_payload = AnswerBroadcastPreview::make($incoming);

        app(ParticipantPresence::class)->returned($session, $participant);
        $this->aggregates->schedule($lockedRun);
        DB::afterCommit(function () use ($session, $event, $result) {
            $total = DeckParticipantAnswer::query()->where('slide_run_id', $event->slide_run_id)->count();

            $this->broadcaster->broadcast($session, AnswerSubmittedPayload::fromAnswer($event, $total, $result->isUpdate));
        });

        if ($type->revealModel() === SlideTypeContract::REVEAL_HIDDEN) {
            DB::afterCommit(function () use ($session, $lockedRun) {
                try {
                    app(SessionStateMachine::class)->revealIfAllAnswered($session, (int) $lockedRun->id);
                } catch (Throwable $exception) {
                    // The answer is committed; the host or the timer still reveals.
                    report($exception);
                }
            });
        }

        return $result;
    }

    /**
     * Whether $run takes answers right now: the session is live, $run is its
     * current run, it is voting and its time limit (if any) has not run out.
     * The deadline is voting_started_at + time_limit_seconds, the same one
     * the state machine's timer closes the run at; DEADLINE_GRACE_MS covers
     * network latency, and a late timer job never extends voting.
     *
     * @throws DeckException 409 invalid_state with data.reason
     *                       (session_not_live | not_current_slide | not_voting | time_up)
     */
    public static function assertAccepting(DeckSession $session, DeckSessionSlideRun $run, ?CarbonInterface $at = null): void
    {
        if ($session->status !== DeckSession::STATUS_LIVE) {
            throw DeckException::invalidState('This session is not live.', [
                'reason' => 'session_not_live',
                'session_status' => $session->status,
            ]);
        }

        if ((int) $session->current_slide_run_id !== (int) $run->id) {
            throw DeckException::invalidState('Not accepting answers.', [
                'reason' => 'not_current_slide',
                'current_slide_run_id' => $session->current_slide_run_id,
            ]);
        }

        if ($run->state !== DeckSessionSlideRun::STATE_VOTING) {
            throw DeckException::invalidState('Not accepting answers.', [
                'reason' => 'not_voting',
                'state' => $run->state,
                'state_version' => $run->state_version,
            ]);
        }

        $limit = (int) $run->time_limit_seconds;
        if ($limit > 0 && $run->voting_started_at) {
            $deadlineMs = $run->voting_started_at->getTimestampMs() + $limit * 1000;

            if (($at ?? now())->getTimestampMs() > $deadlineMs + self::DEADLINE_GRACE_MS) {
                throw DeckException::invalidState('Not accepting answers.', [
                    'reason' => 'time_up',
                    'state' => $run->state,
                    'state_version' => $run->state_version,
                ]);
            }
        }
    }

    /** Milliseconds from voting_started_at to $at (>= 0); null when voting never started. */
    public static function timeToAnswerMs(DeckSessionSlideRun $run, CarbonInterface $at): ?int
    {
        if (! $run->voting_started_at) {
            return null;
        }

        $ms = (int) floor($run->voting_started_at->diffInMilliseconds($at));

        return max(0, min($ms, self::MAX_TIME_MS));
    }

    /**
     * Inserts one row (ON CONFLICT DO NOTHING) and returns how many were
     * inserted: 0 when the participant already has an answer on the run.
     * A seam for the race tests.
     */
    protected function insertAnswer(array $row): int
    {
        return DeckParticipantAnswer::query()->insertOrIgnore($row);
    }

    /** @return array{0: SubmittedAnswer, 1: DeckSessionSlideRun} */
    private function persist(
        DeckSession $session,
        DeckParticipant $participant,
        DeckSessionSlideRun $run,
        SlideTypeContract $type,
        array $incoming,
    ): array {
        $locked = DeckSessionSlideRun::query()->whereKey($run->id)->sharedLock()->first();
        $fresh = DeckSession::query()->whereKey($session->id)->first(['id', 'status', 'current_slide_run_id']);

        if (! $locked || ! $fresh || (int) $locked->deck_session_id !== (int) $session->id) {
            throw DeckException::notFound('Slide not found in this session.');
        }

        $now = now();
        self::assertAccepting($fresh, $locked, $now);
        $locked->setRelation('session', $session);

        $timeToAnswerMs = self::timeToAnswerMs($locked, $now);
        $config = $locked->config_snapshot ?? [];
        $model = new DeckParticipantAnswer();
        $timestamp = $model->fromDateTime($now);
        $scored = app(QuizRuntime::class)->scores($session, $type);
        $score = $scored ? $this->score($locked, $incoming, $timeToAnswerMs) : null;

        for ($attempt = 1; ; $attempt++) {
            $inserted = $this->insertAnswer([
                'deck_participant_id' => $participant->id,
                'slide_run_id' => $locked->id,
                // insertOrIgnore skips Eloquent casts.
                'answer_payload' => json_encode($incoming, JSON_THROW_ON_ERROR),
                'time_to_answer_ms' => $timeToAnswerMs,
                'submitted_at' => $timestamp,
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ] + ($score === null ? [] : [
                'is_correct' => $score->isCorrect,
                'points_awarded' => $score->pointsAwarded,
            ]));

            $existing = $this->answerQuery($participant, $locked);

            if ($inserted > 0) {
                return [new SubmittedAnswer($existing->firstOrFail(), isUpdate: false, merged: false), $locked];
            }

            // Scored quiz answers are final: an earlier (or a racing) first answer wins.
            if ($scored) {
                throw self::alreadyAnswered($locked);
            }

            // Someone (an earlier or a racing submission) owns the row: wait for it, then merge.
            $answer = $existing->lockForUpdate()->first();
            if ($answer) {
                break;
            }

            if ($attempt >= self::MAX_ATTEMPTS) {
                throw DeckException::conflict('Your answer could not be saved. Please try again.');
            }
        }

        $merged = $type instanceof AppendsSubmissions && $type->allowsMultipleSubmissions($config);
        $answer->answer_payload = $type instanceof AppendsSubmissions
            ? $type->mergeSubmissions($answer->answer_payload ?? [], $incoming, $config)
            : $incoming;
        $answer->time_to_answer_ms = $timeToAnswerMs;
        $answer->submitted_at = $now;
        $answer->save();

        return [new SubmittedAnswer($answer, isUpdate: true, merged: $merged), $locked];
    }

    /**
     * ScoringService on the run's snapshots; points are never negative. A
     * scoring failure is reported and scores 0 (is_correct null), so the
     * answer itself is still kept.
     */
    private function score(DeckSessionSlideRun $run, array $payload, ?int $timeToAnswerMs): ScoreResult
    {
        try {
            $result = app(QuizRuntime::class)->score($run, $payload, (int) ($timeToAnswerMs ?? 0));
        } catch (Throwable $exception) {
            report($exception);

            return ScoreResult::zero();
        }

        return new ScoreResult(max(0, $result->pointsAwarded), $result->isCorrect, $result->partialCreditRatio);
    }

    /** 409 invalid_state for a second answer on a scored quiz run. */
    private static function alreadyAnswered(DeckSessionSlideRun $run): DeckException
    {
        return DeckException::invalidState('You have already answered this slide. Answers are final.', [
            'reason' => 'already_answered',
            'slide_run_id' => (int) $run->id,
        ]);
    }

    private function answerQuery(DeckParticipant $participant, DeckSessionSlideRun $run)
    {
        return DeckParticipantAnswer::query()
            ->where('deck_participant_id', $participant->id)
            ->where('slide_run_id', $run->id);
    }

    /**
     * @throws DeckException 422 unsupported_type for an unknown type or one
     *                       the product does not offer; 409 when it takes no answers
     */
    private function answerType(DeckSession $session, DeckSessionSlideRun $run): SlideTypeContract
    {
        $key = (string) $run->type_snapshot;
        $type = $this->registry->has($key) ? $this->registry->for($key) : null;

        if (! $type || ! in_array($session->product(), $type->products(), true)) {
            throw DeckException::unsupportedType($key);
        }

        if (! $type->acceptsAnswers()) {
            throw DeckException::invalidState('This slide does not accept answers.', ['reason' => 'no_answers']);
        }

        return $type;
    }
}
