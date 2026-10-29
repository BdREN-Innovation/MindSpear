<?php

namespace App\Deck\Sessions;

use App\Deck\Broadcasts\Payloads\PublishSize;
use App\Deck\Broadcasts\Payloads\SlideRevealedPayload;
use App\Deck\Scoring\LeaderboardService;
use App\Deck\Scoring\ScoringService;
use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Deck\Slide;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Quizzes on the shared engine (QUIZ_REDESIGN_PLAN.md Phases 1–2): what the
 * session launcher, state machine, answer submission and the live views need
 * from scoring and the leaderboard, in one place. Scoring and ranking
 * themselves live in App\Deck\Scoring (ScoringService, LeaderboardService).
 *
 * - Scored runs: answer-taking runs of a quiz session. Quest never scores.
 *   An answer is final and scored on submit (answer row only); its points
 *   reach deck_participants.total_points when the run is revealed
 *   (applyRevealedPoints), so totals, standings and leaderboards only ever
 *   hold revealed runs.
 * - Revealed runs are frozen (no more answers), so their aggregate is
 *   cached per run + state_version: the reveal broadcast computes it once
 *   and every my-answer / aggregate read reuses it. LeaderboardService
 *   caches the rankings itself.
 * - Spinner runs keep their spin result in config_snapshot._spin (the `_`
 *   prefix keeps it out of the participant config; views add `spin`).
 */
class QuizRuntime
{
    /** Type key of the leaderboard slide (moving onto it broadcasts leaderboard.updated). */
    public const LEADERBOARD_TYPE = 'leaderboard';

    /** config_snapshot key holding a spinner run's result {option_id, target_angle, spun_at}. */
    public const SPIN_KEY = '_spin';

    /** Seconds a revealed run's aggregate stays cached. */
    public const REVEAL_CACHE_SECONDS = 3600;

    public function __construct(private readonly SlideTypeRegistry $registry) {}

    // --- types -------------------------------------------------------------------

    /** Spinner-style types: they expose spin(DeckSessionSlideRun): array{option_id, target_angle}. */
    public static function spins(SlideTypeContract $type): bool
    {
        return method_exists($type, 'spin');
    }

    public function type(DeckSessionSlideRun $run): ?SlideTypeContract
    {
        $key = (string) $run->type_snapshot;

        return $this->registry->has($key) ? $this->registry->for($key) : null;
    }

    /** Whether answers on $run are scored: a quiz session's answer-taking run. */
    public function scores(DeckSession $session, ?SlideTypeContract $type): bool
    {
        return $type !== null && $type->acceptsAnswers() && $session->product() === Deck::PRODUCT_QUIZ;
    }

    public function isLeaderboard(DeckSessionSlideRun $run): bool
    {
        return (string) $run->type_snapshot === self::LEADERBOARD_TYPE && $this->registry->has(self::LEADERBOARD_TYPE);
    }

    // --- session start -----------------------------------------------------------

    /**
     * config_snapshot.scoring of a scored quiz run: the slide's points
     * (defaults config deck.quiz.scoring) plus the run's time limit, which
     * the speed bonus counts down from.
     *
     * @return array{points_min:int, points_max:int, speed_bonus_enabled:bool, time_limit_seconds:?int}
     */
    public static function scoringSnapshot(Slide $slide, ?int $timeLimitSeconds): array
    {
        $defaults = (array) config('deck.quiz.scoring', []);
        $max = (int) ($slide->points_max ?? $defaults['points_max'] ?? 100);
        $min = (int) ($slide->points_min ?? $defaults['points_min'] ?? 50);

        return [
            'points_min' => min($min, $max),
            'points_max' => $max,
            'speed_bonus_enabled' => (bool) ($slide->speed_bonus_enabled ?? $defaults['speed_bonus_enabled'] ?? true),
            'time_limit_seconds' => $timeLimitSeconds,
        ];
    }

    /** The "Get ready" countdown of a quiz slide whose own value is unset (null). */
    public static function defaultGetReadySeconds(): int
    {
        return max(0, (int) config('deck.quiz.get_ready_seconds', 5));
    }

