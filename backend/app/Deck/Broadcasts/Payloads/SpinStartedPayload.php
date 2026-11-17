<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Models\Deck\DeckSessionSlideRun;

/**
 * `spin.started` (spinner_wheel): the host started the wheel. The server
 * already picked the winner, so every screen animates to the same
 * `target_angle` (degrees) and lands on `option_id` at `ends_at`, when the
 * run reveals itself (slide.revealed).
 */
final readonly class SpinStartedPayload implements BroadcastPayload
{
    public string $serverTime;

    public function __construct(
        public int $slideRunId,
        public int $stateVersion,
        public int $optionId,
        public float $targetAngle,
        public ?int $durationSeconds,
        public ?string $endsAt,
        ?string $serverTime = null,
    ) {
        $this->serverTime = $serverTime ?? now()->toISOString();
    }

    /** @param array{option_id:int, target_angle:float} $spin */
    public static function fromRun(DeckSessionSlideRun $run, array $spin): self
    {
        return new self(
            (int) $run->id,
            (int) $run->state_version,
            (int) $spin['option_id'],
            (float) $spin['target_angle'],
            SlideStateChangedPayload::duration($run),
            SlideStateChangedPayload::deadline($run)?->toISOString(),
        );
    }

    public function eventName(): string
    {
        return 'spin.started';
    }

    public function visibility(): string
    {
        return self::VISIBILITY_PUBLIC;
    }

    public function toArray(): array
    {
        return [
            'slide_run_id' => $this->slideRunId,
            'state_version' => $this->stateVersion,
            'option_id' => $this->optionId,
            'target_angle' => $this->targetAngle,
            'duration_seconds' => $this->durationSeconds,
            'ends_at' => $this->endsAt,
            'server_time' => $this->serverTime,
        ];
    }
}
