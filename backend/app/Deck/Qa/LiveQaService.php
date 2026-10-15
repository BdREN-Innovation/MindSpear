<?php

namespace App\Deck\Qa;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Deck\Broadcasts\DeckBroadcaster;
use App\Deck\Broadcasts\Payloads\QaQuestionModeratedPayload;
use App\Deck\Broadcasts\Payloads\QaQuestionSubmittedPayload;
use App\Deck\Broadcasts\Payloads\QaQuestionUpvotedPayload;
use App\Deck\Qa\Jobs\BroadcastQaUpvoteCount;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quest\QaAudienceSlideType;
use App\Deck\Support\ProfanityFilter;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckQaQuestion;
use App\Models\Deck\DeckSessionSlideRun;
use App\Services\Live\LiveSessionService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * Audience Q&A on `qa_audience` slides: submit, upvote, host moderation and
 * the feed. Q&A does not fit the answers → aggregate pattern (questions are
 * rows of their own, counts change per upvote), so it lives beside the slide
 * registry instead of inside it.
 *
 * Upvote counts only change through atomic `upvote_count = upvote_count ± 1`
 * updates guarded by the (question, participant) unique key, so concurrent
 * votes never lose an increment and a participant never counts twice.
 */
class LiveQaService
{
    public const TYPE = QaAudienceSlideType::KEY;

    /** Question length limit when the slide's `max_question_length` is missing or unusable. */
    public const MAX_BODY_LENGTH = 280;

    /** Upper bound on `max_question_length` (QaAudienceSlideType validates 10..1000). */
    public const MAX_BODY_LENGTH_CEILING = 1000;

    public const SORT_TOP = 'top';

    public const SORT_NEW = 'new';

    /** A lost trailing job can block trailing broadcasts for at most this long. */
    private const PENDING_TTL_SECONDS = 10;

    private const LAST_BROADCAST_TTL_SECONDS = 60;

    /** Columns moderate() re-reads from the locked row and copies back to the caller's model. */
    private const STORED_STATE_COLUMNS = ['upvote_count', 'is_hidden', 'is_starred', 'is_answered', 'updated_at'];

    /** Moderation flag names accepted by moderate() → column. */
    private const MODERATION_FLAGS = [
        'is_hidden' => 'is_hidden',
        'hide' => 'is_hidden',
        'is_starred' => 'is_starred',
        'star' => 'is_starred',
        'is_answered' => 'is_answered',
        'mark_answered' => 'is_answered',
    ];

    public function __construct(
        private readonly DeckBroadcaster $broadcaster,
        private readonly ProfanityFilter $profanity,
        private readonly LiveSessionService $live,
        private readonly SlideTypeRegistry $slideTypes,
    ) {}

    /**
     * Body is trimmed (Unicode spaces and invisible characters too), must have
     * a visible character and at most the slide's `max_question_length`
     * characters, and is masked unless the slide turns
     * `profanity_filter_enabled` off.
     *
     * @throws ValidationException
     */
    public function submitQuestion(DeckSessionSlideRun $run, DeckParticipant $participant, string $body): DeckQaQuestion
    {
        $this->assertOpenQaRun($run);
        $this->assertParticipantOf($participant, $run->deck_session_id);

        $config = $this->qaConfig($run);
        $max = $this->maxBodyLength($config);
        $body = $this->normaliseBody($body);
        $length = mb_strlen($body);

        if ($length < 1 || $length > $max || ! preg_match('/[\p{L}\p{N}\p{P}\p{S}]/u', $body)) {
            throw ValidationException::withMessages([
                'body' => "A question must be between 1 and {$max} characters.",
            ]);
        }

        if ($this->flag($config, 'profanity_filter_enabled', true)) {
            $body = $this->profanity->mask($body);
        }

        $question = DeckQaQuestion::create([
            'deck_session_id' => $run->deck_session_id,
            'slide_run_id' => $run->id,
            'participant_id' => $participant->id,
            'body' => $body,
            'submitted_at' => now(),
        ]);
        $question->setRelation('participant', $participant);

        $this->broadcaster->broadcast($run->session, QaQuestionSubmittedPayload::fromQuestion(
            $question,
            $this->feedVisibility($run),
        ));

        return $question;
    }

