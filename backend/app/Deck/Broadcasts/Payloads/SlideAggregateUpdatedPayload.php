<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Models\Deck\DeckSessionSlideRun;

/**
 * `slide.aggregate.updated`: a debounced results snapshot (see
 * LiveAggregateService::schedule). Its visibility comes from
 * LiveAggregateService::resultsVisibility(): public only for live_aggregate
 * types whose slide shows results to participants, host-only otherwise
 * (the default, and always for hidden_until_reveal and moderated_feed).
 */
final readonly class SlideAggregateUpdatedPayload implements BroadcastPayload
{
    public string $serverTime;

    public function __construct(
        public int $slideRunId,
        public int $stateVersion,
        public array $aggregate,
        private string $visibility = self::VISIBILITY_PUBLIC,
        ?string $serverTime = null,
    ) {
        $this->serverTime = $serverTime ?? now()->toISOString();
    }

    public static function fromRun(DeckSessionSlideRun $run, array $aggregate, string $visibility = self::VISIBILITY_PUBLIC): self
    {
        return new self($run->id, $run->state_version, $aggregate, $visibility);
    }

    public function eventName(): string
    {
        return 'slide.aggregate.updated';
    }

    public function visibility(): string
    {
        return $this->visibility;
    }

    public function toArray(): array
    {
        return [
            'slide_run_id' => $this->slideRunId,
            'state_version' => $this->stateVersion,
            'total_responses' => $this->aggregate['total_responses'] ?? null,
            'aggregate' => $this->aggregate,
            'server_time' => $this->serverTime,
        ];
    }
}
