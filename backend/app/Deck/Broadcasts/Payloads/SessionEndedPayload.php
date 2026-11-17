<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Models\Deck\DeckSession;

/**
 * `session.ended`: the host ended the session. Participant tokens are already
 * revoked when this goes out, so participant clients stop calling the API,
 * show their end screen and leave the channel. Public (the host presenter
 * listens there too).
 */
final readonly class SessionEndedPayload implements BroadcastPayload
{
    public string $serverTime;

    public function __construct(
        public int $sessionId,
        public ?int $slideRunId,
        public ?string $endedAt,
        ?string $serverTime = null,
    ) {
        $this->serverTime = $serverTime ?? now()->toISOString();
    }

    public static function fromSession(DeckSession $session): self
    {
        return new self((int) $session->id, $session->current_slide_run_id, $session->ended_at?->toISOString());
    }

    public function eventName(): string
    {
        return 'session.ended';
    }

    public function visibility(): string
    {
        return self::VISIBILITY_PUBLIC;
    }

    public function toArray(): array
    {
        return [
            'slide_run_id' => $this->slideRunId,
            'session_id' => $this->sessionId,
            'status' => DeckSession::STATUS_ENDED,
            'ended_at' => $this->endedAt,
            'server_time' => $this->serverTime,
        ];
    }
}