    /**
     * Returns the question's upvote count after the vote. A repeat vote (or
     * one that loses a race on the unique key) changes nothing and returns
     * the current count.
     *
     * @throws ValidationException
     */
    public function upvote(DeckQaQuestion $question, DeckParticipant $participant): int
    {
        $this->assertCanVote($question, $participant);

        if ($question->is_hidden) {
            throw ValidationException::withMessages(['question' => 'This question is no longer available.']);
        }

        [$count, $changed] = DB::transaction(function () use ($question, $participant) {
            // ON CONFLICT DO NOTHING: a duplicate is not an error and does not
            // abort the transaction the way a caught unique violation would.
            $inserted = DB::table('deck_qa_upvotes')->insertOrIgnore([
                'qa_question_id' => $question->id,
                'participant_id' => $participant->id,
            ]);

            if ($inserted === 0) {
                return [$this->currentCount($question->id), false];
            }

            $row = DB::selectOne(
                'update deck_qa_questions set upvote_count = upvote_count + 1 where id = ? returning upvote_count',
                [$question->id],
            );

            return [(int) $row->upvote_count, true];
        });

        return $this->afterVote($question, $count, $changed);
    }

    /**
     * Returns the upvote count after removing the participant's vote. Removing
     * a vote that does not exist changes nothing.
     *
     * @throws ValidationException
     */
    public function removeUpvote(DeckQaQuestion $question, DeckParticipant $participant): int
    {
        $this->assertCanVote($question, $participant);

        [$count, $changed] = DB::transaction(function () use ($question, $participant) {
            $deleted = DB::table('deck_qa_upvotes')
                ->where('qa_question_id', $question->id)
                ->where('participant_id', $participant->id)
                ->delete();

            if ($deleted === 0) {
                return [$this->currentCount($question->id), false];
            }

            $row = DB::selectOne(
                'update deck_qa_questions set upvote_count = greatest(upvote_count - 1, 0) where id = ? returning upvote_count',
                [$question->id],
            );

            return [(int) $row->upvote_count, true];
        });

        return $this->afterVote($question, $count, $changed);
    }

    /**
     * Host moderation. `$flags` takes is_hidden|hide, is_starred|star and
     * is_answered|mark_answered with boolean values. Broadcasts the full state
     * to the host and a redacted copy publicly (a hidden question's body never
     * goes out on the public channel). No change, no broadcast.
     *
     * Works on the locked, freshly read row, never on the caller's copy: that
     * copy may predate another moderation request (hide, then star clicked
     * quickly, or two host views open), and the public redaction must follow
     * the stored is_hidden. The stored state is copied back onto `$question`.
     *
     * @throws ValidationException
     */
    public function moderate(DeckQaQuestion $question, array $flags): void
    {
        if ($flags === []) {
            throw ValidationException::withMessages(['flags' => 'Choose at least one moderation action.']);
        }

        $changes = [];
        foreach ($flags as $flag => $value) {
            $column = self::MODERATION_FLAGS[$flag] ?? null;

            if ($column === null) {
                throw ValidationException::withMessages(["flags.{$flag}" => "Unknown moderation flag [{$flag}]."]);
            }
            if (! is_bool($value)) {
                throw ValidationException::withMessages(["flags.{$flag}" => "The {$flag} flag must be true or false."]);
            }

            $changes[$column] = $value;
        }

        [$stored, $changed] = DB::transaction(function () use ($question, $changes) {
            $stored = DeckQaQuestion::query()->whereKey($question->id)->lockForUpdate()->first();

            if (! $stored) {
                throw ValidationException::withMessages(['question' => 'This question is no longer available.']);
            }

            $stored->fill($changes);

            if (! $stored->isDirty()) {
                return [$stored, false];
            }

            // Saves only the dirty flag columns; upvote_count is never written back.
            $stored->save();

            return [$stored, true];
        });

        $question->forceFill($stored->only(self::STORED_STATE_COLUMNS))
            ->syncOriginalAttributes(self::STORED_STATE_COLUMNS);

        if (! $changed) {
            return;
        }

        $stored->load(['participant', 'run', 'session']);

        $session = $stored->session;
        $this->broadcaster->broadcast($session, QaQuestionModeratedPayload::forHost($stored));

        if ($this->feedVisibility($stored->run) === BroadcastPayload::VISIBILITY_PUBLIC) {
            $this->broadcaster->broadcast($session, QaQuestionModeratedPayload::forPublic($stored));
        }
    }

    /**
     * The feed. 'top' = most upvotes first, older first on ties; 'new' (alias
     * 'newest') = latest first. Hidden questions are left out unless
     * `$includeHidden` (host moderation view). Answered and starred questions
     * are not reordered here; clients group them.
     *
     * @return Collection<int, DeckQaQuestion>
     */
    public function topN(DeckSessionSlideRun $run, int $n, string $sort = self::SORT_TOP, bool $includeHidden = false): Collection
    {
        $sort = self::normaliseSort($sort);

        if ($n < 1) {
            return new Collection();
        }

        return $this->feedQuery($run, $sort, $includeHidden)->limit($n)->get();
    }

