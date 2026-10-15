<?php

namespace App\Services\Live;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Deck\Broadcasts\DeckBroadcaster;
use App\Deck\Broadcasts\Payloads\SlideAggregateUpdatedPayload;
use App\Deck\Broadcasts\Payloads\SlideClosedPayload;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quest\PollSettings;
use App\Jobs\Deck\BroadcastDeckAggregate;
use App\Jobs\Live\BroadcastLiveAggregateSnapshot;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Quest\QuestSession;
use App\Models\Quest\QuestTask;
use App\Models\Quest\QuestTaskCompletion;
use App\Models\Quiz\QuizSession;
use App\Models\Quiz\UserQuizAnswer;
use Closure;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Sleep;
use Throwable;

/**
 * Live answer aggregates. Legacy Quest/Quiz sessions queue one snapshot per
 * answer (recordAnswer); deck sessions debounce per slide run (schedule).
 *
 * Deck collaborators are resolved lazily so the legacy paths never build the
 * slide type registry.
 */
class LiveAggregateService
{
    /** The debounce timestamp only has to outlive the window; this is generous. */
    private const DEBOUNCE_TTL_SECONDS = 60;

    /** Safety net: if a worker loses a trailing job, its pending marker frees itself. */
    private const PENDING_TTL_SECONDS = 30;

    public function recordAnswer(string $module, int $sessionId, int $itemId): void
    {
        if (DB::transactionLevel() > 0) {
            DB::afterCommit(fn () => $this->dispatchSnapshot($module, $sessionId, $itemId));

            return;
        }

        $this->dispatchSnapshot($module, $sessionId, $itemId);
    }

    public function broadcastSnapshot(string $module, int $sessionId, int $itemId): void
    {
        if ($module === LiveSessionService::MODULE_QUEST) {
            $session = QuestSession::find($sessionId);

            if (! $session) {
                return;
            }

            app(LiveSessionService::class)->broadcastPublic(
                $module,
                $session,
                'answer.aggregate.updated',
                $this->snapshot($module, $sessionId, $itemId),
            );

            return;
        }

        $session = QuizSession::find($sessionId);

        if (! $session) {
            return;
        }

        app(LiveSessionService::class)->broadcastPublic(
            $module,
            $session,
            'answer.aggregate.updated',
            $this->snapshot($module, $sessionId, $itemId),
        );
    }

    /**
     * Legacy: snapshot of the current task/question. Deck: the current run's
     * raw aggregate; the caller decides who may see it (reveal model).
     */
    public function currentSnapshot(string $module, QuestSession|QuizSession|DeckSession $session): ?array
    {
        if ($session instanceof DeckSession) {
            $run = $session->currentRun;

            return $run ? $this->registry()->aggregate($run) : null;
        }

        $itemId = $module === LiveSessionService::MODULE_QUEST
            ? $session->current_task_id
            : $session->current_question_id;

        if (! $itemId) {
            return null;
        }

        return $this->snapshot($module, (int) $session->id, (int) $itemId);
    }

    public function snapshot(string $module, int $sessionId, int $itemId): array
    {
        $snapshot = $module === LiveSessionService::MODULE_QUEST
            ? $this->questSnapshot($sessionId, $itemId)
            : $this->quizSnapshot($sessionId, $itemId);

        return array_merge($snapshot, [
            'module' => $module,
            'event' => 'answer.aggregate.updated',
        ]);
    }

    // --- Deck sessions (shared slide engine) ------------------------------------

    /** Cache key with the time (ms) of a run's last aggregate broadcast. */
    public static function debounceKey(int $slideRunId): string
    {
        return "agg:debounce:{$slideRunId}";
    }

    /** Owned cache lock held while a run has a trailing job pending. */
    public static function pendingKey(int $slideRunId): string
    {
        return "agg:pending:{$slideRunId}";
    }

