<?php

namespace App\Deck\Qa\Jobs;

use App\Deck\Qa\LiveQaService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Trailing edge of the per-question upvote debounce. Runs on the default
 * queue and reads the count when it runs, so the last upvote in a burst is
 * never dropped. LiveQaService keeps at most one of these pending per question.
 */
class BroadcastQaUpvoteCount implements ShouldQueue
{
    use Queueable;

    public function __construct(public readonly int $questionId) {}

    public function handle(LiveQaService $qa): void
    {
        $qa->flushUpvoteBroadcast($this->questionId);
    }
}
