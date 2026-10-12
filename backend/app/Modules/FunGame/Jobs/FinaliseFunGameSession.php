<?php

namespace App\Modules\FunGame\Jobs;

use App\Modules\FunGame\Services\FunGameLogger;
use App\Modules\FunGame\Services\SessionEngine;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/** Scores and ranks a finished session, then publishes the leaderboard. */
class FinaliseFunGameSession implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public readonly int $sessionId)
    {
        $this->onQueue('fungames');
    }

    public function handle(SessionEngine $engine): void
    {
        $engine->finalise($this->sessionId);
    }

    public function failed(Throwable $exception): void
    {
        app(FunGameLogger::class)->error('session.finalise_job_failed', ['session_id' => $this->sessionId], $exception);
    }
}
