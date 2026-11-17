<?php

use App\Deck\Broadcasts\BroadcastPayload;
use App\Deck\Broadcasts\Payloads\QaQuestionModeratedPayload;
use App\Deck\Broadcasts\Payloads\QaQuestionSubmittedPayload;
use App\Deck\Broadcasts\Payloads\QaQuestionUpvotedPayload;
use App\Deck\Qa\Jobs\BroadcastQaUpvoteCount;
use App\Deck\Qa\LiveQaService;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckQaQuestion;
use App\Models\Deck\DeckQaUpvote;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Validation\ValidationException;

uses(DatabaseTransactions::class);

beforeEach(function () {
    config([
        'broadcasting.default' => 'null',
        'cache.default' => 'array',
        'deck.qa_upvote_debounce_ms' => 200,
    ]);
    Queue::fake();
    Event::fake([LiveBroadcastEvent::class]);
    $this->freezeTime();
});

function deckQaRun(array $config = [], string $state = DeckSessionSlideRun::STATE_OPEN, string $type = 'qa_audience'): DeckSessionSlideRun
{
    $session = DeckSession::factory()->live()->create();

    return DeckSessionSlideRun::factory()->inState($state)->create([
        'deck_session_id' => $session->id,
        'type_snapshot' => $type,
        'config_snapshot' => $config,
    ]);
}

function deckQaParticipant(DeckSessionSlideRun $run, string $emoji = '🦊'): DeckParticipant
{
    return DeckParticipant::factory()->create([
        'deck_session_id' => $run->deck_session_id,
        'emoji_avatar' => $emoji,
        'display_name' => 'Secret Name',
    ]);
}

function deckQaService(): LiveQaService
{
    return app(LiveQaService::class);
}

/** @return Collection<int, LiveBroadcastEvent> */
function deckQaBroadcasts(?string $event = null): Collection
{
    return Event::dispatched(LiveBroadcastEvent::class)
        ->map(fn (array $call) => $call[0])
        ->filter(fn (LiveBroadcastEvent $e) => $event === null || $e->broadcastAs() === $event)
        ->values();
}

/** Run the queued trailing job the way a worker would. */
function deckQaRunPendingUpvoteJobs(): void
{
    Queue::pushed(BroadcastQaUpvoteCount::class)
        ->each(fn (BroadcastQaUpvoteCount $job) => app()->call([$job, 'handle']));
}

// --- Submit --------------------------------------------------------------

it('submits a trimmed question and broadcasts it publicly without identifying the author', function () {
    $run = deckQaRun();
    $participant = deckQaParticipant($run, '🐼');

    $question = deckQaService()->submitQuestion($run, $participant, "  What's next?  ");

    expect($question->exists)->toBeTrue()
        ->and($question->body)->toBe("What's next?")
        ->and($question->deck_session_id)->toBe($run->deck_session_id)
        ->and($question->slide_run_id)->toBe($run->id)
        ->and($question->participant_id)->toBe($participant->id)
        ->and($question->upvote_count)->toBe(0)
        ->and($question->submitted_at)->not->toBeNull();

    $events = deckQaBroadcasts('qa.question.submitted');
    expect($events)->toHaveCount(1);

    $event = $events->first();
    $session = $run->session;
    expect($event->isPrivate())->toBeFalse()
        ->and($event->broadcastOn()->name)->toBe("session.quest.{$session->public_channel_key}")
        ->and($event->broadcastWith())->toMatchArray([
            'question_id' => $question->id,
            'slide_run_id' => $run->id,
            'body' => "What's next?",
            'participant_emoji' => '🐼',
            'upvote_count' => 0,
            'is_answered' => false,
            'is_starred' => false,
        ])
        ->and($event->broadcastWith())->not->toHaveKeys(['participant_id', 'display_name', 'participant_token_hash']);

    expect(json_encode($event->broadcastWith()))->not->toContain('Secret Name');
});

