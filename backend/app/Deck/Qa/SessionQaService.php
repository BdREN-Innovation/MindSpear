<?php

namespace App\Deck\Qa;

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\DeckRoutes;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckQaQuestion;
use App\Models\Deck\DeckQaUpvote;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * The live-session Q&A API (plan §3.1 Q&A rows, §3.4) on top of
 * LiveQaService. Adds the HTTP-level rules LiveQaService leaves to callers:
 *
 * - Wrong slide type, a session that is not live or a run that is not `open`
 *   is a 409 `invalid_state` with the same extras as
 *   AnswerSubmissionService::assertAccepting(), so one participant-side 409
 *   handler serves both: data.reason (`not_qa_slide` | `session_not_live` |
 *   `not_open`), `session_status`, and `slide_run_id` + `state` +
 *   `state_version` for a resync (`type` too for `not_qa_slide`).
 *   LiveQaService's `slide_run` 422s are mapped to the same shape.
 * - Participants never see or touch hidden questions: hidden means hidden for
 *   every participant, the author included (decision for §3.4's "own question
 *   visible to submitter": no). Upvoting or un-upvoting one is a 404.
 * - With `show_feed_to_participants: false`, participants see (and can
 *   upvote) only their own questions; anyone else's is a 404.
 * - Question submissions are capped per participant per minute
 *   (`deck.qa_questions_per_minute`, default 10; 429 `too_many_requests`).
 *   A slot is reserved with one atomic cache increment before any work, so
 *   parallel requests cannot all pass the check; a submission that fails
 *   gives its slot back, so only stored questions count.
 *
 * Lock order: a submission locks the deck_sessions row FOR SHARE and then the
 * run row FOR SHARE, the same session-then-run order SessionStateMachine
 * (advance, end, syncDue, applyTimer) takes FOR UPDATE. Locking the run first
 * would deadlock with a host action: the question INSERT takes FOR KEY SHARE
 * on the session row (deck_session_id foreign key) while the host holds it
 * FOR UPDATE and waits for the run.
 */
class SessionQaService
{
    public const DEFAULT_FEED_LIMIT = 100;

    public const MAX_FEED_LIMIT = 500;

    public const DEFAULT_QUESTIONS_PER_MINUTE = 10;

    /** DeckException code for the per-participant submission cap (added beside DeckException::CODE_*). */
    public const CODE_TOO_MANY_REQUESTS = 'too_many_requests';

    /** The submission cap's window. */
    public const CAP_WINDOW_SECONDS = 60;

    /** data.reason values of the 409s (AnswerSubmissionService uses session_not_live too). */
    public const REASON_NOT_QA_SLIDE = 'not_qa_slide';

    public const REASON_SESSION_NOT_LIVE = 'session_not_live';

    public const REASON_NOT_OPEN = 'not_open';

    public function __construct(private readonly LiveQaService $qa) {}

    /** A question of $session with its run, session and author emoji loaded; 404 otherwise. */
    public function question(DeckSession $session, int|string $questionId): DeckQaQuestion
    {
        $id = DeckRoutes::id($questionId);

        $question = $id === null ? null : DeckQaQuestion::query()
            ->where('deck_session_id', $session->id)
            ->with(['participant:id,emoji_avatar', 'run'])
            ->find($id);

        if (! $question || ! $question->run) {
            throw DeckException::notFound('Question not found.');
        }

        $question->setRelation('session', $session);
        $question->run->setRelation('session', $session);

        return $question;
    }

    /**
     * Submits $participant's question on $run (its `session` relation set).
     * The session row and then the run row are read FOR SHARE (see the class
     * docblock for why in that order), and the state is checked on those
     * locked rows: a close or end that commits first is seen here, and one
     * that comes later waits for this question.
     *
     * @throws DeckException 409 wrong type / not live / not open, 429 over the cap
     * @throws ValidationException 422 `body` (LiveQaService rules)
     */
    public function submit(DeckSessionSlideRun $run, DeckParticipant $participant, string $body): DeckQaQuestion
    {
        $this->assertQaRun($run);

        $key = self::submitRateKey($participant);
        $max = $this->questionsPerMinute();

        if ($max > 0) {
            $this->reserveSubmitSlot($key, $max);
        }

        try {
            return DB::transaction(fn () => $this->storeQuestion($run, $participant, $body));
        } catch (Throwable $e) {
            // Nothing was stored (broadcast failures after the commit are swallowed by DeckBroadcaster).
            if ($max > 0) {
                RateLimiter::decrement($key, self::CAP_WINDOW_SECONDS);
            }

            throw $e;
        }
    }

    /** The RateLimiter key of $participant's question cap. */
    public static function submitRateKey(DeckParticipant $participant): string
    {
        return 'deck-qa-submit:' . $participant->id;
    }

    /** @return int the question's upvote count after the vote (a repeat vote changes nothing) */
    public function upvote(DeckQaQuestion $question, DeckParticipant $participant): int
    {
        $this->assertVisibleTo($question, $participant);
        $this->assertAcceptingQuestions($question->run);

        return $this->translate(fn () => $this->qa->upvote($question, $participant), $question->run);
    }

    /** @return int the question's upvote count after removing the vote (no vote, no change) */
    public function removeUpvote(DeckQaQuestion $question, DeckParticipant $participant): int
    {
        $this->assertVisibleTo($question, $participant);
        $this->assertAcceptingQuestions($question->run);

        return $this->translate(fn () => $this->qa->removeUpvote($question, $participant), $question->run);
    }

    /**
     * Host moderation; `$flags` is {is_hidden?, is_starred?, is_answered?}
     * with booleans. Allowed in any run or session state (the host may tidy
     * the feed after closing the slide). Returns $question with the stored
     * state.
     */
    public function moderate(DeckQaQuestion $question, array $flags): DeckQaQuestion
    {
        $this->translate(fn () => $this->qa->moderate($question, $flags));

        return $question;
    }

    /**
     * The feed of $run for the host ($participant null: hidden included,
     * starred first) or for $participant (hidden excluded, plus which
     * questions they upvoted; only their own questions when the slide hides
     * the feed). $sort null = the slide's `sort` setting. Readable in any run
     * state, so a reconnect after close still gets the final feed.
     */
    public function feed(DeckSessionSlideRun $run, ?DeckParticipant $participant, ?string $sort = null, ?int $limit = null): QaFeed
    {
        $this->assertQaRun($run);

        $sort = $sort === null ? $this->qa->defaultSort($run) : LiveQaService::normaliseSort($sort);
        $limit = max(1, min($limit ?? self::DEFAULT_FEED_LIMIT, self::MAX_FEED_LIMIT));
        $showFeed = $this->qa->showsFeedToParticipants($run);
        $forHost = $participant === null;
        $ownOnly = ! $forHost && ! $showFeed;

        $query = $this->qa->feedQuery(
            $run,
            $sort,
            includeHidden: $forHost,
            starredFirst: $forHost,
            authorId: $ownOnly ? $participant->id : null,
        );

        $total = (clone $query)->reorder()->count();
        $questions = $query->limit($limit)->get();

        $upvoted = [];
        if (! $forHost && $questions->isNotEmpty()) {
            $upvoted = DeckQaUpvote::query()
                ->where('participant_id', $participant->id)
                ->whereIn('qa_question_id', $questions->modelKeys())
                ->pluck('qa_question_id')
                ->mapWithKeys(fn ($id) => [(int) $id => true])
                ->all();
        }

        return new QaFeed(
            run: $run,
            participant: $participant,
            questions: $questions,
            total: $total,
            limit: $limit,
            sort: $sort,
            showFeedToParticipants: $showFeed,
            ownOnly: $ownOnly,
            upvotedIds: $upvoted,
        );
    }

    /** Whether $participant may see $question at all (see the class docblock). */
    public function visibleTo(DeckQaQuestion $question, DeckParticipant $participant): bool
    {
        if ($question->is_hidden) {
            return false;
        }

        return (int) $question->participant_id === (int) $participant->id
            || $this->qa->showsFeedToParticipants($question->run);
    }

    private function assertVisibleTo(DeckQaQuestion $question, DeckParticipant $participant): void
    {
        if (! $this->visibleTo($question, $participant)) {
            throw DeckException::notFound('Question not found.');
        }
    }

    /**
     * Takes one slot of the per-minute cap: increment-then-compare is a
     * single atomic cache operation, so of N parallel submissions at most the
     * remaining budget get through. Over the cap the slot is given back.
     *
     * @throws DeckException 429 too_many_requests with data.retry_after
     */
    private function reserveSubmitSlot(string $key, int $max): void
    {
        if (RateLimiter::increment($key, self::CAP_WINDOW_SECONDS) <= $max) {
            return;
        }

        RateLimiter::decrement($key, self::CAP_WINDOW_SECONDS);

        throw new DeckException(
            'You are sending questions too quickly. Try again in a moment.',
            429,
            self::CODE_TOO_MANY_REQUESTS,
            ['retry_after' => RateLimiter::availableIn($key)],
        );
    }

    /** submit()'s transaction body: session row, then run row, both FOR SHARE, then the insert. */
    private function storeQuestion(DeckSessionSlideRun $run, DeckParticipant $participant, string $body): DeckQaQuestion
    {
        $session = DeckSession::query()->whereKey($run->deck_session_id)->sharedLock()->first();
        $locked = $session === null ? null : DeckSessionSlideRun::query()
            ->where('deck_session_id', $session->id)
            ->whereKey($run->id)
            ->sharedLock()
            ->first();

        if (! $session || ! $locked) {
            throw DeckException::notFound('Slide not found in this session.');
        }

        $loaded = $run->relationLoaded('session') ? $run->session : null;
        if ($loaded?->relationLoaded('deck')) {
            $session->setRelation('deck', $loaded->deck);
        }
        $locked->setRelation('session', $session);

        $this->assertAcceptingQuestions($locked);

        return $this->translate(fn () => $this->qa->submitQuestion($locked, $participant, $body), $locked);
    }

    private function assertQaRun(DeckSessionSlideRun $run): void
    {
        if ($run->type_snapshot !== LiveQaService::TYPE) {
            throw DeckException::invalidState('This slide does not take audience questions.', [
                'reason' => self::REASON_NOT_QA_SLIDE,
                'slide_run_id' => (int) $run->id,
                'type' => $run->type_snapshot,
            ]);
        }
    }

    private function assertAcceptingQuestions(DeckSessionSlideRun $run): void
    {
        $this->assertQaRun($run);

        if ($error = $this->notAccepting($run)) {
            throw $error;
        }
    }

    /** The 409 for a Q&A run that takes no questions or votes right now; null when it does. */
    private function notAccepting(DeckSessionSlideRun $run): ?DeckException
    {
        $session = $run->session;
        if (! $session?->isLive()) {
            return DeckException::invalidState('This session is not live.', [
                'reason' => self::REASON_SESSION_NOT_LIVE,
                'session_status' => $session?->status,
            ]);
        }

        if ($run->state !== DeckSessionSlideRun::STATE_OPEN) {
            return $this->notOpen($run);
        }

        return null;
    }

    private function notOpen(DeckSessionSlideRun $run, string $message = 'Questions are not open on this slide.'): DeckException
    {
        return DeckException::invalidState($message, [
            'reason' => self::REASON_NOT_OPEN,
            'slide_run_id' => (int) $run->id,
            'state' => $run->state,
            'state_version' => (int) $run->state_version,
        ]);
    }

    /**
     * LiveQaService reports rule breaks as ValidationExceptions keyed by
     * subject. `slide_run` (closed between our check and its own) becomes the
     * same 409 as our own checks, `question` / `participant` a 404; `body`
     * and `flags` stay 422s.
     */
    private function translate(Closure $callback, ?DeckSessionSlideRun $run = null): mixed
    {
        try {
            return $callback();
        } catch (ValidationException $e) {
            $errors = $e->errors();

            if (isset($errors['slide_run'])) {
                $message = (string) ($errors['slide_run'][0] ?? 'Questions are not open on this slide.');

                throw $run === null
                    ? DeckException::invalidState($message, ['reason' => self::REASON_NOT_OPEN])
                    : ($this->notAccepting($run) ?? $this->notOpen($run, $message));
            }

            if (isset($errors['question']) || isset($errors['participant'])) {
                throw DeckException::notFound('Question not found.');
            }

            throw $e;
        }
    }

    private function questionsPerMinute(): int
    {
        return (int) config('deck.qa_questions_per_minute', self::DEFAULT_QUESTIONS_PER_MINUTE);
    }
}
