<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Models\Deck\DeckSessionSlideRun;

/**
 * `slide.submitted_count.updated` (Quiz, hidden_until_reveal): while a quiz
 * run takes answers the public channel only learns how many participants
 * have answered, never what they answered (the aggregate goes to the host
 * channel). Debounced with the host aggregate (LiveAggregateService).
 */
final readonly class SubmittedCountUpdatedPayload implements BroadcastPayload
{
    public string $serverTime;

    public function __construct(
        public int $slideRunId,
        public int $submittedCount,
        public int $participantCount,
        ?string $serverTime = null,
    ) {
        $this->serverTime = $serverTime ?? now()->toISOString();
    }

    public static function fromRun(DeckSessionSlideRun $run, int $submittedCount, int $participantCount): self
    {
        return new self((int) $run->id, $submittedCount, $participantCount);
    }

    public function eventName(): string
    {
        return 'slide.submitted_count.updated';
    }

    public function visibility(): string
    {
        return self::VISIBILITY_PUBLIC;
    }

    public function toArray(): array
    {
        return [
            'slide_run_id' => $this->slideRunId,
            'submitted_count' => $this->submittedCount,
            'participant_count' => $this->participantCount,
            'server_time' => $this->serverTime,
        ];
    }
}