it('rejects bodies that are empty, blank or longer than the default 280 characters', function (string $body) {
    $run = deckQaRun();

    expect(fn () => deckQaService()->submitQuestion($run, deckQaParticipant($run), $body))
        ->toThrow(ValidationException::class);
    expect(DeckQaQuestion::where('slide_run_id', $run->id)->count())->toBe(0);
    expect(deckQaBroadcasts())->toBeEmpty();
})->with([
    'empty' => [''],
    'whitespace' => ["   \n\t "],
    'unicode spaces and zero-width characters' => ["\u{00A0}\u{200B}\u{3000}"],
    'byte order mark and word joiner' => ["\u{FEFF} \u{2060}"],
    'combining mark only' => ["\u{00A0}\u{0301}\u{00A0}"],
    'nul bytes only' => ["\0\0"],
    'too long' => [str_repeat('a', 281)],
    'too long multibyte' => [str_repeat('é', 281)],
]);

it('accepts exactly 280 multibyte characters', function () {
    $run = deckQaRun();

    $question = deckQaService()->submitQuestion($run, deckQaParticipant($run), str_repeat('é', 280));

    expect(mb_strlen($question->body))->toBe(280);
});

it('trims unicode spaces and invisible characters around a question and drops nul bytes', function () {
    $run = deckQaRun();

    $question = deckQaService()->submitQuestion($run, deckQaParticipant($run), "\u{00A0}\u{3000} Wh\0y? \u{200B}\u{FEFF}");

    expect($question->body)->toBe('Why?')
        ->and($question->fresh()->body)->toBe('Why?');
});

it('enforces the slide\'s max_question_length instead of the default', function () {
    $service = deckQaService();
    $roomy = deckQaRun(['max_question_length' => 500]);
    $strict = deckQaRun(['max_question_length' => 50]);

    $question = $service->submitQuestion($roomy, deckQaParticipant($roomy), str_repeat('a', 300));
    expect(mb_strlen($question->body))->toBe(300);
    expect(fn () => $service->submitQuestion($roomy, deckQaParticipant($roomy), str_repeat('a', 501)))
        ->toThrow(ValidationException::class, 'between 1 and 500 characters');

    expect($service->submitQuestion($strict, deckQaParticipant($strict), str_repeat('b', 50))->body)->toBe(str_repeat('b', 50));
    expect(fn () => $service->submitQuestion($strict, deckQaParticipant($strict), str_repeat('b', 200)))
        ->toThrow(ValidationException::class, 'between 1 and 50 characters');
    expect(DeckQaQuestion::where('slide_run_id', $strict->id)->count())->toBe(1);
});

it('falls back to a safe question length when the snapshot limit is unusable', function (mixed $limit, int $accepted) {
    $run = deckQaRun(['max_question_length' => $limit]);
    $service = deckQaService();

    expect(mb_strlen($service->submitQuestion($run, deckQaParticipant($run), str_repeat('a', $accepted))->body))->toBe($accepted);
    expect(fn () => $service->submitQuestion($run, deckQaParticipant($run), str_repeat('a', $accepted + 1)))
        ->toThrow(ValidationException::class);
})->with([
    'zero falls back to 280' => [0, 280],
    'garbage falls back to 280' => ['lots', 280],
    'null falls back to 280' => [null, 280],
    'above the ceiling is capped at 1000' => [5000, 1000],
]);

it('only accepts questions on an open qa_audience run in a live session', function () {
    $service = deckQaService();

    $poll = deckQaRun(type: 'poll_single', state: DeckSessionSlideRun::STATE_VOTING);
    expect(fn () => $service->submitQuestion($poll, deckQaParticipant($poll), 'Hi?'))->toThrow(ValidationException::class);

    foreach ([DeckSessionSlideRun::STATE_WAITING, DeckSessionSlideRun::STATE_VOTING, DeckSessionSlideRun::STATE_CLOSED] as $state) {
        $run = deckQaRun(state: $state);
        expect(fn () => $service->submitQuestion($run, deckQaParticipant($run), 'Hi?'))->toThrow(ValidationException::class);
    }

    $ended = deckQaRun();
    $ended->session->update(['status' => DeckSession::STATUS_ENDED]);
    $ended->unsetRelation('session');
    expect(fn () => $service->submitQuestion($ended, deckQaParticipant($ended), 'Hi?'))->toThrow(ValidationException::class);
});

it('rejects a participant from another session', function () {
    $run = deckQaRun();
    $other = deckQaRun();

    expect(fn () => deckQaService()->submitQuestion($run, deckQaParticipant($other), 'Hi?'))
        ->toThrow(ValidationException::class);
    expect(DeckQaQuestion::where('slide_run_id', $run->id)->count())->toBe(0);
});