    /**
     * The ordered query behind topN(), for callers that also need a count
     * (use ->reorder()->count()) or narrower feeds. `$starredFirst` puts
     * starred questions ahead of the rest (host presenter view), each group
     * keeping `$sort`; `$authorId` keeps only that participant's questions.
     *
     * @return Builder<DeckQaQuestion>
     */
    public function feedQuery(
        DeckSessionSlideRun $run,
        string $sort = self::SORT_TOP,
        bool $includeHidden = false,
        bool $starredFirst = false,
        ?int $authorId = null,
    ): Builder {
        $sort = self::normaliseSort($sort);

        $query = DeckQaQuestion::query()
            ->where('slide_run_id', $run->id)
            ->with('participant:id,emoji_avatar')
            ->when(! $includeHidden, fn ($query) => $query->visible())
            ->when($authorId !== null, fn ($query) => $query->where('participant_id', $authorId))
            ->when($starredFirst, fn ($query) => $query->orderByDesc('is_starred'));

        // Ids follow submission order, so they break ties deterministically.
        return $sort === self::SORT_TOP
            ? $query->orderByDesc('upvote_count')->orderBy('id')
            : $query->orderByDesc('id');
    }

    /**
     * 'top' | 'new' for a requested sort ('newest', the slide config's
     * spelling, is an alias of 'new').
     *
     * @throws InvalidArgumentException for anything else
     */
    public static function normaliseSort(string $sort): string
    {
        return match ($sort) {
            self::SORT_TOP => self::SORT_TOP,
            self::SORT_NEW, 'newest' => self::SORT_NEW,
            default => throw new InvalidArgumentException("Unknown Q&A sort [{$sort}]."),
        };
    }

    /** The run's default feed order ('top' | 'new'), from its `sort` setting. */
    public function defaultSort(DeckSessionSlideRun $run): string
    {
        $sort = $this->qaConfig($run)['sort'] ?? self::SORT_TOP;

        return is_string($sort) && in_array($sort, [self::SORT_TOP, self::SORT_NEW, 'newest'], true)
            ? self::normaliseSort($sort)
            : self::SORT_TOP;
    }

    /** Whether participants see everyone's questions (`show_feed_to_participants`, default on). */
    public function showsFeedToParticipants(DeckSessionSlideRun $run): bool
    {
        return $this->feedVisibility($run) === BroadcastPayload::VISIBILITY_PUBLIC;
    }

    /**
     * Trailing edge of the upvote debounce, run by BroadcastQaUpvoteCount.
     * Waits out the rest of the window (at most qa_upvote_debounce_ms; queue
     * delays only have whole-second precision), clears the pending marker
     * BEFORE reading the count so any vote committed after the read schedules
     * a new trailing broadcast, then sends the count as it is now.
     */
    public function flushUpvoteBroadcast(int $questionId): void
    {
        $window = $this->upvoteWindowMs();
        $last = Cache::get($this->lastBroadcastKey($questionId));
        $remaining = $last === null ? 0 : $window - (now()->getTimestampMs() - (int) $last);

        if ($remaining > 0) {
            usleep(min($remaining, $window) * 1000);
        }

        Cache::forget($this->pendingKey($questionId));
        $this->sendUpvoteCount($questionId);
    }

    private function afterVote(DeckQaQuestion $question, int $count, bool $changed): int
    {
        $this->syncCount($question, $count);

        if ($changed) {
            $questionId = $question->id;
            $this->live->afterCommit(fn () => $this->debounceUpvoteBroadcast($questionId));
        }

        return $count;
    }

    /**
     * Per-question leading + guaranteed-trailing debounce (plan §1.7). The
     * first vote after a quiet window broadcasts at once; votes inside the
     * window schedule one delayed job (at most one pending per question)
     * that broadcasts the count as it is when the job runs. Timestamps are
     * compared in PHP (not via cache TTLs) for millisecond windows.
     */
    private function debounceUpvoteBroadcast(int $questionId): void
    {
        $window = $this->upvoteWindowMs();
        $now = now()->getTimestampMs();
        $last = Cache::get($this->lastBroadcastKey($questionId));

        if ($window <= 0 || $last === null || $now - (int) $last >= $window) {
            $this->sendUpvoteCount($questionId);

            return;
        }

        if (! Cache::add($this->pendingKey($questionId), true, self::PENDING_TTL_SECONDS)) {
            return; // A trailing broadcast is already pending; it will read this vote.
        }

        BroadcastQaUpvoteCount::dispatch($questionId)
            ->delay(now()->addMilliseconds($window - ($now - (int) $last)));
    }

