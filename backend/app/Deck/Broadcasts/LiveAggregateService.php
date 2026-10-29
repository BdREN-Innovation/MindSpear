<?php

namespace App\Deck\Broadcasts;

use App\Deck\Broadcasts\Payloads\ParticipantCountUpdatedPayload;
use App\Deck\Broadcasts\Payloads\SlideAggregateUpdatedPayload;
use App\Deck\Broadcasts\Payloads\SlideClosedPayload;
use App\Deck\Broadcasts\Payloads\SubmittedCountUpdatedPayload;
use App\Deck\Sessions\QuizRuntime;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quest\PollSettings;
use App\Jobs\Deck\BroadcastDeckAggregate;
use App\Models\Deck\DeckSessionSlideRun;
use Closure;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Sleep;
use Throwable;

/**
 * Live results of slide runs: the debounced `slide.aggregate.updated` after
 * answers (schedule), and the final aggregate when a run closes or is
 * revealed. resultsVisibility() decides who may see a run's results.
 */
class LiveAggregateService
{
    /** The debounce timestamp only has to outlive the window; this is generous. */
    private const DEBOUNCE_TTL_SECONDS = 60;

    /** Safety net: if a worker loses a trailing job, its pending marker frees itself. */
    private const PENDING_TTL_SECONDS = 30;

    public function __construct(
        private readonly SlideTypeRegistry $registry,
        private readonly DeckBroadcaster $broadcaster,
        private readonly QuizRuntime $quiz,
    ) {}

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

        DB::afterCommit(function () use ($run, $compute, $windowMs) {
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
     * resultsVisibility() picks. A hidden_until_reveal (Quiz) run that is
     * still taking answers also tells the public channel how many answered
     * (`slide.submitted_count.updated`; participants still in the room), never what.
     */
    public function broadcastDeckAggregateNow(DeckSessionSlideRun $run, ?Closure $compute = null): void
    {
        $aggregate = $compute ? $compute() : $this->registry->aggregate($run);
        $this->broadcaster->broadcast(
            $run->session,
            SlideAggregateUpdatedPayload::fromRun($run, $aggregate, $this->resultsVisibility($run)),
        );

        if (
            $run->state === DeckSessionSlideRun::STATE_VOTING
            && $this->registry->for($run->type_snapshot)->revealModel() === SlideTypeContract::REVEAL_HIDDEN
        ) {
            $this->broadcaster->broadcast($run->session, SubmittedCountUpdatedPayload::fromRun(
                $run,
                ParticipantCountUpdatedPayload::answeredCountFor($run),
                ParticipantCountUpdatedPayload::countFor($run->session),
            ));
        }
    }

    /**
     * Who may see a run's results: the public session channel only for a
     * live_aggregate type whose slide turned on "Show votes to participants"
     * (config_snapshot.show_results_to_participants, default off, plan §5.6);
     * everything else stays on the host channel, so the presenter shows the
     * live chart and participants never receive it. Phase 3's
     * GET /slide-runs/{id}/aggregate must apply the same rule to participants.
     * A revealed run (Quiz, spinner) is public: the reveal shows everyone the
     * results and the correct answer; before it they stay with the host.
     */
    public function resultsVisibility(DeckSessionSlideRun $run): string
    {
        if ($run->state === DeckSessionSlideRun::STATE_REVEAL) {
            return BroadcastPayload::VISIBILITY_PUBLIC;
        }

        return $this->registry->for($run->type_snapshot)->revealModel() === SlideTypeContract::REVEAL_LIVE
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
        DB::afterCommit(function () use ($run) {
            $aggregate = $this->registry->aggregate($run);

            if ($this->resultsVisibility($run) === BroadcastPayload::VISIBILITY_PUBLIC) {
                $this->broadcaster->broadcast($run->session, SlideClosedPayload::fromRun($run, $aggregate));

                return;
            }

            $this->broadcaster->broadcast($run->session, SlideClosedPayload::fromRun($run, null));
            $this->broadcaster->broadcast(
                $run->session,
                SlideAggregateUpdatedPayload::fromRun($run, $aggregate, BroadcastPayload::VISIBILITY_HOST),
            );
        });
    }

    /**
     * `slide.revealed` for a quiz or spinner run that was just moved to
     * `reveal` (Quiz plan §1.5): one public event with the final aggregate
     * (correct answers included), this run's leaderboard_delta and, for a
     * spinner, the spin result. Built after the surrounding transaction
     * commits, when every answer the run will ever have is in.
     */
    public function broadcastRevealed(DeckSessionSlideRun $run): void
    {
        DB::afterCommit(function () use ($run) {
            try {
                $payload = $this->quiz->revealedPayload($run);
            } catch (Throwable $exception) {
                // The reveal is committed; clients still get slide.state.changed and can GET the aggregate.
                report($exception);

                return;
            }

            $this->broadcaster->broadcast($run->session, $payload);
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
}
