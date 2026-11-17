<?php

namespace App\Jobs\Deck;

use App\Deck\Sessions\SessionStateMachine;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Jobs\SyncJob;

/**
 * A timed slide-run transition (plan §3.2): get_ready → voting when the
 * countdown ends, voting → closed when the time limit runs out. Queued with a
 * delay by SessionStateMachine; carries what it expects to find so a stale
 * job (the host already closed or left the slide, which bumps state_version)
 * never touches the wrong slide.
 *
 * SessionStateMachine delays it to the deadline rounded UP to a whole second
 * (queue delays are whole Unix seconds), so it normally never starts early.
 * If it does (clock skew, a manual retry), it re-queues itself (release) and
 * never sleeps: the default worker it shares with the aggregate broadcasts
 * must not stall. The transition itself happens in
 * SessionStateMachine::applyTimer(), which locks the session and run rows and
 * re-checks run, state, version and deadline. If no worker ever runs it, the
 * next state read applies the overdue transition (SessionStateMachine::syncDue).
 */
class TransitionSlideRunJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public function __construct(
        public readonly int $sessionId,
        public readonly int $slideRunId,
        public readonly int $expectedStateVersion,
        public readonly string $expectedState,
    ) {}

    public function handle(SessionStateMachine $machine): void
    {
        $waitMs = $machine->timerWaitMs($this->sessionId, $this->slideRunId, $this->expectedStateVersion, $this->expectedState);

        if ($waitMs === null) {
            return; // stale: the run moved on
        }

        if ($waitMs > 0) {
            // The sync driver ignores delays and runs this inside the request:
            // the next state read applies the transition when it is due.
            if (! $this->job instanceof SyncJob) {
                $this->release(max(1, (int) ceil($waitMs / 1000)));
            }

            return;
        }

        $machine->applyTimer($this->sessionId, $this->slideRunId, $this->expectedStateVersion, $this->expectedState);
    }
}