    /**
     * Marks the window start first, so votes landing during the read schedule
     * a trailing broadcast. Two racing leading edges may both send; that is
     * harmless because each carries the count read at send time.
     *
     * A hidden question's count, and every count on a slide that hides the
     * feed from participants, goes to the host only: the moderation panel
     * still needs it, the audience must not see it.
     */
    private function sendUpvoteCount(int $questionId): void
    {
        Cache::put($this->lastBroadcastKey($questionId), now()->getTimestampMs(), self::LAST_BROADCAST_TTL_SECONDS);

        $question = DeckQaQuestion::query()->with(['session.deck', 'run'])->find($questionId);

        if (! $question || ! $question->session || ! $question->run) {
            return;
        }

        $visibility = $question->is_hidden
            ? BroadcastPayload::VISIBILITY_HOST
            : $this->feedVisibility($question->run);

        $this->broadcaster->broadcast($question->session, new QaQuestionUpvotedPayload(
            questionId: $question->id,
            slideRunId: $question->slide_run_id,
            upvoteCount: (int) $question->upvote_count,
            visibility: $visibility,
        ));
    }

    private function assertOpenQaRun(DeckSessionSlideRun $run): void
    {
        if ($run->type_snapshot !== self::TYPE) {
            throw ValidationException::withMessages(['slide_run' => 'This slide does not take audience questions.']);
        }

        if ($run->state !== DeckSessionSlideRun::STATE_OPEN || ! $run->session?->isLive()) {
            throw ValidationException::withMessages(['slide_run' => 'Questions are not open on this slide.']);
        }
    }

    private function assertParticipantOf(DeckParticipant $participant, int $sessionId): void
    {
        if ((int) $participant->deck_session_id !== $sessionId) {
            throw ValidationException::withMessages(['participant' => 'You are not part of this session.']);
        }
    }

    private function assertCanVote(DeckQaQuestion $question, DeckParticipant $participant): void
    {
        $run = $question->run;

        if (! $run) {
            throw ValidationException::withMessages(['question' => 'This question is no longer available.']);
        }

        $this->assertOpenQaRun($run);
        $this->assertParticipantOf($participant, $question->deck_session_id);
    }

    /** Public unless the slide hides the feed from participants. */
    private function feedVisibility(DeckSessionSlideRun $run): string
    {
        return $this->flag($this->qaConfig($run), 'show_feed_to_participants', true)
            ? BroadcastPayload::VISIBILITY_PUBLIC
            : BroadcastPayload::VISIBILITY_HOST;
    }

    /**
     * The run's settings over QaAudienceSlideType's defaults, so a snapshot
     * missing a key behaves exactly like the slide type says it should.
     */
    private function qaConfig(DeckSessionSlideRun $run): array
    {
        $defaults = $this->slideTypes->has(self::TYPE) ? $this->slideTypes->for(self::TYPE)->defaultConfig() : [];

        return array_replace($defaults, $run->config_snapshot ?? []);
    }

    private function flag(array $config, string $key, bool $default): bool
    {
        return filter_var($config[$key] ?? $default, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? $default;
    }

    private function maxBodyLength(array $config): int
    {
        $max = filter_var($config['max_question_length'] ?? null, FILTER_VALIDATE_INT, FILTER_NULL_ON_FAILURE);

        return $max === null || $max < 1 ? self::MAX_BODY_LENGTH : min($max, self::MAX_BODY_LENGTH_CEILING);
    }

    /**
     * trim() only strips ASCII whitespace, so a body of NBSP, zero-width or
     * ideographic spaces would pass as non-empty and show as a blank question.
     * Also drops NUL bytes, which PostgreSQL text columns reject.
     */
    private function normaliseBody(string $body): string
    {
        $body = str_replace("\0", '', mb_scrub($body, 'UTF-8'));

        return preg_replace('/^[\s\p{Z}\p{Cf}]+|[\s\p{Z}\p{Cf}]+$/u', '', $body) ?? '';
    }

    private function currentCount(int $questionId): int
    {
        return (int) DeckQaQuestion::query()->whereKey($questionId)->value('upvote_count');
    }

    /** Reflect the stored count on the caller's model without marking it dirty. */
    private function syncCount(DeckQaQuestion $question, int $count): void
    {
        $question->forceFill(['upvote_count' => $count])->syncOriginalAttribute('upvote_count');
    }

    private function upvoteWindowMs(): int
    {
        return max(0, (int) config('deck.qa_upvote_debounce_ms', 200));
    }

    private function pendingKey(int $questionId): string
    {
        return "deck:qa:upvote:pending:{$questionId}";
    }

    private function lastBroadcastKey(int $questionId): string
    {
        return "deck:qa:upvote:last:{$questionId}";
    }
}
