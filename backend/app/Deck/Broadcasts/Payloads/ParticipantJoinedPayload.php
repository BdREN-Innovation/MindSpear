<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Models\Deck\DeckParticipant;

/**
 * `participant.joined`: someone joined the session (host lobby / "recent
 * joins" ticker). Host only: it names the participant. The public side only
 * learns the new count through ParticipantCountUpdatedPayload.
 */
final readonly class ParticipantJoinedPayload implements BroadcastPayload
{
    public string $serverTime;

    public function __construct(
        public int $participantId,
        public ?string $displayName,
        public ?string $emojiAvatar,
        public ?string $joinedAt,
        public ?int $slideRunId = null,
        ?string $serverTime = null,
    ) {
        $this->serverTime = $serverTime ?? now()->toISOString();
    }

    /** $slideRunId: the session's current run when they joined (null in the lobby). */
    public static function fromParticipant(DeckParticipant $participant, ?int $slideRunId = null): self
    {
        return new self(
            participantId: $participant->id,
            displayName: $participant->display_name,
            emojiAvatar: $participant->emoji_avatar,
            joinedAt: $participant->joined_at?->toISOString(),
            slideRunId: $slideRunId,
        );
    }

    public function eventName(): string
    {
        return 'participant.joined';
    }

    public function visibility(): string
    {
        return self::VISIBILITY_HOST;
    }

    public function toArray(): array
    {
        return [
            'slide_run_id' => $this->slideRunId,
            'participant_id' => $this->participantId,
            'display_name' => $this->displayName,
            'emoji_avatar' => $this->emojiAvatar,
            'joined_at' => $this->joinedAt,
            'server_time' => $this->serverTime,
        ];
    }
}
