<?php

namespace App\Modules\FunGame\Services;

use App\Events\Live\ImmediateLiveBroadcastEvent;
use App\Modules\FunGame\Models\FunGameSession;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Sends `{type, data, server_time}` envelopes over Reverb once the surrounding
 * transaction commits. Participants listen on the public channel
 * `session.fungame.{key}`; the host on the private `host.fungame.{id}`.
 */
class FunGameBroadcaster
{
    public function __construct(private readonly FunGameLogger $logger) {}

    public static function publicChannel(FunGameSession $session): string
    {
        return "session.fungame.{$session->public_channel_key}";
    }

    public static function hostChannel(FunGameSession $session): string
    {
        return "host.fungame.{$session->id}";
    }

    public function toParticipants(FunGameSession $session, string $type, array $data): void
    {
        $this->send($session, self::publicChannel($session), false, $type, $data);
    }

    public function toHost(FunGameSession $session, string $type, array $data): void
    {
        $this->send($session, self::hostChannel($session), true, $type, $data);
    }

    public function toEveryone(FunGameSession $session, string $type, array $data): void
    {
        $this->toParticipants($session, $type, $data);
        $this->toHost($session, $type, $data);
    }

    private function send(FunGameSession $session, string $channel, bool $private, string $type, array $data): void
    {
        $sessionId = $session->id;

        DB::afterCommit(function () use ($sessionId, $channel, $private, $type, $data) {
            try {
                broadcast(new ImmediateLiveBroadcastEvent($channel, $type, [
                    'type' => $type,
                    'data' => $data,
                    'server_time' => TimerService::iso(now()),
                ], $private));
            } catch (Throwable $e) {
                $this->logger->error('broadcast.failed', [
                    'session_id' => $sessionId,
                    'channel' => $channel,
                    'type' => $type,
                ], $e);
            }
        });
    }
}
