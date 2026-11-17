<?php

namespace App\Jobs\Deck;

use App\Deck\Broadcasts\LiveAggregateService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * The trailing broadcast of LiveAggregateService::schedule(). At most one is
 * pending per slide run: schedule() queues it only after taking the run's
 * pending marker, an owned cache lock whose owner travels with the job.
 *
 * Deliberately not ShouldBeUnique: the queue handler force-releases a unique
 * lock after handle() returns, which would free the lock of the next job
 * queued meanwhile and let a third one in. The marker is released by owner,
 * once, right before the job reads the answers. Answers that arrive while it
 * waits out the window are covered by this job; answers after the read
 * queue the next one, so the last state is never lost.
 * Runs on the connection's default queue (the `queue` Docker service).
 */
class BroadcastDeckAggregate implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly int $slideRunId,
        public readonly int $debounceMs,
        public readonly string $pendingOwner,
    ) {}

    public function handle(LiveAggregateService $aggregates): void
    {
        $aggregates->waitForDebounceWindow($this->slideRunId, $this->debounceMs);
        $aggregates->broadcastTrailing($this->slideRunId, $this->pendingOwner);
    }

    /** A job that dies before its read must not block the run's next trailing job until the marker expires. */
    public function failed(?Throwable $exception = null): void
    {
        app(LiveAggregateService::class)->releasePending($this->slideRunId, $this->pendingOwner);
    }
}