it('masks profanity unless the slide turns the filter off', function () {
    $filtered = deckQaRun(['profanity_filter_enabled' => true]);
    $defaulted = deckQaRun(); // key missing: QaAudienceSlideType defaults the filter on
    $plain = deckQaRun(['profanity_filter_enabled' => false]);

    $masked = deckQaService()->submitQuestion($filtered, deckQaParticipant($filtered), 'Why is this shit so hard?');
    $defaultMasked = deckQaService()->submitQuestion($defaulted, deckQaParticipant($defaulted), 'Why is this shit so hard?');
    $kept = deckQaService()->submitQuestion($plain, deckQaParticipant($plain), 'Why is this shit so hard?');

    expect($masked->body)->toBe('Why is this **** so hard?')
        ->and($masked->fresh()->body)->toBe('Why is this **** so hard?')
        ->and($defaultMasked->fresh()->body)->toBe('Why is this **** so hard?')
        ->and($kept->body)->toBe('Why is this shit so hard?');
    expect(deckQaBroadcasts('qa.question.submitted')->map(fn ($e) => $e->broadcastWith()['body'])->all())
        ->toBe(['Why is this **** so hard?', 'Why is this **** so hard?', 'Why is this shit so hard?']);
});

it('sends new questions only to the host when the feed is hidden from participants', function () {
    $run = deckQaRun(['show_feed_to_participants' => false]);

    deckQaService()->submitQuestion($run, deckQaParticipant($run), 'Private?');

    $event = deckQaBroadcasts('qa.question.submitted')->sole();
    expect($event->isPrivate())->toBeTrue()
        ->and($event->broadcastOn())->toBeInstanceOf(PrivateChannel::class)
        ->and($event->broadcastOn()->name)->toBe("private-host.quest.{$run->deck_session_id}");
});

// --- Upvotes -------------------------------------------------------------

it('upvotes, counts each participant once and removes upvotes', function () {
    $run = deckQaRun();
    $author = deckQaParticipant($run);
    $voter = deckQaParticipant($run);
    $service = deckQaService();
    $question = $service->submitQuestion($run, $author, 'Can I vote for my own?');

    expect($service->upvote($question, $author))->toBe(1) // own question allowed
        ->and($service->upvote($question, $voter))->toBe(2)
        ->and($service->upvote($question, $voter))->toBe(2) // double vote is a no-op
        ->and($question->upvote_count)->toBe(2)
        ->and($question->isDirty('upvote_count'))->toBeFalse()
        ->and($question->fresh()->upvote_count)->toBe(2)
        ->and(DeckQaUpvote::where('qa_question_id', $question->id)->count())->toBe(2);

    expect($service->removeUpvote($question, $voter))->toBe(1)
        ->and($service->removeUpvote($question, $voter))->toBe(1) // nothing to remove
        ->and($question->fresh()->upvote_count)->toBe(1)
        ->and(DeckQaUpvote::where('qa_question_id', $question->id)->pluck('participant_id')->all())->toBe([$author->id]);

    // The participant can vote again after removing their vote.
    expect($service->upvote($question, $voter))->toBe(2);
});

it('increments atomically instead of writing back a stale count', function () {
    $run = deckQaRun();
    $question = DeckQaQuestion::factory()->create(['slide_run_id' => $run->id, 'deck_session_id' => $run->deck_session_id]);
    $service = deckQaService();

    // Two requests each holding their own (soon stale) copy of the question.
    $copyA = DeckQaQuestion::findOrFail($question->id);
    $copyB = DeckQaQuestion::findOrFail($question->id);
    $copyB->upvote_count = 41; // stale/garbage in-memory value must never be written

    expect($service->upvote($copyA, deckQaParticipant($run)))->toBe(1)
        ->and($service->upvote($copyB, deckQaParticipant($run)))->toBe(2)
        ->and($service->upvote($copyA, deckQaParticipant($run)))->toBe(3)
        ->and($question->fresh()->upvote_count)->toBe(3);

    // The SQL itself is an in-place increment, never `set upvote_count = <n>`.
    DB::enableQueryLog();
    $service->upvote($copyA, deckQaParticipant($run));
    $updates = collect(DB::getQueryLog())->pluck('query')->filter(fn ($sql) => str_starts_with(strtolower($sql), 'update'));
    DB::disableQueryLog();

    expect($updates)->toHaveCount(1)
        ->and($updates->first())->toContain('upvote_count = upvote_count + 1');
});

