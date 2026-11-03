<?php

namespace App\Deck\Sessions;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Deck\Broadcasts\DeckBroadcaster;
use App\Deck\Broadcasts\DeckChannels;
use App\Deck\Broadcasts\Payloads\LeaderboardUpdatedPayload;
use App\Deck\Broadcasts\Payloads\ParticipantCountUpdatedPayload;
use App\Deck\Broadcasts\Payloads\PublishSize;
use App\Deck\Broadcasts\Payloads\SessionEndedPayload;
use App\Deck\Broadcasts\Payloads\SlideChangedPayload;
use App\Deck\Broadcasts\Payloads\SlideStateChangedPayload;
use App\Deck\Broadcasts\Payloads\SpinStartedPayload;
use App\Deck\Exceptions\DeckException;
use App\Deck\Http\Resources\SessionStatePresenter;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Jobs\Deck\TransitionSlideRunJob;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Deck\Broadcasts\LiveAggregateService;
use App\Deck\Participants\ParticipantTokenService;
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
 * - quiz (acceptsAnswers + hidden_until_reveal):
 *                            waiting → [get_ready →] voting → reveal
 *   Like a poll, except that voting ends in `reveal` instead of `closed`:
 *   by the `reveal` action (close_voting does the same), the time limit,
 *   every participant having answered (revealIfAllAnswered), leaving the
 *   slide or ending the session. Reveal broadcasts slide.revealed
 *   (LiveAggregateService::broadcastRevealed).
 * - spinner (types with spin()): waiting → voting (spinning) → reveal
 *   start_voting spins: spin() picks the option, `spin.started` goes out and
 *   the run reveals itself after time_limit_seconds (the spin length the
 *   launcher snapshots: config.spin_duration_ms rounded up to seconds, else
 *   config deck.quiz.spin_seconds), or on `reveal`.
 * - Q&A (moderated_feed):    waiting → open → closed (no get_ready, no timer)
 * - content (everything else, the leaderboard included): stays `waiting`;
 *   only navigation applies. Moving onto a leaderboard run broadcasts
 *   `leaderboard.updated`.
 * A closed or revealed run is never reopened.
 *
 * Actions (POST .../advance): start_voting, close_voting, reveal, next_slide,
 * previous_slide, jump_to {target_run_id}, insert_leaderboard (quiz: a new
 * leaderboard run right after the current one, which it then moves to, like
 * next_slide; later runs shift down one position). Leaving a run that is get_ready,
 * voting or open ends it first (closed, or reveal for quiz and spinner
 * runs); going backwards (previous_slide, or jump_to an earlier slide) away
 * from such a run needs force=true.
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

    /** Quiz: end answering now and show the correct answer (spinner: stop the wheel). */
    public const ACTION_REVEAL = 'reveal';

    public const ACTION_NEXT_SLIDE = 'next_slide';

    public const ACTION_PREVIOUS_SLIDE = 'previous_slide';

    public const ACTION_JUMP_TO = 'jump_to';

    /** Quiz: show a leaderboard now (a new leaderboard run right after the current one). */
    public const ACTION_INSERT_LEADERBOARD = 'insert_leaderboard';

    public const ACTIONS = [
        self::ACTION_START_VOTING,
        self::ACTION_CLOSE_VOTING,
        self::ACTION_REVEAL,
        self::ACTION_NEXT_SLIDE,
        self::ACTION_PREVIOUS_SLIDE,
        self::ACTION_JUMP_TO,
        self::ACTION_INSERT_LEADERBOARD,
    ];

    /** Actions only quiz sessions take (AdvanceSessionRequest drops them on other routes). */
    public const QUIZ_ACTIONS = [self::ACTION_REVEAL, self::ACTION_INSERT_LEADERBOARD];

    /** waiting → [get_ready →] voting → closed */
    public const KIND_POLL = 'poll';

    /** waiting → open → closed */
    public const KIND_QA = 'qa';

    /** waiting → [get_ready →] voting → reveal (hidden_until_reveal, scored). */
    public const KIND_QUIZ = 'quiz';

    /** waiting → voting (spinning) → reveal (spinner_wheel). */
    public const KIND_SPIN = 'spin';

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
        private readonly ParticipantTokenService $tokens,
        private readonly DeckChannels $channels,
        private readonly QuizRuntime $quiz,
    ) {}

    /**
     * Apply a host action. Returns the (locked, updated) session.
     *
     * $start (next_slide, jump_to): when the slide moved onto is a poll or quiz question that
     * has not run yet, start it in the same step, so its get-ready countdown begins at once
     * (Q&A, spinner and content slides still wait for start_voting / navigation).
     *
     * @throws DeckException 409 invalid_state for an illegal transition or a session that is not live,
     *                       404 when jump_to names a run of another session
     */
    public function advance(DeckSession $session, string $action, ?int $targetRunId = null, bool $force = false, bool $start = false): DeckSession
    {
        if (! in_array($action, self::ACTIONS, true)) {
            throw new InvalidArgumentException("Unknown session action [{$action}].");
        }

        // Timers first, committed on their own: the host acts on the state
        // participants already see, and an action that then fails (409/404)
        // must not roll back an overdue transition or its broadcasts.
        $caughtUp = $this->catchUp($session);

        try {
            return DB::transaction(function () use ($session, $action, $targetRunId, $force, $start, $caughtUp) {
                $s = $this->lockSession($session);

                if (! $s->isLive()) {
                    throw DeckException::invalidState('This session is not live.', ['status' => $s->status]);
                }

                $now = now();
                $current = $this->lockCurrentRun($s);
                // A deadline that passed between the catch-up and the lock.
                $timedOut = $this->applyDue($s, $current, $now) || $caughtUp === (int) $current->id;

                // The time limit ended it in this very request: that is what the host asked for.
                $endedByTimer = $timedOut && $current->isFinal();

                match ($action) {
                    self::ACTION_START_VOTING => $this->startVoting($s, $current, $now),
                    self::ACTION_CLOSE_VOTING => $endedByTimer ? null : $this->closeVoting($s, $current, $now),
                    self::ACTION_REVEAL => $endedByTimer ? null : $this->revealAction($s, $current, $now),
                    self::ACTION_NEXT_SLIDE => $this->nextSlide($s, $current, $now),
                    self::ACTION_PREVIOUS_SLIDE => $this->previousSlide($s, $current, $force, $now),
                    self::ACTION_JUMP_TO => $this->jumpTo($s, $current, $targetRunId, $force, $now),
                    self::ACTION_INSERT_LEADERBOARD => $this->insertLeaderboard($s, $current, $now),
                };

                if ($start && in_array($action, [self::ACTION_NEXT_SLIDE, self::ACTION_JUMP_TO], true)) {
                    $this->startArrivedQuestion($s, $now);
                }

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
     * (broadcastClosed; quiz and spinner runs are revealed instead), sets
     * status ended + ended_at, revokes every participant token and
     * broadcasts session.ended.
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
                $this->finish($s, $run->setRelation('session', $s), $now);
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
     * Quiz: reveals $slideRunId when it is the session's current run, still
     * voting, and every participant in the session (joined, not left) has
     * an answer on it. AnswerSubmissionService calls it after each accepted
     * answer commits. Locks like a host action (session, then run), so two
     * last answers arriving together reveal once. True when it revealed.
     */
    public function revealIfAllAnswered(DeckSession $session, int $slideRunId): bool
    {
        $run = DeckSessionSlideRun::query()->where('deck_session_id', $session->id)->find($slideRunId);

        if (! $run || $run->state !== DeckSessionSlideRun::STATE_VOTING || $this->kindOf($run) !== self::KIND_QUIZ) {
            return false;
        }

        if (! $this->allAnswered($session, $run)) {
            return false;
        }

        return DB::transaction(function () use ($session, $slideRunId) {
            $s = $this->lockSession($session);

            if (! $s->isLive() || (int) $s->current_slide_run_id !== $slideRunId) {
                return false;
            }

            $run = DeckSessionSlideRun::query()
                ->where('deck_session_id', $s->id)
                ->whereKey($slideRunId)
                ->lockForUpdate()
                ->first();

            if (! $run || $run->state !== DeckSessionSlideRun::STATE_VOTING || ! $this->allAnswered($s, $run)) {
                return false;
            }

            $this->reveal($s, $run->setRelation('session', $s), now());

            return true;
        });
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

    /** poll | quiz | spin | qa | content, from the run's type (unknown types are treated as content). */
    public function kindOf(DeckSessionSlideRun $run): string
    {
        $type = $this->registry->has((string) $run->type_snapshot) ? $this->registry->for($run->type_snapshot) : null;

        return match (true) {
            $type === null => self::KIND_CONTENT,
            $type->revealModel() === SlideTypeContract::REVEAL_MODERATED => self::KIND_QA,
            QuizRuntime::spins($type) => self::KIND_SPIN,
            $type->acceptsAnswers() && $type->revealModel() === SlideTypeContract::REVEAL_HIDDEN => self::KIND_QUIZ,
            $type->acceptsAnswers() => self::KIND_POLL,
            default => self::KIND_CONTENT,
        };
    }

    /** Whether $run ends in `reveal` (quiz and spinner runs) rather than `closed`. */
    public function reveals(DeckSessionSlideRun $run): bool
    {
        return in_array($this->kindOf($run), [self::KIND_QUIZ, self::KIND_SPIN], true);
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

        if ($kind === self::KIND_SPIN) {
            $this->spin($s, $run, $now);

            return;
        }

        if ((int) $run->get_ready_seconds > 0) {
            $this->transition($s, $run, DeckSessionSlideRun::STATE_GET_READY, $now);
            $this->scheduleTimer($s, $run, (int) $run->get_ready_seconds);

            return;
        }

        $this->openVoting($s, $run, $now);
    }

    /** Starts the run just moved onto when it is a poll or quiz question still waiting. */
    private function startArrivedQuestion(DeckSession $s, CarbonInterface $now): void
    {
        $run = $this->lockCurrentRun($s);

        if ($run->state === DeckSessionSlideRun::STATE_WAITING && in_array($this->kindOf($run), [self::KIND_POLL, self::KIND_QUIZ], true)) {
            $this->startVoting($s, $run, $now);
        }
    }

    private function closeVoting(DeckSession $s, DeckSessionSlideRun $run, CarbonInterface $now): void
    {
        if (! in_array($run->state, [DeckSessionSlideRun::STATE_VOTING, DeckSessionSlideRun::STATE_OPEN], true)) {
            throw $this->illegal($run, 'Voting is not open on this slide.');
        }

        // Quiz and spinner runs end in reveal: close_voting is the same as reveal there.
        $this->finish($s, $run, $now);
    }

    /** `reveal`: quiz and spinner runs only, while voting (spinning). */
    private function revealAction(DeckSession $s, DeckSessionSlideRun $run, CarbonInterface $now): void
    {
        if (! $this->reveals($run)) {
            throw $this->illegal($run, 'This slide has no answer to reveal.');
        }

        if ($run->state !== DeckSessionSlideRun::STATE_VOTING) {
            throw $this->illegal($run, 'Only a slide that is taking answers can be revealed.');
        }

        $this->reveal($s, $run, $now);
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

    /**
     * insert_leaderboard (plan §3.2 "insert leaderboard"): a quiz session
     * gets a leaderboard run (the type's default config, no authoring slide)
     * at the position after the current run; every later run moves down one
     * position (two UPDATEs, since unique(deck_session_id, position_snapshot)
     * is checked row by row). Then it is a next_slide onto it: an active
     * current run is revealed, slide.changed (total_slides + 1),
     * slide.state.changed and leaderboard.updated go out.
     */
    private function insertLeaderboard(DeckSession $s, DeckSessionSlideRun $current, CarbonInterface $now): void
    {
        if ($s->product() !== Deck::PRODUCT_QUIZ || ! $this->registry->has(QuizRuntime::LEADERBOARD_TYPE)) {
            throw $this->illegal($current, 'Only a quiz can show a leaderboard.');
        }

        if ($this->quiz->isLeaderboard($current)) {
            throw $this->illegal($current, 'The leaderboard is already showing.');
        }

        $type = $this->registry->for(QuizRuntime::LEADERBOARD_TYPE);
        $position = (int) $current->position_snapshot;
        $later = fn () => DeckSessionSlideRun::query()->where('deck_session_id', $s->id);

        $later()->where('position_snapshot', '>', $position)->update(['position_snapshot' => DB::raw('-(position_snapshot + 1)')]);
        $later()->where('position_snapshot', '<', 0)->update(['position_snapshot' => DB::raw('-position_snapshot')]);

        $run = DeckSessionSlideRun::create([
            'deck_session_id' => $s->id,
            'slide_id' => null,
            'position_snapshot' => $position + 1,
            'type_snapshot' => QuizRuntime::LEADERBOARD_TYPE,
            'title_snapshot' => 'Leaderboard',
            'body_snapshot' => null,
            'config_snapshot' => $type->validateConfig($type->defaultConfig()),
            'options_snapshot' => [],
            'time_limit_seconds' => null,
            'get_ready_seconds' => null,
            'state' => DeckSessionSlideRun::STATE_WAITING,
            'state_version' => 0,
        ]);

        $this->moveTo($s, $current, $run, $now);
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

    /**
     * voting → reveal: answers stop (closed_at), a scored run's points move
     * into total_points (QuizRuntime::applyRevealedPoints, same transaction)
     * and slide.revealed goes out after commit.
     */
    private function reveal(DeckSession $s, DeckSessionSlideRun $run, CarbonInterface $now): void
    {
        $this->transition($s, $run, DeckSessionSlideRun::STATE_REVEAL, $now, ['closed_at' => $now]);
        $this->quiz->applyRevealedPoints($s, $run);
        $this->aggregates->broadcastRevealed($run);
    }

    /** Ends an active run: reveal for quiz and spinner runs, closed otherwise. */
    private function finish(DeckSession $s, DeckSessionSlideRun $run, CarbonInterface $now): void
    {
        $this->reveals($run) ? $this->reveal($s, $run, $now) : $this->close($s, $run, $now);
    }

    /**
     * Spinner start: the type picks the winning option (spin(), weighted),
     * the result is kept on the run (config_snapshot._spin) for resyncs and
     * the reveal, voting (spinning) starts with the spin length as its timer
     * and `spin.started` {option_id, target_angle} goes out.
     */
    private function spin(DeckSession $s, DeckSessionSlideRun $run, CarbonInterface $now): void
    {
        if (($run->options_snapshot ?? []) === []) {
            throw $this->illegal($run, 'This wheel has no options to spin.');
        }

        $result = QuizRuntime::normaliseSpin($this->registry->for($run->type_snapshot)->spin($run));
        $run->config_snapshot = array_replace($run->config_snapshot ?? [], [
            QuizRuntime::SPIN_KEY => $result + ['spun_at' => $now->toISOString()],
        ]);

        $this->transition($s, $run, DeckSessionSlideRun::STATE_VOTING, $now, ['voting_started_at' => $now]);
        $this->broadcaster->broadcast($s, SpinStartedPayload::fromRun($run, $result));

        if ((int) $run->time_limit_seconds > 0) {
            $this->scheduleTimer($s, $run, (int) $run->time_limit_seconds);
        }
    }

    /** Every participant in the session (joined, not left) has an answer on $run. */
    private function allAnswered(DeckSession $s, DeckSessionSlideRun $run): bool
    {
        $participants = ParticipantCountUpdatedPayload::countFor($s);

        if ($participants === 0) {
            return false;
        }

        return ParticipantCountUpdatedPayload::answeredCountFor($run) >= $participants;
    }

    /** Leaves $from (ending it when active) and makes $to the current run. */
    private function moveTo(DeckSession $s, DeckSessionSlideRun $from, DeckSessionSlideRun $to, CarbonInterface $now): void
    {
        if (in_array($from->state, self::ACTIVE_STATES, true)) {
            $this->finish($s, $from, $now);
        }

        $s->forceFill(['current_slide_run_id' => $to->id])->save();
        $to->setRelation('session', $s);

        $total = DeckSessionSlideRun::query()->where('deck_session_id', $s->id)->count();
        $this->broadcaster->broadcast($s, $this->slideChanged($s, $to, $total));
        $this->broadcaster->broadcast($s, SlideStateChangedPayload::fromRun($to));

        if ($this->quiz->isLeaderboard($to)) {
            $this->broadcaster->broadcast($s, $this->leaderboardUpdated($s, $to));
        }
    }

    /** `leaderboard.updated` for a leaderboard run that just became current (top N; slim when too large). */
    private function leaderboardUpdated(DeckSession $s, DeckSessionSlideRun $run): LeaderboardUpdatedPayload
    {
        $payload = LeaderboardUpdatedPayload::fromRun($run, $this->quiz->leaderboard($s, $this->quiz->leaderboardSize($run)), $this->quiz->leaderboardSize($run));

        return $this->publishBytes($s, $payload) <= self::SLIDE_CHANGED_MAX_BYTES ? $payload : $payload->slim();
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

    /** get_ready → voting, voting → closed (quiz / spinner: reveal) when the deadline passed. True when something changed. */
    private function applyDue(DeckSession $s, DeckSessionSlideRun $run, CarbonInterface $now): bool
    {
        if (! $this->isDue($run, $now)) {
            return false;
        }

        $run->state === DeckSessionSlideRun::STATE_GET_READY
            ? $this->openVoting($s, $run, $now)
            : $this->finish($s, $run, $now);

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
    private function publishBytes(DeckSession $s, BroadcastPayload $payload): int
    {
        return PublishSize::bytes($s, $payload);
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

        DB::afterCommit(function () use ($job) {
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
