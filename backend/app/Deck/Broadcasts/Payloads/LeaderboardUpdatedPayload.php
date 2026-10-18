<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Models\Deck\DeckSessionSlideRun;

/**
 * `leaderboard.updated` (Quiz plan §1.4): a leaderboard slide became the
 * current slide. Public: the top N by total_points with each player's
 * points_delta from the last revealed slide (the "+94" animation). Too big
 * for one Reverb publish (very long names) → slim, `leaderboard: null` and
 * `refetch: true`; clients then GET .../leaderboard.
 */
final readonly class LeaderboardUpdatedPayload implements BroadcastPayload
{
    public string $serverTime;

    /**
     * @param  list<array{rank:int, participant_id:int, display_name:?string, emoji_avatar:?string, total_points:int, points_delta:int}>|null  $leaderboard
     */
    public function __construct(
        public int $slideRunId,
        public int $topN,
        public ?array $leaderboard,
        public bool $refetch = false,
        ?string $serverTime = null,
    ) {
        $this->serverTime = $serverTime ?? now()->toISOString();
    }

    public static function fromRun(DeckSessionSlideRun $run, array $leaderboard, int $topN): self
    {
        return new self((int) $run->id, $topN, array_values($leaderboard));
    }

    public function slim(): self
    {
        return new self($this->slideRunId, $this->topN, null, true, $this->serverTime);
    }

    public function eventName(): string
    {
        return 'leaderboard.updated';
    }

    public function visibility(): string
    {
        return self::VISIBILITY_PUBLIC;
    }

    public function toArray(): array
    {
        return [
            'slide_run_id' => $this->slideRunId,
            'top_n' => $this->topN,
            'leaderboard' => $this->leaderboard,
            'refetch' => $this->refetch,
            'server_time' => $this->serverTime,
        ];
    }
}