    /**
     * Debounced `slide.aggregate.updated` for a run. Call it after every
     * accepted answer; it runs after the surrounding transaction commits.
     *
     * - Leading edge: when nothing went out for this run in the last window,
     *   broadcast now.
     * - Otherwise make sure one trailing BroadcastDeckAggregate is queued for
     *   the end of the window. It recomputes when it runs, so the final state
     *   is never dropped, and the run's pending marker keeps it to one.
     *
     * Latency: the trailing broadcast lands when a worker picks the job up.
     * Queue delays are whole seconds (the job sleeps off the rest), and an
     * idle `queue:work` only polls every `--sleep` seconds (3 by default),
     * so the last update of a burst can arrive up to that much late unless
     * the default-queue worker runs with a short `--sleep`.
     *
     * $compute only feeds the leading edge (a queued job cannot carry a
     * closure); without it the aggregate comes from SlideTypeRegistry.
     */
    public function schedule(DeckSessionSlideRun $run, ?Closure $compute = null, ?int $debounceMs = null): void
    {
        $windowMs = max(0, $debounceMs ?? (int) config('deck.aggregate_debounce_ms', 500));

        app(LiveSessionService::class)->afterCommit(function () use ($run, $compute, $windowMs) {
            $waitMs = $this->claimLeadingEdge($run->id, $windowMs);

            if ($waitMs > 0) {
                $this->queueTrailing($run->id, $windowMs, $waitMs);

                return;
            }

            try {
                $this->broadcastDeckAggregateNow($run, $compute);
            } catch (Throwable $exception) {
                // The answer is already committed; a bad aggregate must not fail the request.
                report($exception);
            }
        });
    }

    /**
     * Queue delays are whole seconds on most drivers, so the trailing job may
     * start early; it waits out the rest of the window here.
     */
    public function waitForDebounceWindow(int $slideRunId, int $debounceMs): void
    {
        $last = Cache::get(self::debounceKey($slideRunId));
        $waitMs = $last === null ? 0 : (int) $last + $debounceMs - now()->getTimestampMs();

        if ($waitMs > 0) {
            Sleep::for(min($waitMs, $debounceMs))->milliseconds();
        }
    }

    /**
     * The trailing broadcast: recomputes from the database as it is now. It
     * stamps the window before freeing the pending marker, so a job queued
     * from here on waits a full window after this broadcast instead of
     * racing it.
     */
    public function broadcastTrailing(int $slideRunId, ?string $pendingOwner = null): void
    {
        Cache::put(self::debounceKey($slideRunId), now()->getTimestampMs(), self::DEBOUNCE_TTL_SECONDS);

        if ($pendingOwner !== null) {
            $this->releasePending($slideRunId, $pendingOwner);
        }

        $run = DeckSessionSlideRun::find($slideRunId);

        if (! $run) {
            return;
        }

        $this->broadcastDeckAggregateNow($run);
    }

    /** Frees a run's pending marker only if $owner still holds it; a stale or retried job never frees a newer job's marker. */
    public function releasePending(int $slideRunId, string $owner): void
    {
        Cache::restoreLock(self::pendingKey($slideRunId), $owner)->release();
    }

    /**
     * Broadcast a run's aggregate without debouncing, on the channel
     * resultsVisibility() picks.
     */
    public function broadcastDeckAggregateNow(DeckSessionSlideRun $run, ?Closure $compute = null): void
    {
        $aggregate = $compute ? $compute() : $this->registry()->aggregate($run);

        app(DeckBroadcaster::class)->broadcast(
            $run->session,
            SlideAggregateUpdatedPayload::fromRun($run, $aggregate, $this->resultsVisibility($run)),
        );
    }

    /**
     * Who may see a run's results: the public session channel only for a
     * live_aggregate type whose slide turned on "Show votes to participants"
     * (config_snapshot.show_results_to_participants, default off, plan §5.6);
     * everything else stays on the host channel, so the presenter shows the
     * live chart and participants never receive it. Phase 3's
     * GET /slide-runs/{id}/aggregate must apply the same rule to participants.
     */
    public function resultsVisibility(DeckSessionSlideRun $run): string
    {
        return $this->registry()->for($run->type_snapshot)->revealModel() === SlideTypeContract::REVEAL_LIVE
            && PollSettings::showsResultsToParticipants($run->config_snapshot ?? [])
            ? BroadcastPayload::VISIBILITY_PUBLIC
            : BroadcastPayload::VISIBILITY_HOST;
    }

    /**
     * `slide.closed` for a run that was just moved to `closed`, with the final
     * aggregate computed after the surrounding transaction commits (no
     * debounce), so the closing chart never waits for a trailing job. When
     * participants may see results it is one public event carrying the
     * aggregate; otherwise the public event carries `aggregate: null` and the
     * host gets the final numbers as a host-only `slide.aggregate.updated`.
     */
    public function broadcastClosed(DeckSessionSlideRun $run): void
    {
        app(LiveSessionService::class)->afterCommit(function () use ($run) {
            $aggregate = $this->registry()->aggregate($run);
            $broadcaster = app(DeckBroadcaster::class);

            if ($this->resultsVisibility($run) === BroadcastPayload::VISIBILITY_PUBLIC) {
                $broadcaster->broadcast($run->session, SlideClosedPayload::fromRun($run, $aggregate));

                return;
            }

            $broadcaster->broadcast($run->session, SlideClosedPayload::fromRun($run, null));
            $broadcaster->broadcast(
                $run->session,
                SlideAggregateUpdatedPayload::fromRun($run, $aggregate, BroadcastPayload::VISIBILITY_HOST),
            );
        });
    }

