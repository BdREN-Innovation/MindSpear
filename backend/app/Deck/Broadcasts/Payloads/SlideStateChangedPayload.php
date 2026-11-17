<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Models\Deck\DeckSessionSlideRun;
use Carbon\CarbonInterface;

/**
 * `slide.state.changed`: a run moved through the state machine. Clients drop
 * events whose state_version is lower than the one they hold. Countdowns use
 * `ends_at` with `server_time` to correct for clock skew; `seconds_remaining`
 * is the same deadline rounded up, for clients that only need a number, and
 * `duration_seconds` is the full length of the timed state (progress rings
 * draw remaining against it). All three are null when the state is untimed.
 */
final readonly class SlideStateChangedPayload implements BroadcastPayload
{
    public string $serverTime;

    public function __construct(
        public int $slideRunId,
        public string $state,
        public int $stateVersion,
        public ?int $secondsRemaining = null,
        public ?string $endsAt = null,
        public ?int $durationSeconds = null,
        public ?string $stateStartedAt = null,
        public ?string $votingStartedAt = null,
        public ?string $closedAt = null,
        ?string $serverTime = null,
    ) {
        $this->serverTime = $serverTime ?? now()->toISOString();
    }

    /** Timer fields are derived from the run: get_ready counts down get_ready_seconds, voting counts down time_limit_seconds. */
    public static function fromRun(DeckSessionSlideRun $run): self
    {
        $endsAt = self::deadline($run);

        return new self(
            slideRunId: $run->id,
            state: $run->state,
            stateVersion: $run->state_version,
            secondsRemaining: $endsAt ? self::secondsUntil($endsAt) : null,
            endsAt: $endsAt?->toISOString(),
            durationSeconds: $endsAt ? self::duration($run) : null,
            stateStartedAt: $run->state_started_at?->toISOString(),
            votingStartedAt: $run->voting_started_at?->toISOString(),
            closedAt: $run->closed_at?->toISOString(),
        );
    }

    /** Length of the current timed state: get_ready_seconds in get_ready, time_limit_seconds in voting, otherwise null. */
    public static function duration(DeckSessionSlideRun $run): ?int
    {
        $seconds = match ($run->state) {
            DeckSessionSlideRun::STATE_GET_READY => $run->get_ready_seconds,
            DeckSessionSlideRun::STATE_VOTING => $run->time_limit_seconds,
            default => null,
        };

        return $seconds ? (int) $seconds : null;
    }

    /** When the current timed state ends, or null when it is not timed. */
    public static function deadline(DeckSessionSlideRun $run): ?CarbonInterface
    {
        $duration = self::duration($run);
        $startedAt = $run->state === DeckSessionSlideRun::STATE_VOTING
            ? $run->voting_started_at
            : $run->state_started_at;

        return $duration && $startedAt ? $startedAt->copy()->addSeconds($duration) : null;
    }

    private static function secondsUntil(CarbonInterface $deadline): int
    {
        $remainingMs = $deadline->getTimestampMs() - now()->getTimestampMs();

        return max(0, (int) ceil($remainingMs / 1000));
    }

    public function eventName(): string
    {
        return 'slide.state.changed';
    }

    public function visibility(): string
    {
        return self::VISIBILITY_PUBLIC;
    }

    public function toArray(): array
    {
        return [
            'slide_run_id' => $this->slideRunId,
            'state' => $this->state,
            'state_version' => $this->stateVersion,
            'seconds_remaining' => $this->secondsRemaining,
            'ends_at' => $this->endsAt,
            'duration_seconds' => $this->durationSeconds,
            'state_started_at' => $this->stateStartedAt,
            'voting_started_at' => $this->votingStartedAt,
            'closed_at' => $this->closedAt,
            'server_time' => $this->serverTime,
        ];
    }
}
