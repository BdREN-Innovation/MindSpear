<?php

namespace App\Deck\Sessions;

use App\Deck\Broadcasts\DeckBroadcaster;
use App\Deck\Broadcasts\DeckChannels;
use App\Deck\Broadcasts\Payloads\SessionEndedPayload;
use App\Deck\Broadcasts\Payloads\SlideChangedPayload;
use App\Deck\Broadcasts\Payloads\SlideStateChangedPayload;
use App\Deck\Exceptions\DeckException;
use App\Deck\Http\Resources\SessionStatePresenter;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Events\Live\LiveBroadcastEvent;
use App\Jobs\Deck\TransitionSlideRunJob;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Services\Live\LiveAggregateService;
use App\Services\Live\LiveSessionService;
use App\Services\Live\ParticipantTokenService;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Throwable;

/**
 * The live session state machine (plan "Live session state machine", §3.2,
 * §6.5). The server owns every transition; illegal ones answer 409
 * invalid_state with data {slide_run_id, state, state_version} so a client
 * can resync.
 *
 * Per run, by slide type (SlideTypeRegistry):
 * - polls (acceptsAnswers):  waiting → [get_ready →] voting → closed
 *   get_ready only when get_ready_seconds > 0; it ends by itself after the
 *   countdown. voting ends by close_voting, by leaving the slide, by ending
 *   the session or when time_limit_seconds runs out.
 * - Q&A (moderated_feed):    waiting → open → closed (no get_ready, no timer)
 * - content (everything else): stays `waiting`; only navigation applies.
 * A closed run is never reopened.
 *
 * Actions (POST .../advance): start_voting, close_voting, next_slide,
 * previous_slide, jump_to {target_run_id}. Leaving a run that is get_ready,
 * voting or open closes it first; going backwards (previous_slide, or
 * jump_to an earlier slide) away from such a run needs force=true.
 *
 * Every run transition increments state_version, stamps state_started_at
 * (+ voting_started_at / closed_at) and broadcasts slide.state.changed after
 * commit; closing also calls LiveAggregateService::broadcastClosed(). A slide
 * move broadcasts slide.changed and then slide.state.changed for the new
 * current run.
 *
 * Concurrency: every write runs in a transaction that locks the session row
 * first and then the run row(s) (FOR UPDATE), host actions and timer jobs
 * alike, so they serialise. Timed transitions run as delayed
 * TransitionSlideRunJob jobs carrying {session_id, slide_run_id,
 * expected_state_version, expected_state}; a stale job no-ops. syncDue()
 * applies an overdue timer on reads, so a lost or late job can never leave a
 * slide counting down forever.
 */
class SessionStateMachine
{
    public const ACTION_START_VOTING = 'start_voting';

    public const ACTION_CLOSE_VOTING = 'close_voting';

    public const ACTION_NEXT_SLIDE = 'next_slide';

    public const ACTION_PREVIOUS_SLIDE = 'previous_slide';

    public const ACTION_JUMP_TO = 'jump_to';

    public const ACTIONS = [
        self::ACTION_START_VOTING,
        self::ACTION_CLOSE_VOTING,
        self::ACTION_NEXT_SLIDE,
        self::ACTION_PREVIOUS_SLIDE,
        self::ACTION_JUMP_TO,
    ];

    /** waiting → [get_ready →] voting → closed */
    public const KIND_POLL = 'poll';

    /** waiting → open → closed */
    public const KIND_QA = 'qa';

    /** No voting; navigation only. */
    public const KIND_CONTENT = 'content';

    /** A run in one of these states is counting down or taking submissions; leaving it closes it. */
    public const ACTIVE_STATES = [
        DeckSessionSlideRun::STATE_GET_READY,
        DeckSessionSlideRun::STATE_VOTING,
        DeckSessionSlideRun::STATE_OPEN,
    ];

    /**
     * Largest Pusher body for a full `slide.changed` (Reverb rejects requests
     * over REVERB_MAX_REQUEST_SIZE, 10,000 bytes with headers). Bigger ones
     * go out slim with `slide.refetch: true`.
     */
    public const SLIDE_CHANGED_MAX_BYTES = 8_500;

    public function __construct(
        private readonly SlideTypeRegistry $registry,
        private readonly DeckBroadcaster $broadcaster,
        private readonly LiveAggregateService $aggregates,
        private readonly LiveSessionService $live,
        private readonly ParticipantTokenService $tokens,
        private readonly DeckChannels $channels,
    ) {}