it('treats an upvote that lost the unique-key race as a no-op', function () {
    $run = deckQaRun();
    $question = DeckQaQuestion::factory()->create(['slide_run_id' => $run->id, 'deck_session_id' => $run->deck_session_id]);
    $voter = deckQaParticipant($run);

    // Another request for the same participant inserted the upvote and bumped the count first.
    DB::table('deck_qa_upvotes')->insert(['qa_question_id' => $question->id, 'participant_id' => $voter->id]);
    DB::table('deck_qa_questions')->where('id', $question->id)->update(['upvote_count' => 1]);

    expect(deckQaService()->upvote($question, $voter))->toBe(1)
        ->and($question->fresh()->upvote_count)->toBe(1)
        ->and(DeckQaUpvote::where('qa_question_id', $question->id)->count())->toBe(1);

    // The test transaction is still usable (no aborted transaction).
    expect(DB::table('deck_qa_questions')->where('id', $question->id)->exists())->toBeTrue();
    expect(deckQaBroadcasts('qa.question.upvoted'))->toBeEmpty();
});

it('never drops the count below zero', function () {
    $run = deckQaRun();
    $question = DeckQaQuestion::factory()->create(['slide_run_id' => $run->id, 'deck_session_id' => $run->deck_session_id]);
    $voter = deckQaParticipant($run);
    DB::table('deck_qa_upvotes')->insert(['qa_question_id' => $question->id, 'participant_id' => $voter->id]);

    expect(deckQaService()->removeUpvote($question, $voter))->toBe(0);
});

it('rejects votes on hidden questions, closed slides and from other sessions', function () {
    $run = deckQaRun();
    $service = deckQaService();
    $question = $service->submitQuestion($run, deckQaParticipant($run), 'Visible?');

    expect(fn () => $service->upvote($question, deckQaParticipant(deckQaRun())))->toThrow(ValidationException::class);

    $service->moderate($question, ['is_hidden' => true]);
    expect(fn () => $service->upvote($question, deckQaParticipant($run)))->toThrow(ValidationException::class);

    $open = $service->submitQuestion($run, deckQaParticipant($run), 'Still open?');
    $run->update(['state' => DeckSessionSlideRun::STATE_CLOSED]);
    $open->unsetRelation('run');
    expect(fn () => $service->upvote($open, deckQaParticipant($run)))->toThrow(ValidationException::class)
        ->and($open->fresh()->upvote_count)->toBe(0);
});

// --- Upvote debounce -----------------------------------------------------

it('broadcasts the first upvote at once and coalesces a burst into one trailing broadcast with the final count', function () {
    $run = deckQaRun();
    $service = deckQaService();
    $question = $service->submitQuestion($run, deckQaParticipant($run), 'Burst?');

    // Leading edge: immediate, no job.
    $service->upvote($question, deckQaParticipant($run));
    expect(deckQaBroadcasts('qa.question.upvoted'))->toHaveCount(1)
        ->and(deckQaBroadcasts('qa.question.upvoted')->first()->broadcastWith())->toMatchArray([
            'question_id' => $question->id,
            'slide_run_id' => $run->id,
            'upvote_count' => 1,
        ]);
    Queue::assertNothingPushed();

    // Inside the window: one trailing job, however many votes arrive.
    $this->travel(50)->milliseconds();
    $service->upvote($question, deckQaParticipant($run));
    $this->travel(50)->milliseconds();
    $service->upvote($question, deckQaParticipant($run));
    $service->removeUpvote($question, $voter = deckQaParticipant($run)); // no-op: never voted
    $service->upvote($question, $voter);

    expect(deckQaBroadcasts('qa.question.upvoted'))->toHaveCount(1);
    Queue::assertPushed(BroadcastQaUpvoteCount::class, 1);
    // No explicit queue: it goes to the connection's default queue, which the `queue` worker consumes.
    Queue::assertPushed(BroadcastQaUpvoteCount::class, fn (BroadcastQaUpvoteCount $job) => $job->questionId === $question->id
        && $job->queue === null
        && $job->delay !== null);

    // The job computes the count when it runs, after the window closes.
    $this->travel(200)->milliseconds();
    deckQaRunPendingUpvoteJobs();

    $upvoted = deckQaBroadcasts('qa.question.upvoted');
    expect($upvoted)->toHaveCount(2)
        ->and($upvoted->last()->broadcastWith()['upvote_count'])->toBe(4)
        ->and($upvoted->last()->broadcastWith()['upvote_count'])->toBe($question->fresh()->upvote_count);

    // A vote right after the trailing broadcast opens a new pending job...
    $service->upvote($question, deckQaParticipant($run));
    Queue::assertPushed(BroadcastQaUpvoteCount::class, 2);

    // ...and after a quiet window the next vote leads again immediately.
    $this->travel(1)->seconds();
    // The leading check comes first, so the still-pending job does not block it.
    $service->upvote($question, deckQaParticipant($run));
    expect(deckQaBroadcasts('qa.question.upvoted')->last()->broadcastWith()['upvote_count'])->toBe(6);
    Queue::assertPushed(BroadcastQaUpvoteCount::class, 2);
});

