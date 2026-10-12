<?php

namespace App\Modules\FunGame\Services;

use App\Modules\FunGame\Models\FunGame;
use App\Modules\FunGame\Models\FunGameSession;
use Carbon\CarbonInterface;

/** Deadline arithmetic. Every deadline the UI shows is produced here, on the server. */
class TimerService
{
    public const PER_QUESTION_MIN = 5;

    public const PER_QUESTION_MAX = 600;

    public const TOTAL_MIN = 60;

    public const TOTAL_MAX = 21600;

    /** New players can join for this long after the game starts. */
    public const JOIN_WINDOW_SECONDS = 120;

    /** Added to the hard end time, after the last admitted player's full time. */
    public const END_GRACE_SECONDS = 30;

    /** Timestamp format for raw inserts (the query builder's default drops milliseconds). */
    public const DB_FORMAT = 'Y-m-d H:i:s.vP';

    /** An answer may arrive this late (network delay) and still count. */
    public const ANSWER_GRACE_MS = 500;

    /**
     * Frozen copy of the game's settings and questions, taken when a session
     * starts. With a pool, "same" selection draws the shared questions here,
     * so every hosting gets a fresh random set.
     */
    public function snapshot(FunGame $game): array
    {
        $questions = $game->questions()->get(['id', 'seconds_override']);
        $poolIds = $questions->pluck('id')->map(fn ($id) => (int) $id)->all();
        $perPlayer = $game->questions_per_player ? min((int) $game->questions_per_player, count($poolIds)) : count($poolIds);
        $selection = $game->question_selection === FunGame::SELECTION_DIFFERENT ? FunGame::SELECTION_DIFFERENT : FunGame::SELECTION_SAME;
        $drawn = null;
        if ($selection === FunGame::SELECTION_SAME && $perPlayer < count($poolIds)) {
            $picked = array_flip((array) array_rand(array_flip($poolIds), $perPlayer));
            $drawn = array_values(array_filter($poolIds, fn ($id) => isset($picked[$id]))); // keep game order
        }

        return [
            'per_player' => $perPlayer,
            'selection' => $selection,
            'drawn_ids' => $drawn,
            'mode' => $game->timer_mode,
            'total_seconds' => $game->total_seconds,
            'seconds_per_question' => $game->seconds_per_question,
            'scoring_mode' => $game->scoring_mode ?: FunGame::SCORING_MARKS,
            'shuffle' => (bool) $game->shuffle_questions,
            'overrides' => $questions
                ->filter(fn ($q) => $q->seconds_override !== null)
                ->mapWithKeys(fn ($q) => [(string) $q->id => $q->seconds_override])
                ->all(),
            'question_ids' => $poolIds,
        ];
    }

    public function secondsForQuestion(FunGameSession $session, int $questionId): int
    {
        $snapshot = $session->timer_snapshot ?? [];

        return (int) ($snapshot['overrides'][(string) $questionId] ?? $snapshot['seconds_per_question'] ?? 30);
    }

    public function totalSeconds(FunGameSession $session): int
    {
        return (int) ($session->timer_snapshot['total_seconds'] ?? 1200);
    }

    /** How long one player needs at most: the sum of question times, or the total timer. */
    public function playSeconds(FunGameSession $session): int
    {
        if (! $session->isPerQuestion()) {
            return $this->totalSeconds($session);
        }

        // Players may get different questions: allow for the slowest set anyone could draw.
        $ids = $session->sharedQuestionIds() ?? $session->questionIds();
        $seconds = array_map(fn (int $id) => $this->secondsForQuestion($session, $id), $ids);
        rsort($seconds);

        return array_sum(array_slice($seconds, 0, $session->questionsPerPlayer()));
    }

    /** Timer in the API's shape, from a session snapshot or the game's current settings. */
    public function config(FunGame $game, ?array $snapshot = null): array
    {
        if ($snapshot === null) {
            $overrides = $game->questions()
                ->whereNotNull('seconds_override')
                ->pluck('seconds_override', 'id')
                ->mapWithKeys(fn ($seconds, $id) => [(string) $id => (int) $seconds])
                ->all();
            $snapshot = [
                'mode' => $game->timer_mode,
                'total_seconds' => $game->total_seconds,
                'seconds_per_question' => $game->seconds_per_question,
                'overrides' => $overrides,
            ];
        }

        if (($snapshot['mode'] ?? FunGame::TIMER_TOTAL) === FunGame::TIMER_PER_QUESTION) {
            return [
                'mode' => 'perQuestion',
                'secondsPerQuestion' => (int) $snapshot['seconds_per_question'],
                'overrides' => (object) ($snapshot['overrides'] ?? []),
            ];
        }

        return [
            'mode' => 'total',
            'totalSeconds' => (int) $snapshot['total_seconds'],
        ];
    }

    /** ISO-8601 UTC with milliseconds, the format every client timestamp uses. */
    public static function iso(?CarbonInterface $time): ?string
    {
        return $time?->copy()->utc()->format('Y-m-d\TH:i:s.v\Z');
    }

    /**
     * Whole milliseconds from `$from` to `$to`, never negative. Truncates to the
     * millisecond like storage does, so stored and in-memory times agree.
     */
    public static function ms(CarbonInterface $from, CarbonInterface $to): int
    {
        return max(0, (int) $to->format('Uv') - (int) $from->format('Uv'));
    }
}