    /**
     * Apply a host action. Returns the (locked, updated) session.
     *
     * @throws DeckException 409 invalid_state for an illegal transition or a session that is not live,
     *                       404 when jump_to names a run of another session
     */
    public function advance(DeckSession $session, string $action, ?int $targetRunId = null, bool $force = false): DeckSession
    {
        if (! in_array($action, self::ACTIONS, true)) {
            throw new InvalidArgumentException("Unknown session action [{$action}].");
        }

        // Timers first, committed on their own: the host acts on the state
        // participants already see, and an action that then fails (409/404)
        // must not roll back an overdue transition or its broadcasts.
        $caughtUp = $this->catchUp($session);

        try {
            return DB::transaction(function () use ($session, $action, $targetRunId, $force, $caughtUp) {
                $s = $this->lockSession($session);

                if (! $s->isLive()) {
                    throw DeckException::invalidState('This session is not live.', ['status' => $s->status]);
                }

                $now = now();
                $current = $this->lockCurrentRun($s);
                // A deadline that passed between the catch-up and the lock.
                $timedOut = $this->applyDue($s, $current, $now) || $caughtUp === (int) $current->id;

                match ($action) {
                    self::ACTION_START_VOTING => $this->startVoting($s, $current, $now),
                    // The time limit closed it in this very request: that is what the host asked for.
                    self::ACTION_CLOSE_VOTING => $timedOut && $current->state === DeckSessionSlideRun::STATE_CLOSED
                        ? null
                        : $this->closeVoting($s, $current, $now),
                    self::ACTION_NEXT_SLIDE => $this->nextSlide($s, $current, $now),
                    self::ACTION_PREVIOUS_SLIDE => $this->previousSlide($s, $current, $force, $now),
                    self::ACTION_JUMP_TO => $this->jumpTo($s, $current, $targetRunId, $force, $now),
                };

                return $s;
            });
        } catch (DeckException $exception) {
            // The failed action rolled back a transition that fell due in the
            // window above; commit it now so the 409 data matches the database.
            $this->catchUp($session);

            throw $exception;
        }
    }

    /**
     * Host ends the session: closes any get_ready/voting/open run
     * (broadcastClosed), sets status ended + ended_at, revokes every
     * participant token and broadcasts session.ended.
     *
     * @throws DeckException 409 invalid_state when it already ended
     */
    public function end(DeckSession $session): DeckSession
    {
        return DB::transaction(function () use ($session) {
            $s = $this->lockSession($session);

            if ($s->status === DeckSession::STATUS_ENDED) {
                throw DeckException::invalidState('This session has already ended.', ['status' => $s->status]);
            }

            $now = now();
            $active = DeckSessionSlideRun::query()
                ->where('deck_session_id', $s->id)
                ->whereIn('state', self::ACTIVE_STATES)
                ->orderBy('position_snapshot')
                ->lockForUpdate()
                ->get();

            foreach ($active as $run) {
                $this->close($s, $run->setRelation('session', $s), $now);
            }

            $s->forceFill(['status' => DeckSession::STATUS_ENDED, 'ended_at' => $now])->save();
            $this->tokens->revokeForDeckSession($s);
            $this->broadcaster->broadcast($s, SessionEndedPayload::fromSession($s));

            return $s;
        });
    }

    /**
     * Applies an overdue timed transition of the current run (get_ready whose
     * countdown ended, voting whose time limit ran out). Cheap when nothing
     * is due: one unlocked read. Called on every state read; other Phase 3
     * endpoints (e.g. answer submission) may call it too.
     */
    public function syncDue(DeckSession $session): DeckSession
    {
        $synced = null;
        $this->catchUp($session, $synced);

        return $synced ?? $session;
    }

    /**
     * syncDue() in its own transaction; returns the id of the run it moved
     * (null when nothing was due). $locked receives the re-read session when
     * a transition was attempted.
     */
    private function catchUp(DeckSession $session, ?DeckSession &$locked = null): ?int
    {
        $fresh = DeckSession::query()->whereKey($session->id)->first(['id', 'status', 'current_slide_run_id']);
        if (! $fresh || ! $fresh->isLive() || ! $fresh->current_slide_run_id) {
            return null;
        }

        $run = DeckSessionSlideRun::query()->where('deck_session_id', $fresh->id)->find($fresh->current_slide_run_id);
        if (! $run || ! $this->isDue($run, now())) {
            return null;
        }

        return DB::transaction(function () use ($session, &$locked) {
            $s = $locked = $this->lockSession($session);

            if (! $s->isLive() || ! $s->current_slide_run_id) {
                return null;
            }

            $run = DeckSessionSlideRun::query()
                ->where('deck_session_id', $s->id)
                ->whereKey($s->current_slide_run_id)
                ->lockForUpdate()
                ->first();

            return $run && $this->applyDue($s, $run->setRelation('session', $s), now()) ? (int) $run->id : null;
        });
    }