it('debounces each question independently', function () {
    $run = deckQaRun();
    $service = deckQaService();
    $first = $service->submitQuestion($run, deckQaParticipant($run), 'One?');
    $second = $service->submitQuestion($run, deckQaParticipant($run), 'Two?');

    $service->upvote($first, deckQaParticipant($run));
    $service->upvote($second, deckQaParticipant($run));

    expect(deckQaBroadcasts('qa.question.upvoted')->map(fn ($e) => $e->broadcastWith()['question_id'])->all())
        ->toBe([$first->id, $second->id]);
    Queue::assertNothingPushed();
});

it('sends a hidden question\'s trailing count to the host only', function () {
    $run = deckQaRun();
    $service = deckQaService();
    $question = $service->submitQuestion($run, deckQaParticipant($run), 'Hide me?');

    $service->upvote($question, deckQaParticipant($run));
    $service->upvote($question, deckQaParticipant($run));
    Queue::assertPushed(BroadcastQaUpvoteCount::class, 1);

    $service->moderate($question, ['hide' => true]);
    $this->travel(300)->milliseconds();
    deckQaRunPendingUpvoteJobs();

    $upvoted = deckQaBroadcasts('qa.question.upvoted');
    expect($upvoted)->toHaveCount(2)
        ->and($upvoted->first()->isPrivate())->toBeFalse() // leading edge, before the hide
        ->and($upvoted->last()->isPrivate())->toBeTrue()
        ->and($upvoted->last()->broadcastOn()->name)->toBe("private-host.quest.{$run->deck_session_id}")
        ->and($upvoted->last()->broadcastWith()['upvote_count'])->toBe(2);
});

it('keeps the host\'s count current when a vote is removed from a hidden question', function () {
    $run = deckQaRun();
    $service = deckQaService();
    $question = $service->submitQuestion($run, deckQaParticipant($run), 'Hidden but counted?');
    $voter = deckQaParticipant($run);
    $service->upvote($question, $voter);
    $service->moderate($question, ['is_hidden' => true]);
    Event::fake([LiveBroadcastEvent::class]);

    $this->travel(1)->seconds();
    expect($service->removeUpvote($question, $voter))->toBe(0);

    $event = deckQaBroadcasts('qa.question.upvoted')->sole();
    expect($event->isPrivate())->toBeTrue()
        ->and($event->broadcastOn()->name)->toBe("private-host.quest.{$run->deck_session_id}")
        ->and($event->broadcastWith())->toMatchArray(['question_id' => $question->id, 'slide_run_id' => $run->id, 'upvote_count' => 0]);
});

it('sends upvote counts only to the host when the feed is hidden from participants', function () {
    $run = deckQaRun(['show_feed_to_participants' => false]);
    $service = deckQaService();
    $question = $service->submitQuestion($run, deckQaParticipant($run), 'Private votes?');

    $service->upvote($question, deckQaParticipant($run)); // leading edge
    $service->upvote($question, deckQaParticipant($run)); // trailing job
    $this->travel(300)->milliseconds();
    deckQaRunPendingUpvoteJobs();

    $upvoted = deckQaBroadcasts('qa.question.upvoted');
    expect($upvoted)->toHaveCount(2)
        ->and($upvoted->every(fn (LiveBroadcastEvent $e) => $e->isPrivate()
            && $e->broadcastOn()->name === "private-host.quest.{$run->deck_session_id}"))->toBeTrue()
        ->and($upvoted->last()->broadcastWith()['upvote_count'])->toBe(2);
});

