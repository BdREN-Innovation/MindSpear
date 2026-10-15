<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Models\Deck\DeckSessionSlideRun;

/**
 * `slide.closed`: voting ended and submissions are rejected from now on.
 * Carries the final aggregate so the last chart never depends on a trailing
 * debounce broadcast. Always public, so pass a null aggregate when
 * participants may not see results (LiveAggregateService::broadcastClosed
 * does this and sends the host the aggregate separately).
 */
final readonly class SlideClosedPayload implements BroadcastPayload
{
    public string $serverTime;

    public function __construct(
        public int $slideRunId,
        public int $stateVersion,
        public ?string $closedAt,
        public ?array $aggregate,
        ?string $serverTime = null,
    ) {
        $this->serverTime = $serverTime ?? now()->toISOString();
    }

    public static function fromRun(DeckSessionSlideRun $run, ?array $finalAggregate): self
    {
        return new self($run->id, $run->state_version, $run->closed_at?->toISOString(), $finalAggregate);
    }

    public function eventName(): string
    {
        return 'slide.closed';
    }

    public function visibility(): string
    {
        return self::VISIBILITY_PUBLIC;
    }

    public function toArray(): array
    {
        return [
            'slide_run_id' => $this->slideRunId,
            'state' => DeckSessionSlideRun::STATE_CLOSED,
            'state_version' => $this->stateVersion,
            'closed_at' => $this->closedAt,
            'total_responses' => $this->aggregate['total_responses'] ?? null,
            'aggregate' => $this->aggregate,
            'server_time' => $this->serverTime,
        ];
    }
}
