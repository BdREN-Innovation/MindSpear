<?php

namespace App\Modules\FunGame\Services;

use App\Modules\FunGame\Models\FunGame;
use App\Modules\FunGame\Models\FunGameAnswer;
use App\Modules\FunGame\Models\FunGameParticipant;
use App\Modules\FunGame\Models\FunGameQuestion;
use App\Modules\FunGame\Models\FunGameSession;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Scores and ranks a session.
 *
 * Marks:  correct → the question's marks, wrong → minus its penalty.
 * Speed (Kahoot-style, no penalty), per-question timer:
 *         correct → 1000 × marks × (1 − t ÷ 2T); t = time taken, T = its time limit.
 * Speed, total timer:
 *         (Σ 1000 × marks of correct answers) × (1 − elapsed ÷ 2 × total time),
 *         elapsed = first question shown → finished (running out of time = ×0.5).
 *
 * Ranking: score desc, then correct desc, then time taken asc. Rows tied on all
 * three share a rank.
 */
class ScoringService
{
    public const SPEED_POINTS_PER_MARK = 1000;

    public function __construct(private readonly TimerService $timer) {}

    /**
     * Points for one answer at the moment it's given. For the total-timer speed
     * mode this is the base (before the time multiplier, applied at the end).
     */
    public function answerPoints(FunGameSession $session, FunGameQuestion $question, bool $correct, int $responseMs): float
    {
        if ($session->scoringMode() !== FunGame::SCORING_SPEED) {
            return $correct ? (float) $question->marks : -1 * (float) $question->negative_marks;
        }
        if (! $correct) {
            return 0.0;
        }
        $base = self::SPEED_POINTS_PER_MARK * (float) $question->marks;
        if (! $session->isPerQuestion()) {
            return $base;
        }
        $limitMs = $this->timer->secondsForQuestion($session, $question->id) * 1000;

        return (float) round($base * (1 - min($responseMs, $limitMs) / (2 * $limitMs)));
    }

    /**
     * Current standings without saving anything (also used for the host's live table).
     *
     * @return Collection<int, array{participant: FunGameParticipant, score: float, correct: int, incorrect: int, answered: int, unanswered: int, time_ms: ?int, avg_answer_ms: ?int, rank: int}>
     */
    public function standings(FunGameSession $session): Collection
    {
        $questionIds = $session->questionIds();
        // Each player answers their own set of this size (all questions, or N from the pool).
        $questionCount = $session->questionsPerPlayer();
        $speedTotal = $session->scoringMode() === FunGame::SCORING_SPEED && ! $session->isPerQuestion();
        $totalMs = $this->timer->totalSeconds($session) * 1000;

        $participants = $session->participants()->get();
        $answers = FunGameAnswer::query()
            ->whereIn('fun_game_participant_id', $participants->pluck('id'))
            ->whereIn('fun_game_question_id', $questionIds)
            ->get()
            ->groupBy('fun_game_participant_id');

        $rows = $participants->map(function (FunGameParticipant $p) use ($answers, $questionCount, $speedTotal, $totalMs) {
            $mine = $answers->get($p->id, collect());
            $correct = $mine->where('is_correct', true)->count();
            $incorrect = $mine->count() - $correct;
            $timeMs = $this->timeTaken($p, $totalMs, $speedTotal);
            $points = (float) $mine->sum('points');
            $score = $speedTotal ? round($points * $this->factorFor($timeMs, $totalMs)) : round($points, 2);
            $responses = $mine->pluck('response_ms')->filter(fn ($v) => $v !== null);

            return [
                'participant' => $p,
                'score' => (float) $score,
                'correct' => $correct,
                'incorrect' => $incorrect,
                'answered' => $mine->count(),
                'unanswered' => (count($p->question_order ?? []) ?: $questionCount) - $mine->count(),
                'time_ms' => $timeMs,
                'avg_answer_ms' => $responses->isEmpty() ? null : (int) round($responses->avg()),
            ];
        })->all();

        usort($rows, fn (array $a, array $b) => [$b['score'], $b['correct']] <=> [$a['score'], $a['correct']]
            ?: $this->timeKey($a['time_ms']) <=> $this->timeKey($b['time_ms'])
            ?: $a['participant']->id <=> $b['participant']->id);

        $ranked = [];
        foreach ($rows as $i => $row) {
            $prev = $ranked[$i - 1] ?? null;
            $tied = $prev
                && $prev['score'] === $row['score']
                && $prev['correct'] === $row['correct']
                && $this->timeKey($prev['time_ms']) === $this->timeKey($row['time_ms']);
            $row['rank'] = $tied ? $prev['rank'] : $i + 1;
            $ranked[] = $row;
        }

        return collect($ranked);
    }

    /** Final scoring: stores each answer's points and each player's totals and rank. */
    public function persist(FunGameSession $session): Collection
    {
        $standings = $this->standings($session);
        $speedTotal = $session->scoringMode() === FunGame::SCORING_SPEED && ! $session->isPerQuestion();
        $totalMs = $this->timer->totalSeconds($session) * 1000;

        DB::transaction(function () use ($standings, $speedTotal, $totalMs) {
            foreach ($standings as $row) {
                $p = $row['participant'];
                if ($speedTotal) {
                    // Each answer's share of the final score, so the sheet adds up.
                    $factor = $this->factorFor($row['time_ms'], $totalMs);
                    FunGameAnswer::query()
                        ->where('fun_game_participant_id', $p->id)
                        ->where('is_correct', true)
                        ->update(['points' => DB::raw('ROUND(points * ' . number_format($factor, 6, '.', '') . ')')]);
                }
                $p->forceFill([
                    'score' => $row['score'],
                    'correct_count' => $row['correct'],
                    'incorrect_count' => $row['incorrect'],
                    'unanswered_count' => $row['unanswered'],
                    'rank' => $row['rank'],
                    'elapsed_ms' => $row['time_ms'],
                ])->save();
            }
        });

        return $standings;
    }

    /** First question shown → finished; for someone still playing, → now. Capped at the total time in total mode. */
    private function timeTaken(FunGameParticipant $p, int $totalMs, bool $capAtTotal): ?int
    {
        if (! $p->first_opened_at) {
            return null;
        }
        $ms = $p->elapsed_ms ?? TimerService::ms($p->first_opened_at, $p->finished_at ?? now());

        return $capAtTotal ? min($ms, $totalMs) : $ms;
    }

    private function factorFor(?int $elapsedMs, int $totalMs): float
    {
        return 1 - min($elapsedMs ?? $totalMs, $totalMs) / (2 * $totalMs);
    }

    /** Players who never started sort after everyone with the same score. */
    private function timeKey(?int $ms): float
    {
        return $ms ?? INF;
    }
}
