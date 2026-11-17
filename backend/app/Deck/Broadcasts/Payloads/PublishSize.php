<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Deck\Broadcasts\DeckChannels;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\Deck\DeckSession;

/**
 * Size of the Pusher HTTP body Reverb receives for a deck payload. Reverb
 * rejects publishes over REVERB_MAX_REQUEST_SIZE (10,000 bytes with
 * headers), and Pusher JSON-encodes the event data twice (a JSON string
 * inside the JSON body), so large payloads go out slim instead (MAX_BYTES
 * leaves room for the headers).
 */
final class PublishSize
{
    public const MAX_BYTES = 8_500;

    public static function bytes(DeckSession $session, BroadcastPayload $payload): int
    {
        $channel = app(DeckChannels::class)->for($session, $payload);
        $event = LiveBroadcastEvent::fromPayload($payload, $channel, [
            'module' => $session->product(),
            'session_id' => $session->id,
            'broadcasted_at' => now()->toISOString(),
        ]);

        $body = json_encode([
            'name' => $event->broadcastAs(),
            'data' => json_encode($event->broadcastWith() + ['socket' => null]),
            'channels' => [$channel],
        ]);

        return $body === false ? PHP_INT_MAX : strlen($body);
    }

    public static function fits(DeckSession $session, BroadcastPayload $payload): bool
    {
        return self::bytes($session, $payload) <= self::MAX_BYTES;
    }
}