    /**
     * How long a spinner spins before it reveals (its run's
     * time_limit_seconds): the slide's spin_duration_ms rounded up to whole
     * seconds, else config deck.quiz.spin_seconds; null = until the host reveals.
     */
    public static function spinSeconds(array $config = []): ?int
    {
        $ms = $config['spin_duration_ms'] ?? null;
        $seconds = is_numeric($ms) && (int) $ms > 0
            ? (int) ceil((int) $ms / 1000)
            : (int) config('deck.quiz.spin_seconds', 3);

        return $seconds > 0 ? $seconds : null;
    }

    // --- scoring -----------------------------------------------------------------

    public function score(DeckSessionSlideRun $run, array $payload, int $timeToAnswerMs): ScoreResult
    {
        return app(ScoringService::class)->score($run, $payload, max(0, $timeToAnswerMs));
    }

    // --- spinner -----------------------------------------------------------------

    /** @return array{option_id:int, target_angle:float} */
    public static function normaliseSpin(array $spin): array
    {
        return [
            'option_id' => (int) ($spin['option_id'] ?? 0),
            'target_angle' => round((float) ($spin['target_angle'] ?? 0), 3),
        ];
    }

    /** A spinner run's result, or null before it was spun. */
    public static function spinResult(DeckSessionSlideRun $run): ?array
    {
        $spin = ($run->config_snapshot ?? [])[self::SPIN_KEY] ?? null;

        return is_array($spin) && isset($spin['option_id']) ? self::normaliseSpin($spin) : null;
    }

    // --- leaderboard -------------------------------------------------------------

    /**
     * Rows a leaderboard run shows: the type's limit($config) (top_n, or its
     * maximum with show_all_participants), else config top_n /
     * deck.quiz.leaderboard_size; 1..leaderboard_max.
     */
    public function leaderboardSize(DeckSessionSlideRun $run): int
    {
        $config = $run->config_snapshot ?? [];
        $type = $this->type($run);

        if ($type !== null && method_exists($type, 'limit')) {
            return self::clampSize((int) $type::limit($config));
        }

        $n = $config['top_n'] ?? null;

        return self::clampSize(is_numeric($n) ? (int) $n : null);
    }

    public static function clampSize(?int $n): int
    {
        $max = max(1, (int) config('deck.quiz.leaderboard_max', 100));

        return max(1, min($max, $n ?? (int) config('deck.quiz.leaderboard_size', 10)));
    }

    /** @return list<array{rank:int, participant_id:int, display_name:?string, emoji_avatar:?string, total_points:int, points_delta:int}> */
    public function leaderboard(DeckSession $session, int $n): array
    {
        return array_values(app(LeaderboardService::class)->currentTopN($session, $n));
    }

    /**
     * $participant's place: {participant_id, total_points, rank, points_delta}
     * from LeaderboardService::standing() (ties share a rank: 1, 2, 2, 4),
     * points_delta of $run (default: the latest revealed scored run). Totals
     * only hold revealed runs (applyRevealedPoints), so this never moves
     * while a run takes answers. A participant who left is not ranked: rank
     * null, their own stored total.
     */
    public function standing(DeckSession $session, DeckParticipant $participant, ?DeckSessionSlideRun $run = null): array
    {
        $row = app(LeaderboardService::class)->standing($session, (int) $participant->id, $run);
        $total = (int) ($row['total_points'] ?? $participant->total_points ?? 0);
        $rank = isset($row['rank']) ? (int) $row['rank'] : null;

        // Before the first reveal there is no ranking yet, but every player in the
        // room is tied: rank them from the (revealed-only) totals so a reloaded
        // phone shows the same "#1 · 0 pts" as one that stayed connected.
        if ($rank === null && $participant->left_at === null) {
            $rank = 1 + DeckParticipant::query()
                ->where('deck_session_id', $session->id)
                ->whereNull('left_at')
                ->where('total_points', '>', $total)
                ->count();
        }

        return [
            'participant_id' => (int) $participant->id,
            'total_points' => $total,
            'rank' => $rank,
            'points_delta' => (int) ($row['points_delta'] ?? 0),
        ];
    }

    /**
     * Leaderboard movement of a revealed scored run, best new_rank first, at
     * most $limit rows, and whether more participants were left out.
     *
     * @return array{0: list<array{participant_id:int, points_delta:int, new_total:int, new_rank:int}>, 1: bool}
     */
    public function revealDelta(DeckSession $session, DeckSessionSlideRun $run, int $limit): array
    {
        $rows = array_values(app(LeaderboardService::class)->revealDelta($session, $run, $limit + 1));

        return [array_slice($rows, 0, $limit), count($rows) > $limit];
    }