it('broadcasts the trailing count even when the job runs before the window ends', function () {
    $run = deckQaRun();
    $service = deckQaService();
    $question = $service->submitQuestion($run, deckQaParticipant($run), 'Early?');

    $service->upvote($question, deckQaParticipant($run));
    $service->upvote($question, deckQaParticipant($run));
    $this->travel(199)->milliseconds(); // the job waits out the last millisecond
    deckQaRunPendingUpvoteJobs();

    expect(deckQaBroadcasts('qa.question.upvoted')->last()->broadcastWith()['upvote_count'])->toBe(2);
});

// --- Moderation ----------------------------------------------------------

it('moderates with a full host payload and a redacted public payload', function () {
    $run = deckQaRun();
    $author = deckQaParticipant($run, '🐙');
    $service = deckQaService();
    $question = $service->submitQuestion($run, $author, 'Embarrassing question?');
    Event::fake([LiveBroadcastEvent::class]);

    $service->moderate($question, ['is_hidden' => true]);

    expect($question->fresh()->is_hidden)->toBeTrue();
    $events = deckQaBroadcasts('qa.question.moderated');
    expect($events)->toHaveCount(2);

    $host = $events->first(fn (LiveBroadcastEvent $e) => $e->isPrivate());
    $public = $events->first(fn (LiveBroadcastEvent $e) => ! $e->isPrivate());

    expect($host->broadcastOn()->name)->toBe("private-host.quest.{$run->deck_session_id}")
        ->and($host->broadcastWith())->toMatchArray([
            'question_id' => $question->id,
            'body' => 'Embarrassing question?',
            'is_hidden' => true,
            'is_starred' => false,
            'is_answered' => false,
            'participant_id' => $author->id,
            'participant_emoji' => '🐙',
        ]);

    expect($public->broadcastOn()->name)->toBe("session.quest.{$run->session->public_channel_key}")
        ->and($public->broadcastWith())->toMatchArray(['question_id' => $question->id, 'slide_run_id' => $run->id, 'is_hidden' => true])
        ->and($public->broadcastWith())->not->toHaveKeys(['body', 'participant_id', 'participant_emoji', 'upvote_count']);
    expect(json_encode($public->broadcastWith()))->not->toContain('Embarrassing');

    // Unhiding sends the body publicly again so the question can reappear.
    Event::fake([LiveBroadcastEvent::class]);
    $service->moderate($question, ['hide' => false, 'star' => true, 'mark_answered' => true]);
    $public = deckQaBroadcasts('qa.question.moderated')->first(fn (LiveBroadcastEvent $e) => ! $e->isPrivate());
    expect($public->broadcastWith())->toMatchArray([
        'body' => 'Embarrassing question?',
        'is_hidden' => false,
        'is_starred' => true,
        'is_answered' => true,
    ])->and($public->broadcastWith())->not->toHaveKey('participant_id');
    expect($question->fresh())
        ->is_hidden->toBeFalse()
        ->is_starred->toBeTrue()
        ->is_answered->toBeTrue();
});

it('does not broadcast when moderation changes nothing and rejects bad flags', function () {
    $run = deckQaRun();
    $service = deckQaService();
    $question = $service->submitQuestion($run, deckQaParticipant($run), 'Fine?');
    Event::fake([LiveBroadcastEvent::class]);

    $service->moderate($question, ['is_hidden' => false]);
    expect(deckQaBroadcasts())->toBeEmpty();

    expect(fn () => $service->moderate($question, []))->toThrow(ValidationException::class)
        ->and(fn () => $service->moderate($question, ['delete' => true]))->toThrow(ValidationException::class)
        ->and(fn () => $service->moderate($question, ['is_hidden' => 'yes']))->toThrow(ValidationException::class);
});

it('moderation keeps upvotes that landed after the question was loaded', function () {
    $run = deckQaRun();
    $service = deckQaService();
    $question = $service->submitQuestion($run, deckQaParticipant($run), 'Counted?');
    $stale = DeckQaQuestion::findOrFail($question->id);

    $service->upvote($question, deckQaParticipant($run));
    $service->upvote($question, deckQaParticipant($run));
    Event::fake([LiveBroadcastEvent::class]);
    $service->moderate($stale, ['star' => true]);

    expect($question->fresh()->upvote_count)->toBe(2)
        ->and(deckQaBroadcasts('qa.question.moderated')->first()->broadcastWith()['upvote_count'])->toBe(2);
});