    /**
     * For TransitionSlideRunJob: ms until the run's timed state ends (0 when
     * already due), or null when the run is no longer what the job expects
     * (stale job).
     */
    public function timerWaitMs(int $sessionId, int $slideRunId, int $expectedVersion, string $expectedState): ?int
    {
        $run = DeckSessionSlideRun::query()->where('deck_session_id', $sessionId)->find($slideRunId);

        if (! $run || (int) $run->state_version !== $expectedVersion || $run->state !== $expectedState) {
            return null;
        }

        $deadline = SlideStateChangedPayload::deadline($run);

        return $deadline ? max(0, $deadline->getTimestampMs() - now()->getTimestampMs()) : null;
    }

    /**
     * The timed transition a TransitionSlideRunJob carries, under the
     * session + run locks. No-op (false) unless the session is live, the run
     * is still its current run with the expected state and state_version,
     * and its deadline has passed.
     */
    public function applyTimer(int $sessionId, int $slideRunId, int $expectedVersion, string $expectedState): bool
    {
        return DB::transaction(function () use ($sessionId, $slideRunId, $expectedVersion, $expectedState) {
            $s = DeckSession::query()->with('deck')->whereKey($sessionId)->lockForUpdate()->first();

            if (! $s || ! $s->isLive() || (int) $s->current_slide_run_id !== $slideRunId) {
                return false;
            }

            $run = DeckSessionSlideRun::query()
                ->where('deck_session_id', $s->id)
                ->whereKey($slideRunId)
                ->lockForUpdate()
                ->first();

            if (! $run || (int) $run->state_version !== $expectedVersion || $run->state !== $expectedState) {
                return false;
            }

            return $this->applyDue($s, $run->setRelation('session', $s), now());
        });
    }

    /** poll | qa | content, from the run's type (unknown types are treated as content). */
    public function kindOf(DeckSessionSlideRun $run): string
    {
        $type = $this->registry->has((string) $run->type_snapshot) ? $this->registry->for($run->type_snapshot) : null;

        return match (true) {
            $type === null => self::KIND_CONTENT,
            $type->revealModel() === SlideTypeContract::REVEAL_MODERATED => self::KIND_QA,
            $type->acceptsAnswers() => self::KIND_POLL,
            default => self::KIND_CONTENT,
        };
    }

    // --- actions ------------------------------------------------------------------

    private function startVoting(DeckSession $s, DeckSessionSlideRun $run, CarbonInterface $now): void
    {
        $kind = $this->kindOf($run);

        if ($kind === self::KIND_CONTENT) {
            throw $this->illegal($run, 'This slide does not take votes.');
        }

        if ($run->state !== DeckSessionSlideRun::STATE_WAITING) {
            throw $this->illegal($run, 'Voting can only start on a slide that is waiting.');
        }

        if ($kind === self::KIND_QA) {
            $this->transition($s, $run, DeckSessionSlideRun::STATE_OPEN, $now, ['voting_started_at' => $now]);

            return;
        }

        if ((int) $run->get_ready_seconds > 0) {
            $this->transition($s, $run, DeckSessionSlideRun::STATE_GET_READY, $now);
            $this->scheduleTimer($s, $run, (int) $run->get_ready_seconds);

            return;
        }

        $this->openVoting($s, $run, $now);
    }

    private function closeVoting(DeckSession $s, DeckSessionSlideRun $run, CarbonInterface $now): void
    {
        if (! in_array($run->state, [DeckSessionSlideRun::STATE_VOTING, DeckSessionSlideRun::STATE_OPEN], true)) {
            throw $this->illegal($run, 'Voting is not open on this slide.');
        }

        $this->close($s, $run, $now);
    }

    private function nextSlide(DeckSession $s, DeckSessionSlideRun $run, CarbonInterface $now): void
    {
        $target = $this->neighbour($s, $run, forward: true)
            ?? throw $this->illegal($run, 'This is already the last slide.');

        $this->moveTo($s, $run, $target, $now);
    }

