<?php

namespace App\Events\Live;

use App\Deck\Broadcasts\BroadcastPayload;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class LiveBroadcastEvent implements ShouldBroadcast
{
    use Dispatchable;
    use SerializesModels;

    /**
     * @param  bool  $now  broadcast in the current process instead of queueing it
     *                     (the framework checks shouldBroadcastNow()).
     */
    public function __construct(
        private readonly string $channelName,
        private readonly string $eventName,
        private readonly array $payload,
        private readonly bool $private = false,
        private readonly bool $now = false,
    ) {}

    /**
     * Wrap a typed deck payload. Host-visibility payloads always go out on a
     * private channel. `$meta` (module, session_id, broadcasted_at...) never
     * overrides the payload's own keys; `event` is always the event name.
     */
    public static function fromPayload(BroadcastPayload $payload, string $channel, array $meta = [], bool $now = false): self
    {
        return new self(
            $channel,
            $payload->eventName(),
            array_merge($meta, $payload->toArray(), ['event' => $payload->eventName()]),
            private: $payload->visibility() === BroadcastPayload::VISIBILITY_HOST,
            now: $now,
        );
    }

    public function broadcastOn(): Channel|PrivateChannel
    {
        return $this->private
            ? new PrivateChannel($this->channelName)
            : new Channel($this->channelName);
    }

    public function broadcastAs(): string
    {
        return $this->eventName;
    }

    public function broadcastWith(): array
    {
        return $this->payload;
    }

    public function shouldBroadcastNow(): bool
    {
        return $this->now;
    }

    public function isPrivate(): bool
    {
        return $this->private;
    }
}