    /**
     * 0 when this call owns the leading edge (and stamps the time), otherwise
     * the ms left in the current window. The lock makes read-then-stamp
     * atomic; a caller that cannot get it falls back to the trailing job,
     * which always covers it.
     */
    private function claimLeadingEdge(int $slideRunId, int $windowMs): int
    {
        if ($windowMs === 0) {
            return 0;
        }

        $key = self::debounceKey($slideRunId);
        $lock = Cache::lock("{$key}:lock", 5);

        if (! $lock->get()) {
            return $windowMs;
        }

        try {
            $now = now()->getTimestampMs();
            $last = Cache::get($key);
            $waitMs = $last === null ? 0 : (int) $last + $windowMs - $now;

            if ($waitMs > 0) {
                return $waitMs;
            }

            Cache::put($key, $now, self::DEBOUNCE_TTL_SECONDS);

            return 0;
        } finally {
            $lock->release();
        }
    }

    /**
     * Queue the run's trailing job unless one is already pending. Bus::dispatch
     * pushes right here (no PendingDispatch destructor), so a failed push frees
     * the marker and is reported: the answer is already committed.
     */
    private function queueTrailing(int $slideRunId, int $windowMs, int $waitMs): void
    {
        $lock = Cache::lock(self::pendingKey($slideRunId), self::PENDING_TTL_SECONDS);

        if (! $lock->get()) {
            return;
        }

        try {
            Bus::dispatch(
                (new BroadcastDeckAggregate($slideRunId, $windowMs, $lock->owner()))
                    ->delay(now()->addMilliseconds($waitMs)),
            );
        } catch (Throwable $exception) {
            $lock->release();
            report($exception);
        }
    }

    private function registry(): SlideTypeRegistry
    {
        return app(SlideTypeRegistry::class);
    }

    // --- Legacy snapshots ---------------------------------------------------------

    private function dispatchSnapshot(string $module, int $sessionId, int $itemId): void
    {
        BroadcastLiveAggregateSnapshot::dispatch($module, $sessionId, $itemId);
    }

    private function quizSnapshot(int $sessionId, int $questionId): array
    {
        $answers = UserQuizAnswer::query()
            ->where('question_id', $questionId)
            ->whereHas('quizParticipant', fn ($query) => $query->where('quiz_session_id', $sessionId))
            ->get(['answer_data']);

        return [
            'session_id' => $sessionId,
            'question_id' => $questionId,
            'total_answers' => $answers->count(),
            'answers' => $this->countAnswerValues($answers->pluck('answer_data')->all()),
        ];
    }

    private function questSnapshot(int $sessionId, int $taskId): array
    {
        $task = QuestTask::find($taskId);
        $completions = QuestTaskCompletion::query()
            ->where('task_id', $taskId)
            ->whereHas('participant', fn ($query) => $query->where('quest_session_id', $sessionId))
            ->get(['completion_data', 'status']);
        $payloads = $completions->pluck('completion_data')->all();

        return [
            'session_id' => $sessionId,
            'task_id' => $taskId,
            'total_answers' => $completions->count(),
            'statuses' => $completions->countBy('status')->all(),
            'answers' => $this->countAnswerValues($payloads),
            'chart' => $this->questChart($task, $payloads, $completions->count()),
        ];
    }

    private function questChart(?QuestTask $task, array $payloads, int $totalAnswers): ?array
    {
        if (! $task) {
            return null;
        }

        $taskType = strtolower((string) $task->task_type);

        if (in_array($taskType, ['ranking', 'sorting', 'shorting'], true)) {
            return $this->rankingChart($task, $payloads, $totalAnswers, $taskType);
        }

        if (in_array($taskType, ['scales', 'scaling'], true)) {
            return $this->scalesChart($task, $payloads, $totalAnswers);
        }

        return null;
    }