    private function previousSlide(DeckSession $s, DeckSessionSlideRun $run, bool $force, CarbonInterface $now): void
    {
        $target = $this->neighbour($s, $run, forward: false)
            ?? throw $this->illegal($run, 'This is already the first slide.');

        $this->assertMayGoBack($run, $force);
        $this->moveTo($s, $run, $target, $now);
    }

    private function jumpTo(DeckSession $s, DeckSessionSlideRun $run, ?int $targetRunId, bool $force, CarbonInterface $now): void
    {
        $target = $targetRunId === null ? null : DeckSessionSlideRun::query()
            ->where('deck_session_id', $s->id)
            ->whereKey($targetRunId)
            ->first();

        if (! $target) {
            throw DeckException::notFound('Slide not found in this session.');
        }

        if ($target->id === $run->id) {
            throw $this->illegal($run, 'This slide is already showing.');
        }

        if ($target->position_snapshot < $run->position_snapshot) {
            $this->assertMayGoBack($run, $force);
        }

        $this->moveTo($s, $run, $target, $now);
    }

    // --- transitions ----------------------------------------------------------------

    private function openVoting(DeckSession $s, DeckSessionSlideRun $run, CarbonInterface $now): void
    {
        $this->transition($s, $run, DeckSessionSlideRun::STATE_VOTING, $now, ['voting_started_at' => $now]);

        if ((int) $run->time_limit_seconds > 0) {
            $this->scheduleTimer($s, $run, (int) $run->time_limit_seconds);
        }
    }

    private function close(DeckSession $s, DeckSessionSlideRun $run, CarbonInterface $now): void
    {
        $this->transition($s, $run, DeckSessionSlideRun::STATE_CLOSED, $now, ['closed_at' => $now]);
        $this->aggregates->broadcastClosed($run);
    }

    /** Leaves $from (closing it when active) and makes $to the current run. */
    private function moveTo(DeckSession $s, DeckSessionSlideRun $from, DeckSessionSlideRun $to, CarbonInterface $now): void
    {
        if (in_array($from->state, self::ACTIVE_STATES, true)) {
            $this->close($s, $from, $now);
        }

        $s->forceFill(['current_slide_run_id' => $to->id])->save();
        $to->setRelation('session', $s);

        $total = DeckSessionSlideRun::query()->where('deck_session_id', $s->id)->count();
        $this->broadcaster->broadcast($s, $this->slideChanged($s, $to, $total));
        $this->broadcaster->broadcast($s, SlideStateChangedPayload::fromRun($to));
    }

    private function transition(DeckSession $s, DeckSessionSlideRun $run, string $state, CarbonInterface $now, array $stamps = []): void
    {
        $run->forceFill([
            'state' => $state,
            'state_version' => (int) $run->state_version + 1,
            'state_started_at' => $now,
            ...$stamps,
        ])->save();

        $this->broadcaster->broadcast($s, SlideStateChangedPayload::fromRun($run));
    }

    /** get_ready → voting, voting → closed when the deadline passed. True when something changed. */
    private function applyDue(DeckSession $s, DeckSessionSlideRun $run, CarbonInterface $now): bool
    {
        if (! $this->isDue($run, $now)) {
            return false;
        }

        $run->state === DeckSessionSlideRun::STATE_GET_READY
            ? $this->openVoting($s, $run, $now)
            : $this->close($s, $run, $now);

        return true;
    }

    private function isDue(DeckSessionSlideRun $run, CarbonInterface $now): bool
    {
        if (! in_array($run->state, [DeckSessionSlideRun::STATE_GET_READY, DeckSessionSlideRun::STATE_VOTING], true)) {
            return false;
        }

        $deadline = SlideStateChangedPayload::deadline($run);

        return $deadline !== null && $deadline->getTimestampMs() <= $now->getTimestampMs();
    }

