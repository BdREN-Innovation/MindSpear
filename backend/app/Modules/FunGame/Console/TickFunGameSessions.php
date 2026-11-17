<?php

namespace App\Modules\FunGame\Console;

use App\Modules\FunGame\Models\FunGameSession;
use App\Modules\FunGame\Services\FunGameLogger;
use App\Modules\FunGame\Services\SessionEngine;
use Illuminate\Console\Command;
use Throwable;

/**
 * Applies due transitions (scheduled start, players' expired deadlines,
 * all players finished, hard end, finalisation fallback) for sessions nobody is currently requesting, so
 * broadcasts go out on time. Run with --loop as a long-lived process.
 */
class TickFunGameSessions extends Command
{
    protected $signature = 'fun-games:tick
        {--loop : Keep running, ticking once a second}
        {--max-runtime=3600 : With --loop, exit after this many seconds so the supervisor restarts a fresh process}';

    protected $description = 'Advance Fun Games sessions whose deadlines have passed';

    public function handle(SessionEngine $engine, FunGameLogger $logger): int
    {
        if (! $this->option('loop')) {
            $this->tick($engine, $logger);

            return self::SUCCESS;
        }

        $logger->info('tick.loop_started', ['pid' => getmypid()]);
        $stopAt = microtime(true) + (int) $this->option('max-runtime');
        while (microtime(true) < $stopAt) {
            $started = microtime(true);
            $this->tick($engine, $logger);
            $elapsed = microtime(true) - $started;
            usleep((int) max(0, (1 - $elapsed) * 1_000_000));
        }
        $logger->info('tick.loop_stopped', ['pid' => getmypid()]);

        return self::SUCCESS;
    }

    private function tick(SessionEngine $engine, FunGameLogger $logger): void
    {
        try {
            $due = FunGameSession::query()
                ->where(function ($q) {
                    $q->where(fn ($w) => $w->where('status', FunGameSession::STATUS_WAITING)->where('starts_at', '<=', now()))
                        // Live sessions always: players' deadlines pass while nobody is asking.
                        ->orWhereIn('status', [FunGameSession::STATUS_LIVE, FunGameSession::STATUS_FINISHING]);
                })
                ->limit(200)
                ->get();
        } catch (Throwable $e) {
            $logger->error('tick.query_failed', [], $e);

            return;
        }

        foreach ($due as $session) {
            try {
                $before = $session->status;
                $after = $engine->sync($session);
                if ($before !== $after->status) {
                    $logger->info('tick.advanced', [
                        'session_id' => $session->id,
                        'from' => $before,
                        'to' => $after->status,
                    ]);
                }
            } catch (Throwable $e) {
                $logger->error('tick.session_failed', ['session_id' => $session->id], $e);
            }
        }
    }
}
