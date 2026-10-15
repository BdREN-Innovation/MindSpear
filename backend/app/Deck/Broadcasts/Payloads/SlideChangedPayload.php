<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Models\Deck\DeckSessionSlideRun;

/**
 * `slide.changed`: the host moved the session to another slide. Carries the
 * participant serialisation of the new run so clients can render it without
 * a refetch. That serialisation never holds results; any `aggregate` key is
 * stripped here as well because this goes out on the public channel.
 */
final readonly class SlideChangedPayload implements BroadcastPayload
{
    public array $slide;

    public string $serverTime;

    public function __construct(
        public int $slideRunId,
        public int $position,
        public string $type,
        public string $state,
        public int $stateVersion,
        array $slide = [],
        public ?int $totalSlides = null,
        ?string $serverTime = null,
    ) {
        unset($slide['aggregate']);
        $this->slide = $slide;
        $this->serverTime = $serverTime ?? now()->toISOString();
    }

    /** @param  array  $participantSlide  SlideTypeContract::serializeForParticipant($run) */
    public static function fromRun(DeckSessionSlideRun $run, array $participantSlide = [], ?int $totalSlides = null): self
    {
        return new self(
            slideRunId: $run->id,
            position: $run->position_snapshot,
            type: $run->type_snapshot,
            state: $run->state,
            stateVersion: $run->state_version,
            slide: $participantSlide,
            totalSlides: $totalSlides,
        );
    }

    public function eventName(): string
    {
        return 'slide.changed';
    }

    public function visibility(): string
    {
        return self::VISIBILITY_PUBLIC;
    }

    public function toArray(): array
    {
        return [
            'slide_run_id' => $this->slideRunId,
            'position' => $this->position,
            'total_slides' => $this->totalSlides,
            'type' => $this->type,
            'state' => $this->state,
            'state_version' => $this->stateVersion,
            'slide' => $this->slide,
            'server_time' => $this->serverTime,
        ];
    }
}