    /**
     * `slide.changed` with the participant serialisation of $to, or a slim
     * slide ({id, slide_id, type, category, reveal_model, accepts_answers,
     * position, state, state_version, refetch: true}) when the full one would
     * not fit Reverb's request limit (SLIDE_CHANGED_MAX_BYTES). Authoring
     * keeps slides under that budget, but a slide stored before it (or whose
     * media URL grew) must still reach participants; they load the full run
     * from GET .../state when `slide.refetch` is true.
     */
    private function slideChanged(DeckSession $s, DeckSessionSlideRun $to, int $total): SlideChangedPayload
    {
        $slide = SessionStatePresenter::participantRun($to);
        $payload = SlideChangedPayload::fromRun($to, $slide, $total);

        if ($this->publishBytes($s, $payload) <= self::SLIDE_CHANGED_MAX_BYTES) {
            return $payload;
        }

        $slim = array_intersect_key($slide, array_flip(['id', 'slide_id', 'type', 'category', 'reveal_model', 'accepts_answers', 'position', 'state', 'state_version']));

        return SlideChangedPayload::fromRun($to, $slim + ['refetch' => true], $total);
    }

    /** Size of the Pusher HTTP body Reverb receives for $payload (data is JSON inside JSON). */
    private function publishBytes(DeckSession $s, SlideChangedPayload $payload): int
    {
        $channel = $this->channels->for($s, $payload);
        $event = LiveBroadcastEvent::fromPayload($payload, $channel, [
            'module' => $s->product(),
            'session_id' => $s->id,
            'broadcasted_at' => now()->toISOString(),
        ]);

        $body = json_encode([
            'name' => $event->broadcastAs(),
            'data' => json_encode($event->broadcastWith() + ['socket' => null]),
            'channels' => [$channel],
        ]);

        return $body === false ? PHP_INT_MAX : strlen($body);
    }

    /**
     * Queues the run's timed transition after commit; a failed push is covered by syncDue().
     *
     * Queue delays are whole Unix seconds (availableAt() drops the fraction),
     * so the delay is the run's deadline rounded UP to the next whole second:
     * the job never becomes runnable before the deadline and never has to
     * sleep inside the shared worker (at most ~1 s late, which syncDue() and
     * the clients' own countdowns absorb).
     */
    private function scheduleTimer(DeckSession $s, DeckSessionSlideRun $run, int $seconds): void
    {
        $deadline = SlideStateChangedPayload::deadline($run) ?? now()->addSeconds($seconds);
        $runAt = $deadline->copy();
        if ((int) $runAt->format('u') !== 0) {
            $runAt = $runAt->addSecond()->startOfSecond();
        }

        $job = (new TransitionSlideRunJob((int) $s->id, (int) $run->id, (int) $run->state_version, $run->state))
            ->delay($runAt);

        $this->live->afterCommit(function () use ($job) {
            try {
                Bus::dispatch($job);
            } catch (Throwable $exception) {
                report($exception);
            }
        });
    }

    // --- helpers --------------------------------------------------------------------

    private function lockSession(DeckSession $session): DeckSession
    {
        $locked = DeckSession::query()->whereKey($session->id)->lockForUpdate()->first();

        if (! $locked) {
            throw DeckException::notFound('Session not found.');
        }

        return $locked->setRelation('deck', $session->relationLoaded('deck') ? $session->deck : $locked->deck()->first());
    }

    private function lockCurrentRun(DeckSession $s): DeckSessionSlideRun
    {
        $run = $s->current_slide_run_id === null ? null : DeckSessionSlideRun::query()
            ->where('deck_session_id', $s->id)
            ->whereKey($s->current_slide_run_id)
            ->lockForUpdate()
            ->first();

        if (! $run) {
            throw DeckException::invalidState('This session has no current slide.');
        }

        return $run->setRelation('session', $s);
    }

    private function neighbour(DeckSession $s, DeckSessionSlideRun $run, bool $forward): ?DeckSessionSlideRun
    {
        return DeckSessionSlideRun::query()
            ->where('deck_session_id', $s->id)
            ->where('position_snapshot', $forward ? '>' : '<', $run->position_snapshot)
            ->orderBy('position_snapshot', $forward ? 'asc' : 'desc')
            ->first();
    }

    private function assertMayGoBack(DeckSessionSlideRun $run, bool $force): void
    {
        if (! $force && in_array($run->state, self::ACTIVE_STATES, true)) {
            throw $this->illegal(
                $run,
                'Voting is still open on this slide. Send force=true to close it and go back.',
                ['requires_force' => true],
            );
        }
    }

    private function illegal(DeckSessionSlideRun $run, string $message, array $extra = []): DeckException
    {
        return DeckException::invalidState($message, [
            'slide_run_id' => (int) $run->id,
            'state' => $run->state,
            'state_version' => (int) $run->state_version,
            ...$extra,
        ]);
    }
}
