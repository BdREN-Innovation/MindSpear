<?php

namespace App\Deck\Broadcasts;

use App\Deck\Broadcasts\Payloads\ParticipantCountUpdatedPayload;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\Deck\DeckSession;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;
use Throwable;

/**
 * The one way deck code broadcasts. Sends after the surrounding transaction
 * commits, routes host payloads only to the private host channel and public
 * ones only to the public channel, and broadcasts immediately (no queue hop).
 * A failed broadcast is logged, never thrown, so it cannot fail the request
 * that already committed.
 */
class DeckBroadcaster
{
    public function __construct(private readonly DeckChannels $channels) {}

    public function broadcast(DeckSession $session, BroadcastPayload $payload): void
    {
        $visibility = $payload->visibility();
        if (! in_array($visibility, [BroadcastPayload::VISIBILITY_PUBLIC, BroadcastPayload::VISIBILITY_HOST], true)) {
            throw new InvalidArgumentException("Unknown broadcast visibility [{$visibility}] for {$payload->eventName()}.");
        }

        // Resolve names now: the session may change before the commit callback runs.
        $channel = $this->channels->for($session, $payload);
        $meta = [
            'module' => $session->product(),
            'session_id' => $session->id,
        ];

        DB::afterCommit(function () use ($payload, $channel, $meta) {
            try {
                broadcast(LiveBroadcastEvent::fromPayload($payload, $channel, $meta + [
                    'broadcasted_at' => now()->toISOString(),
                ], now: true));
            } catch (Throwable $exception) {
                Log::warning('Deck broadcast failed after database commit.', [
                    'channel' => $channel,
                    'event' => $payload->eventName(),
                    'message' => $exception->getMessage(),
                ]);
            }
        });
    }

    /**
     * `participant.count.updated` for $session, counted after the commit: two
     * joins in concurrent transactions would each count only their own
     * uncommitted row and both report N+1.
     */
    public function broadcastParticipantCount(DeckSession $session): void
    {
        DB::afterCommit(fn () => $this->broadcast($session, ParticipantCountUpdatedPayload::fromSession($session)));
    }
}