    private function rankingChart(QuestTask $task, array $payloads, int $totalAnswers, string $taskType): array
    {
        $questions = $this->taskQuestions($task);
        $optionCount = count($questions);
        $sums = array_fill(0, $optionCount, 0);

        foreach ($payloads as $payload) {
            $ranking = $this->normalizeSelectedArray(
                $this->extractAnswerValue($this->normalizePayload($payload))
            );

            foreach ($ranking as $position => $optionIndex) {
                $index = $this->numericIndex($optionIndex);

                if ($index === null || $index < 0 || $index >= $optionCount) {
                    continue;
                }

                $rankValue = $optionCount - (int) $position;
                if ($rankValue > 0) {
                    $sums[$index] += $rankValue;
                }
            }
        }

        $maxSum = $sums ? max($sums) : 0;
        $scores = [];

        foreach ($sums as $index => $sum) {
            $scores[(string) $index] = $maxSum > 0 ? (int) round(($sum * 100) / $maxSum) : 0;
        }

        return [
            'type' => $taskType,
            'value_type' => 'percentage',
            'total_answers' => $totalAnswers,
            'scores' => (object) $scores,
            'order' => $this->scoreOrder($scores),
        ];
    }

    private function scalesChart(QuestTask $task, array $payloads, int $totalAnswers): array
    {
        $questions = $this->taskQuestions($task);
        $optionCount = count($questions);
        $taskData = is_array($task->task_data) ? $task->task_data : [];
        $scaleMax = is_numeric($taskData['maxNumber'] ?? null) ? (float) $taskData['maxNumber'] : 5.0;
        $highestValue = max((int) ceil(max($scaleMax, 1) / 5) * 5, 1);
        $sums = array_fill(0, $optionCount, 0.0);
        $counts = array_fill(0, $optionCount, 0);

        foreach ($payloads as $payload) {
            $values = $this->normalizeSelectedArray(
                $this->extractAnswerValue($this->normalizePayload($payload))
            );

            foreach ($values as $position => $value) {
                $positionIndex = $this->numericIndex($position);

                if ($positionIndex === null || $positionIndex < 0 || $positionIndex >= $optionCount || ! is_numeric($value)) {
                    continue;
                }

                $sums[$positionIndex] += (float) $value;
                $counts[$positionIndex]++;
            }
        }

        $scores = [];

        foreach ($sums as $index => $sum) {
            $scores[(string) $index] = $counts[$index] > 0
                ? (int) round(($sum / ($highestValue * $counts[$index])) * 100)
                : 0;
        }

        return [
            'type' => 'scales',
            'value_type' => 'percentage',
            'total_answers' => $totalAnswers,
            'scores' => (object) $scores,
            'order' => $this->scoreOrder($scores),
            'highest_value' => $highestValue,
        ];
    }

    private function taskQuestions(QuestTask $task): array
    {
        $taskData = is_array($task->task_data) ? $task->task_data : [];
        $questions = $taskData['questions'] ?? [];

        return is_array($questions) ? $questions : [];
    }

    private function scoreOrder(array $scores): array
    {
        $order = array_keys($scores);

        usort($order, function (string $left, string $right) use ($scores) {
            $scoreDiff = ($scores[$right] ?? 0) <=> ($scores[$left] ?? 0);

            return $scoreDiff !== 0 ? $scoreDiff : ((int) $left <=> (int) $right);
        });

        return array_map('intval', $order);
    }

    private function countAnswerValues(array $payloads): array
    {
        $counts = [];

        foreach ($payloads as $payload) {
            $value = $this->extractAnswerValue($this->normalizePayload($payload));
            $key = is_array($value) ? json_encode($value, JSON_UNESCAPED_UNICODE) : (string) $value;
            $key = $key !== '' ? $key : 'submitted';
            $counts[$key] = ($counts[$key] ?? 0) + 1;
        }

        ksort($counts);

        return $counts;
    }

    private function normalizePayload(mixed $payload): array
    {
        if (is_array($payload)) {
            return $payload;
        }

        $decoded = json_decode((string) $payload, true);

        return is_array($decoded) ? $decoded : [];
    }

    private function normalizeSelectedArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (is_string($value)) {
            $decoded = json_decode($value, true);

            if (is_array($decoded)) {
                return $decoded;
            }
        }

        return $value === null || $value === '' ? [] : [$value];
    }

    private function numericIndex(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value;
        }

        if (is_numeric($value)) {
            return (int) $value;
        }

        return null;
    }

    private function extractAnswerValue(array $payload): mixed
    {
        foreach (['selected_option', 'selected_options', 'answer', 'value', 'option', 'choice'] as $key) {
            if (array_key_exists($key, $payload)) {
                return $payload[$key];
            }
        }

        return 'submitted';
    }
}
