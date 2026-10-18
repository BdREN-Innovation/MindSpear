<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;

/**
 * `participant.count.updated`: how many participants are in the session
 * (joined and not left). The host presenter listens on the public channel
 * too, so one public broadcast serves both.
 */
final readonly class ParticipantCountUpdatedPayload implements BroadcastPayload
{
    public string $serverTime;

    public function __construct(
        public int $participantCount,
        public ?int $slideRunId = null,
        ?string $serverTime = null,
    ) {
        $this->serverTime = $serverTime ?? now()->toISOString();
    }

    public static function fromSession(DeckSession $session): self
    {
        return new self(self::countFor($session), $session->current_slide_run_id);
    }

    /** Participants currently in the session; the one definition every count uses. */
    public static function countFor(DeckSession $session): int
    {
        return $session->participants()->whereNull('left_at')->count();
    }

    /**
     * Answers on $run by participants currently in the session (left_at
     * null): the "x / y answered" x and what auto-reveal compares with countFor().
     */
    public static function answeredCountFor(DeckSessionSlideRun $run): int
    {
        return $run->answers()->whereHas('participant', fn ($query) => $query->whereNull('left_at'))->count();
    }

    public function eventName(): string
    {
        return 'participant.count.updated';
    }

    public function visibility(): string
    {
        return self::VISIBILITY_PUBLIC;
    }

    public function toArray(): array
    {
        return [
            'slide_run_id' => $this->slideRunId,
            'participant_count' => $this->participantCount,
            'server_time' => $this->serverTime,
        ];
    }
}