it('moderates from the stored row, so a stale copy never un-redacts a hidden question', function () {
    $run = deckQaRun();
    $service = deckQaService();
    $question = $service->submitQuestion($run, deckQaParticipant($run), 'Secret embarrassing question');
    $staleForStar = DeckQaQuestion::findOrFail($question->id);
    $staleForUnhide = DeckQaQuestion::findOrFail($question->id);

    $service->moderate($question, ['is_hidden' => true]);
    Event::fake([LiveBroadcastEvent::class]);

    // Another request loaded the question before the hide committed, then stars it.
    DB::enableQueryLog();
    $service->moderate($staleForStar, ['is_starred' => true]);
    $locked = collect(DB::getQueryLog())->pluck('query')->contains(fn ($sql) => str_contains(strtolower($sql), 'for update'));
    DB::disableQueryLog();

    expect($locked)->toBeTrue()
        ->and($question->fresh())->is_hidden->toBeTrue()->is_starred->toBeTrue();

    $events = deckQaBroadcasts('qa.question.moderated');
    $host = $events->first(fn (LiveBroadcastEvent $e) => $e->isPrivate());
    $public = $events->first(fn (LiveBroadcastEvent $e) => ! $e->isPrivate());
    expect($public->broadcastWith())->toMatchArray(['question_id' => $question->id, 'slide_run_id' => $run->id, 'is_hidden' => true])
        ->and($public->broadcastWith())->not->toHaveKeys(['body', 'is_starred', 'is_answered', 'upvote_count', 'participant_emoji'])
        ->and(json_encode($public->broadcastWith()))->not->toContain('Secret')
        ->and($host->broadcastWith())->toMatchArray(['is_hidden' => true, 'is_starred' => true]);

    // The caller's copy now reflects the stored state, without being dirty.
    expect($staleForStar->is_hidden)->toBeTrue()
        ->and($staleForStar->is_starred)->toBeTrue()
        ->and($staleForStar->isDirty())->toBeFalse();

    // An unhide sent with a copy that still says is_hidden=false is not a silent no-op.
    Event::fake([LiveBroadcastEvent::class]);
    $service->moderate($staleForUnhide, ['is_hidden' => false]);

    expect($question->fresh()->is_hidden)->toBeFalse()
        ->and($staleForUnhide->is_starred)->toBeTrue()
        ->and(deckQaBroadcasts('qa.question.moderated'))->toHaveCount(2);
});

it('rejects moderation of a question that no longer exists', function () {
    $run = deckQaRun();
    $service = deckQaService();
    $question = $service->submitQuestion($run, deckQaParticipant($run), 'Gone?');
    DeckQaQuestion::whereKey($question->id)->delete();
    Event::fake([LiveBroadcastEvent::class]);

    expect(fn () => $service->moderate($question, ['star' => true]))->toThrow(ValidationException::class);
    expect(deckQaBroadcasts())->toBeEmpty();
});

it('sends moderation only to the host when the feed is hidden from participants', function () {
    $run = deckQaRun(['show_feed_to_participants' => false]);
    $service = deckQaService();
    $question = $service->submitQuestion($run, deckQaParticipant($run), 'Host only?');
    Event::fake([LiveBroadcastEvent::class]);

    $service->moderate($question, ['star' => true]);

    expect(deckQaBroadcasts('qa.question.moderated'))->toHaveCount(1)
        ->and(deckQaBroadcasts('qa.question.moderated')->first()->isPrivate())->toBeTrue();
});

// --- Feed (topN) -----------------------------------------------------------