    // --- reveal ------------------------------------------------------------------

    /**
     * voting → reveal of a scored run: adds every answer's points_awarded to
     * its participant's total_points in one UPDATE, inside the reveal's
     * transaction (SessionStateMachine::reveal, session and run locked; the
     * run lock waits for in-flight answers, so every answer is counted
     * exactly once). Submissions only store is_correct / points_awarded, so
     * standings, leaderboards and leaderboard_delta reflect revealed runs only
     * and nothing during voting tells a player whether they were right.
     * Returns the number of participants whose total moved.
     */
    public function applyRevealedPoints(DeckSession $session, DeckSessionSlideRun $run): int
    {
        if (! $this->scores($session, $this->type($run))) {
            return 0;
        }

        $now = (new DeckParticipant())->fromDateTime(now());

        return DB::update(
            'UPDATE deck_participants AS p'
            . ' SET total_points = COALESCE(p.total_points, 0) + a.points, updated_at = ?'
            . ' FROM (SELECT deck_participant_id, SUM(COALESCE(points_awarded, 0)) AS points'
            . ' FROM deck_participant_answers WHERE slide_run_id = ? GROUP BY deck_participant_id) AS a'
            . ' WHERE p.id = a.deck_participant_id AND p.deck_session_id = ? AND a.points <> 0',
            [$now, (int) $run->id, (int) $session->id],
        );
    }

    /**
     * The run's aggregate (with the correct answers the type adds) plus, for
     * a spinner, `spin`. Cached once the run is final.
     */
    public function aggregate(DeckSessionSlideRun $run): array
    {
        $compute = function () use ($run) {
            $aggregate = $this->type($run) ? $this->registry->aggregate($run) : [];
            $spin = self::spinResult($run);

            return $spin === null ? $aggregate : $aggregate + ['spin' => $spin];
        };

        if (! $run->isFinal()) {
            return $compute();
        }

        return Cache::remember(sprintf('deck:quiz:aggregate:%d:%d', $run->id, (int) $run->state_version), self::REVEAL_CACHE_SECONDS, $compute);
    }

    /**
     * The correct answer block of an aggregate: the type's `correct` entry,
     * or the top-level answer keys (correct_option_ids, accepted_answers,
     * correct_pairs, correct_order, correct_categories) it returned.
     */
    public static function correctAnswer(array $aggregate): mixed
    {
        if (array_key_exists('correct', $aggregate)) {
            return $aggregate['correct'];
        }

        $keys = ['correct_option_ids', 'accepted_answers', 'correct_pairs', 'correct_order', 'correct_categories'];
        $found = array_intersect_key($aggregate, array_flip($keys));

        return $found === [] ? null : $found;
    }

    /** `slide.revealed` for a run that just moved to reveal (slim when too big for one publish). */
    public function revealedPayload(DeckSessionSlideRun $run): SlideRevealedPayload
    {
        $session = $run->session;
        $limit = max(0, (int) config('deck.quiz.reveal_leaderboard_limit', 10));
        [$delta, $truncated] = $this->scores($session, $this->type($run)) ? $this->revealDelta($session, $run, $limit) : [[], false];

        $payload = SlideRevealedPayload::fromRun($run, $this->aggregate($run), $delta, $truncated, self::spinResult($run));

        return PublishSize::fits($session, $payload) ? $payload : $payload->slim();
    }

    /**
     * What my-answer adds once a scored run is revealed:
     * {is_correct, points_awarded, correct_answer, total_points, rank}
     * (the participant's current total and rank over every revealed run,
     * LeaderboardService::standing; not a snapshot as of this run).
     */
    public function answerExtras(DeckParticipantAnswer $answer, DeckSessionSlideRun $run, DeckParticipant $participant): array
    {
        $standing = $this->standing($run->session, $participant, $run);

        return [
            'is_correct' => $answer->is_correct,
            'points_awarded' => (int) ($answer->points_awarded ?? 0),
            'correct_answer' => self::correctAnswer($this->aggregate($run)),
            'total_points' => $standing['total_points'],
            'rank' => $standing['rank'],
        ];
    }

    /** Whether my-answer for $run gets answerExtras(): a revealed scored run. */
    public function showsCorrectness(DeckSessionSlideRun $run): bool
    {
        $session = $run->session;

        return $run->isRevealed() && $session !== null && $this->scores($session, $this->type($run));
    }
}
