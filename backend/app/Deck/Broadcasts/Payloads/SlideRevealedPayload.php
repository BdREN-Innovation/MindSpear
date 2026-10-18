<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Models\Deck\DeckSessionSlideRun;

/**
 * `slide.revealed` (Quiz plan §1.5): a quiz or spinner run moved to
 * `reveal`. Public: the final aggregate including the correct answers, and
 * the leaderboard movement of this run, best new_rank first, at most
 * config('deck.quiz.reveal_leaderboard_limit') rows (`leaderboard_truncated`
 * says more participants scored; each reads their own through my-answer).
 * When the body would not fit a Reverb publish it goes out slim
 * (`aggregate: null`, `refetch: true`): clients then GET .../aggregate.
 * Spinner runs carry `spin` {option_id, target_angle}, quiz runs null.
 */
final readonly class SlideRevealedPayload implements BroadcastPayload
{
    public string $serverTime;

    /**
     * @param  list<array{participant_id:int, points_delta:int, new_total:int, new_rank:int}>  $leaderboardDelta
     */
    public function __construct(
        public int $slideRunId,
        public string $type,
        public int $stateVersion,
        public ?string $closedAt,
        public ?array $aggregate,
        public array $leaderboardDelta = [],
        public bool $leaderboardTruncated = false,
        public ?array $spin = null,
        public bool $refetch = false,
        ?string $serverTime = null,
    ) {
        $this->serverTime = $serverTime ?? now()->toISOString();
    }

    public static function fromRun(DeckSessionSlideRun $run, array $aggregate, array $leaderboardDelta = [], bool $truncated = false, ?array $spin = null): self
    {
        return new self(
            slideRunId: (int) $run->id,
            type: (string) $run->type_snapshot,
            stateVersion: (int) $run->state_version,
            closedAt: $run->closed_at?->toISOString(),
            aggregate: $aggregate,
            leaderboardDelta: array_values($leaderboardDelta),
            leaderboardTruncated: $truncated,
            spin: $spin,
        );
    }

    /** Without the aggregate (clients refetch it); the leaderboard rows stay. */
    public function slim(): self
    {
        return new self(
            $this->slideRunId,
            $this->type,
            $this->stateVersion,
            $this->closedAt,
            null,
            $this->leaderboardDelta,
            $this->leaderboardTruncated,
            $this->spin,
            true,
            $this->serverTime,
        );
    }

    public function eventName(): string
    {
        return 'slide.revealed';
    }

    public function visibility(): string
    {
        return self::VISIBILITY_PUBLIC;
    }

    public function toArray(): array
    {
        return [
            'slide_run_id' => $this->slideRunId,
            'type' => $this->type,
            'state' => DeckSessionSlideRun::STATE_REVEAL,
            'state_version' => $this->stateVersion,
            'closed_at' => $this->closedAt,
            'aggregate' => $this->aggregate,
            'leaderboard_delta' => $this->leaderboardDelta,
            'leaderboard_truncated' => $this->leaderboardTruncated,
            'spin' => $this->spin,
            'refetch' => $this->refetch,
            'server_time' => $this->serverTime,
        ];
    }
}