it('sorts the feed by top and new, excludes hidden questions publicly and limits to N', function () {
    $run = deckQaRun();
    $service = deckQaService();
    [$alice, $bob, $carol] = [deckQaParticipant($run, '🦊'), deckQaParticipant($run, '🐼'), deckQaParticipant($run, '🦉')];

    $q1 = $service->submitQuestion($run, $alice, 'First?');
    $q2 = $service->submitQuestion($run, $bob, 'Second?');
    $q3 = $service->submitQuestion($run, $carol, 'Third?');
    $q4 = $service->submitQuestion($run, $alice, 'Fourth?');

    // Cross-upvotes: q3 → 3, q2 → 2, q1 → 1 (ties with q4 broken by age), q4 → 1.
    foreach ([$alice, $bob, $carol] as $p) {
        $service->upvote($q3, $p);
    }
    $service->upvote($q2, $alice);
    $service->upvote($q2, $carol);
    $service->upvote($q1, $bob);
    $service->upvote($q4, $bob);

    // Host hides one and stars another; star does not reorder the feed.
    $service->moderate($q2, ['is_hidden' => true]);
    $service->moderate($q4, ['is_starred' => true]);

    // Another run's questions never leak in.
    $otherRun = deckQaRun();
    $service->submitQuestion($otherRun, deckQaParticipant($otherRun), 'Elsewhere?');

    expect($service->topN($run, 10)->pluck('id')->all())->toBe([$q3->id, $q1->id, $q4->id])
        ->and($service->topN($run, 10, 'top', includeHidden: true)->pluck('id')->all())->toBe([$q3->id, $q2->id, $q1->id, $q4->id])
        ->and($service->topN($run, 10, 'new')->pluck('id')->all())->toBe([$q4->id, $q3->id, $q1->id])
        ->and($service->topN($run, 10, 'newest')->pluck('id')->all())->toBe([$q4->id, $q3->id, $q1->id])
        ->and($service->topN($run, 2)->pluck('id')->all())->toBe([$q3->id, $q1->id])
        ->and($service->topN($run, 0))->toHaveCount(0);

    $top = $service->topN($run, 1)->first();
    expect($top->upvote_count)->toBe(3)
        ->and($top->relationLoaded('participant'))->toBeTrue()
        ->and($top->participant->emoji_avatar)->toBe('🦉');

    expect(fn () => $service->topN($run, 5, 'random'))->toThrow(InvalidArgumentException::class);
});

// --- Payload DTOs --------------------------------------------------------

it('exposes the expected event names, visibility and keys on every Q&A payload', function () {
    $run = deckQaRun();
    $question = DeckQaQuestion::factory()->create([
        'slide_run_id' => $run->id,
        'deck_session_id' => $run->deck_session_id,
        'body' => 'Shape?',
        'upvote_count' => 3,
    ]);

    $submitted = QaQuestionSubmittedPayload::fromQuestion($question);
    expect($submitted->eventName())->toBe('qa.question.submitted')
        ->and($submitted->visibility())->toBe(BroadcastPayload::VISIBILITY_PUBLIC)
        ->and(array_keys($submitted->toArray()))->toEqualCanonicalizing([
            'question_id', 'slide_run_id', 'body', 'participant_emoji', 'upvote_count', 'is_answered', 'is_starred', 'submitted_at',
        ]);

    $upvoted = new QaQuestionUpvotedPayload($question->id, $run->id, 3);
    expect($upvoted->eventName())->toBe('qa.question.upvoted')
        ->and($upvoted->visibility())->toBe(BroadcastPayload::VISIBILITY_PUBLIC)
        ->and($upvoted->toArray())->toBe(['question_id' => $question->id, 'slide_run_id' => $run->id, 'upvote_count' => 3]);
    $hostUpvoted = new QaQuestionUpvotedPayload($question->id, $run->id, 3, BroadcastPayload::VISIBILITY_HOST);
    expect($hostUpvoted->visibility())->toBe(BroadcastPayload::VISIBILITY_HOST)
        ->and($hostUpvoted->toArray())->toBe($upvoted->toArray());

    $host = QaQuestionModeratedPayload::forHost($question);
    $public = QaQuestionModeratedPayload::forPublic($question);
    expect($host->eventName())->toBe('qa.question.moderated')
        ->and($host->visibility())->toBe(BroadcastPayload::VISIBILITY_HOST)
        ->and($public->eventName())->toBe('qa.question.moderated')
        ->and($public->visibility())->toBe(BroadcastPayload::VISIBILITY_PUBLIC)
        ->and($public->toArray())->not->toHaveKey('participant_id')
        ->and($public->toArray()['body'])->toBe('Shape?');

    $question->is_hidden = true;
    expect(QaQuestionModeratedPayload::forPublic($question)->toArray())
        ->toBe(['question_id' => $question->id, 'slide_run_id' => $run->id, 'is_hidden' => true]);
});
