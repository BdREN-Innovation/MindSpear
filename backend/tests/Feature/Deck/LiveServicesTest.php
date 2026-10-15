<?php

use App\Deck\Broadcasts\BroadcastPayload;
use App\Deck\Broadcasts\DeckBroadcaster;
use App\Deck\Broadcasts\DeckChannels;
use App\Deck\Broadcasts\Payloads\AnswerSubmittedPayload;
use App\Deck\Broadcasts\Payloads\ParticipantCountUpdatedPayload;
use App\Deck\Broadcasts\Payloads\SlideAggregateUpdatedPayload;
use App\Deck\Broadcasts\Payloads\SlideChangedPayload;
use App\Deck\Broadcasts\Payloads\SlideClosedPayload;
use App\Deck\Broadcasts\Payloads\SlideStateChangedPayload;
use App\Deck\Slides\AbstractSlideType;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Events\Live\ImmediateLiveBroadcastEvent;
use App\Events\Live\LiveBroadcastEvent;
use App\Jobs\Deck\BroadcastDeckAggregate;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\User;
use App\Services\Live\LiveAggregateService;
use App\Services\Live\LiveSessionService;
use App\Services\Live\ParticipantTokenService;
use Carbon\CarbonInterval;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Queue\SyncQueue;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Sleep;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

beforeEach(function () {
    config(['broadcasting.default' => 'null', 'cache.default' => 'array', 'queue.default' => 'sync']);

    // Concrete Quest types may not exist yet; these stand in for a live poll and a hidden-results one.
    $registry = app(SlideTypeRegistry::class);
    $registry->register(deckLiveServicesType('live_services_poll', SlideTypeContract::REVEAL_LIVE));
    $registry->register(deckLiveServicesType('live_services_hidden', SlideTypeContract::REVEAL_HIDDEN));
});

/**
 * Test-only poll type; aggregate lists the answer ids so tests can see exactly
 * what was read. $onAggregate runs after the answers were read, standing in for
 * a request that commits while a broadcast is being computed.
 */
function deckLiveServicesType(string $key, string $reveal, ?Closure $onAggregate = null): SlideTypeContract
{
    return new class ($key, $reveal, $onAggregate) extends AbstractSlideType {
        public function __construct(
            private readonly string $typeKey,
            private readonly string $reveal,
            private readonly ?Closure $onAggregate = null,
        ) {}

        public function key(): string
        {
            return $this->typeKey;
        }

        public function category(): string
        {
            return self::CATEGORY_POLL;
        }

        public function revealModel(): string
        {
            return $this->reveal;
        }

        public function aggregate(array $config, array $options, Collection $answers): array
        {
            if ($this->onAggregate) {
                ($this->onAggregate)();
            }

            return ['total_responses' => $answers->count(), 'answer_ids' => $answers->pluck('id')->all()];
        }
    };
}

function deckLiveServicesSession(string $product = Deck::PRODUCT_QUEST): DeckSession
{
    $deck = $product === Deck::PRODUCT_QUIZ ? Deck::factory()->quiz()->create() : Deck::factory()->create();

    return DeckSession::factory()->live()->create(['deck_id' => $deck->id]);
}

function deckLiveServicesRun(string $type = 'live_services_poll', ?DeckSession $session = null): DeckSessionSlideRun
{
    $session ??= deckLiveServicesSession();

    return DeckSessionSlideRun::factory()->inState(DeckSessionSlideRun::STATE_VOTING)->create([
        'deck_session_id' => $session->id,
        'type_snapshot' => $type,
    ]);
}

function deckLiveServicesAnswer(DeckSessionSlideRun $run): DeckParticipantAnswer
{
    return DeckParticipantAnswer::factory()->create(['slide_run_id' => $run->id, 'answer_payload' => ['option_id' => 1]]);
}

/** @return Collection<int, LiveBroadcastEvent> */
function deckLiveServicesEvents(string $name): Collection
{
    return Event::dispatched(LiveBroadcastEvent::class)
        ->map(fn ($call) => $call[0])
        ->filter(fn (LiveBroadcastEvent $event) => $event->broadcastAs() === $name)
        ->values();
}

function deckLiveServicesRequest(?string $token): Request
{
    $request = Request::create('/api/v1/deck-test', 'POST');

    if ($token !== null) {
        $request->headers->set(ParticipantTokenService::HEADER, $token);
    }

    return $request;
}

// --- Payload DTOs ------------------------------------------------------------

it('gives every live payload stable keys including slide_run_id and server_time', function () {
    $this->travelTo(now()->startOfSecond());
    $run = deckLiveServicesRun();
    $answer = deckLiveServicesAnswer($run);
    $answer->update(['time_to_answer_ms' => 1234]);
    $session = $run->session;

    $cases = [
        [SlideChangedPayload::fromRun($run, ['id' => $run->id], 4), 'slide.changed', 'public',
            ['slide_run_id', 'position', 'total_slides', 'type', 'state', 'state_version', 'slide', 'server_time']],
        [SlideStateChangedPayload::fromRun($run), 'slide.state.changed', 'public',
            ['slide_run_id', 'state', 'state_version', 'seconds_remaining', 'ends_at', 'duration_seconds', 'state_started_at', 'voting_started_at', 'closed_at', 'server_time']],
        [SlideAggregateUpdatedPayload::fromRun($run, ['total_responses' => 1]), 'slide.aggregate.updated', 'public',
            ['slide_run_id', 'state_version', 'total_responses', 'aggregate', 'server_time']],
        [SlideClosedPayload::fromRun($run, ['total_responses' => 1]), 'slide.closed', 'public',
            ['slide_run_id', 'state', 'state_version', 'closed_at', 'total_responses', 'aggregate', 'server_time']],
        [AnswerSubmittedPayload::fromAnswer($answer->fresh(), 1), 'answer.submitted', 'host',
            ['slide_run_id', 'answer_id', 'participant_id', 'display_name', 'emoji_avatar', 'answer', 'time_to_answer_ms', 'submitted_at', 'total_responses', 'is_update', 'server_time']],
        [ParticipantCountUpdatedPayload::fromSession($session), 'participant.count.updated', 'public',
            ['slide_run_id', 'participant_count', 'server_time']],
    ];

    foreach ($cases as [$payload, $event, $visibility, $keys]) {
        expect($payload)->toBeInstanceOf(BroadcastPayload::class)
            ->and($payload->eventName())->toBe($event)
            ->and($payload->visibility())->toBe($visibility)
            ->and(array_keys($payload->toArray()))->toBe($keys)
            ->and($payload->toArray()['server_time'])->toBe(now()->toISOString());
    }

    $answerArray = AnswerSubmittedPayload::fromAnswer($answer->fresh(), 1)->toArray();
    expect($answerArray['time_to_answer_ms'])->toBe(1234)
        ->and($answerArray['slide_run_id'])->toBe($run->id)
        ->and($answerArray['participant_id'])->toBe($answer->deck_participant_id)
        ->and($answerArray['answer'])->toEqual(['option_id' => 1])
        ->and(SlideClosedPayload::fromRun($run, null)->toArray())->toMatchArray(['aggregate' => null, 'total_responses' => null, 'state' => 'closed']);
});

it('never puts an aggregate into the public slide.changed payload', function () {
    $run = deckLiveServicesRun();
    $payload = SlideChangedPayload::fromRun($run, ['id' => $run->id, 'title' => 'Q', 'aggregate' => ['total_responses' => 3]]);

    expect($payload->toArray()['slide'])->toBe(['id' => $run->id, 'title' => 'Q'])
        ->and($payload->toArray()['state_version'])->toBe(1);
});

it('derives countdowns for slide.state.changed from the run snapshot', function () {
    $this->travelTo(now()->startOfSecond());
    $run = deckLiveServicesRun();

    $run->forceFill(['time_limit_seconds' => 30, 'voting_started_at' => now()->subMilliseconds(10200)]);
    $voting = SlideStateChangedPayload::fromRun($run)->toArray();
    expect($voting['seconds_remaining'])->toBe(20)
        ->and($voting['duration_seconds'])->toBe(30)
        ->and($voting['ends_at'])->toBe(now()->addMilliseconds(19800)->toISOString());

    $run->forceFill(['state' => DeckSessionSlideRun::STATE_GET_READY, 'get_ready_seconds' => 5, 'state_started_at' => now()->subSeconds(2)]);
    expect(SlideStateChangedPayload::fromRun($run)->toArray())->toMatchArray(['seconds_remaining' => 3, 'duration_seconds' => 5]);

    $run->forceFill(['state_started_at' => now()->subMinute()]);
    expect(SlideStateChangedPayload::fromRun($run)->toArray())->toMatchArray(['seconds_remaining' => 0, 'duration_seconds' => 5]);

    // Untimed voting (typical for Quest) and untimed states carry no timer at all.
    $run->forceFill(['state' => DeckSessionSlideRun::STATE_VOTING, 'time_limit_seconds' => null]);
    expect(SlideStateChangedPayload::fromRun($run)->toArray())->toMatchArray(['seconds_remaining' => null, 'ends_at' => null, 'duration_seconds' => null]);

    $run->forceFill(['state' => DeckSessionSlideRun::STATE_WAITING]);
    expect(SlideStateChangedPayload::fromRun($run)->toArray())->toMatchArray(['seconds_remaining' => null, 'ends_at' => null, 'duration_seconds' => null]);
});

it('sends answer.submitted only to the private host channel, never to the public one', function () {
    Event::fake([LiveBroadcastEvent::class]);
    $run = deckLiveServicesRun();
    $session = $run->session;

    app(DeckBroadcaster::class)->broadcast($session, AnswerSubmittedPayload::fromAnswer(deckLiveServicesAnswer($run), 1));

    $events = deckLiveServicesEvents('answer.submitted');
    $publicChannel = app(DeckChannels::class)->publicChannel($session);

    expect($events)->toHaveCount(1)
        ->and($events[0]->isPrivate())->toBeTrue()
        ->and($events[0]->broadcastOn()->name)->toBe("private-host.quest.v2.{$session->id}")
        ->and($events[0]->broadcastWith()['time_to_answer_ms'])->toBe(1500);

    Event::assertNotDispatched(LiveBroadcastEvent::class, fn (LiveBroadcastEvent $event) => in_array(
        $event->broadcastOn()->name,
        [$publicChannel, "private-{$publicChannel}"],
        true,
    ) && $event->broadcastAs() === 'answer.submitted');
});

// --- LiveSessionService ------------------------------------------------------

it('derives deck channel names from the deck product and leaves legacy names alone', function () {
    $live = app(LiveSessionService::class);
    $channels = app(DeckChannels::class);
    $quest = deckLiveServicesSession();
    $quiz = deckLiveServicesSession(Deck::PRODUCT_QUIZ);

    expect($live->publicChannelFor($quest))->toBe("session.quest.{$quest->public_channel_key}")
        ->and($live->hostChannelFor($quest))->toBe("host.quest.v2.{$quest->id}")
        ->and($live->publicChannelFor($quiz))->toBe($channels->publicChannel($quiz))
        ->and($live->hostChannelFor($quiz))->toBe($channels->hostChannel($quiz))
        ->and($live->moduleFor($quiz))->toBe('quiz')
        ->and($live->ensurePublicChannelKey($quest))->toBe($quest->public_channel_key)
        ->and($live->hostChannel('quest', 5))->toBe('host.quest.5')
        ->and($live->publicChannel('quiz', 'abc'))->toBe('session.quiz.abc');
});

it('routes legacy-style host broadcasts of a deck session to the v2 host channel', function () {
    Event::fake([ImmediateLiveBroadcastEvent::class]);
    $live = app(LiveSessionService::class);
    $session = deckLiveServicesSession();

    $live->broadcastHost('quest', $session, 'answer.submitted', ['x' => 1]);
    $live->broadcastPublic('quest', $session, 'slide.changed', ['y' => 2]);

    $events = Event::dispatched(ImmediateLiveBroadcastEvent::class)->map(fn ($call) => $call[0])->values();
    expect($events)->toHaveCount(2)
        ->and($events[0]->broadcastOn()->name)->toBe("private-host.quest.v2.{$session->id}")
        ->and($events[0]->broadcastWith())->toMatchArray(['x' => 1, 'module' => 'quest', 'event' => 'answer.submitted'])
        ->and($events[1]->broadcastOn()->name)->toBe("session.quest.{$session->public_channel_key}");

    expect(fn () => $live->broadcastHost('quiz', $session, 'answer.submitted'))->toThrow(InvalidArgumentException::class);
});

it('counts and broadcasts deck participants who have not left', function () {
    Event::fake([LiveBroadcastEvent::class]);
    $run = deckLiveServicesRun();
    $session = $run->session;
    $session->update(['current_slide_run_id' => $run->id]);
    DeckParticipant::factory()->count(2)->create(['deck_session_id' => $session->id]);
    DeckParticipant::factory()->create(['deck_session_id' => $session->id, 'left_at' => now()]);

    $live = app(LiveSessionService::class);
    $live->broadcastParticipantCount('quest', $session);

    $events = deckLiveServicesEvents('participant.count.updated');
    expect($live->participantCountPayload($session))->toBe(['session_id' => $session->id, 'participant_count' => 2])
        ->and($events)->toHaveCount(1)
        ->and($events[0]->isPrivate())->toBeFalse()
        ->and($events[0]->broadcastWith())->toMatchArray(['participant_count' => 2, 'slide_run_id' => $run->id, 'session_id' => $session->id]);
});

it('counts deck participants after the join commits, not when the broadcast is requested', function () {
    Event::fake([LiveBroadcastEvent::class]);
    $session = deckLiveServicesSession();
    DeckParticipant::factory()->create(['deck_session_id' => $session->id]);
    $live = app(LiveSessionService::class);

    DB::transaction(function () use ($live, $session) {
        $live->broadcastParticipantCount('quest', $session);
        // Another join lands before this transaction commits; the count must include it.
        DeckParticipant::factory()->create(['deck_session_id' => $session->id]);
        expect(deckLiveServicesEvents('participant.count.updated'))->toHaveCount(0);
    });

    $events = deckLiveServicesEvents('participant.count.updated');
    expect($events)->toHaveCount(1)
        ->and($events[0]->broadcastWith()['participant_count'])->toBe(2);
});

// --- ParticipantTokenService -------------------------------------------------

it('issues, validates, resolves and sanitises deck participant tokens', function () {
    $this->travelTo(now()->startOfSecond());
    $tokens = app(ParticipantTokenService::class);
    $session = deckLiveServicesSession();
    $participant = DeckParticipant::factory()->create(['deck_session_id' => $session->id]);
    $other = DeckParticipant::factory()->create(['deck_session_id' => deckLiveServicesSession()->id]);

    $token = $tokens->issue($participant, $session);
    $participant->refresh();

    expect(strlen($token))->toBe(64)
        ->and($participant->participant_token_hash)->toBe(hash('sha256', $token))
        ->and($participant->participant_token_expires_at->equalTo(now()->addHours(6)))->toBeTrue()
        ->and($participant->participant_token_revoked_at)->toBeNull()
        ->and($tokens->validateRequest(deckLiveServicesRequest($token), $participant))->toBeTrue()
        // No is_anonymous bypass: a deck participant without a token is rejected.
        ->and($tokens->validateRequest(deckLiveServicesRequest(null), $participant))->toBeFalse()
        ->and($tokens->validateRequest(deckLiveServicesRequest('wrong'), $participant))->toBeFalse()
        ->and($tokens->participantForDeckSession(deckLiveServicesRequest($token), $session)?->id)->toBe($participant->id)
        ->and($tokens->participantForDeckSession(deckLiveServicesRequest($token), $session->id)?->id)->toBe($participant->id)
        ->and($tokens->participantForDeckSession(deckLiveServicesRequest($token), $other->deck_session_id))->toBeNull()
        ->and($tokens->participantForDeckSession(deckLiveServicesRequest(null), $session))->toBeNull();

    $hidden = $tokens->sanitizeParticipant($participant)->toArray();
    expect($hidden)->not->toHaveKeys(['participant_token_hash', 'participant_token_expires_at', 'participant_token_revoked_at']);
});

it('rejects expired and revoked deck participant tokens', function () {
    $tokens = app(ParticipantTokenService::class);
    $session = deckLiveServicesSession();
    $expired = DeckParticipant::factory()->create(['deck_session_id' => $session->id]);
    $revoked = DeckParticipant::factory()->create(['deck_session_id' => $session->id]);
    $kept = DeckParticipant::factory()->create(['deck_session_id' => $session->id]);
    $outsider = DeckParticipant::factory()->create(['deck_session_id' => deckLiveServicesSession()->id]);

    $expiredToken = $tokens->issue($expired, $session);
    $revokedToken = $tokens->issue($revoked, $session);
    $outsiderToken = $tokens->issue($outsider, $outsider->session);

    $expired->update(['participant_token_expires_at' => now()->subSecond()]);
    $tokens->revokeParticipant($revoked);

    expect($tokens->validateRequest(deckLiveServicesRequest($expiredToken), $expired->fresh()))->toBeFalse()
        ->and($tokens->participantForDeckSession(deckLiveServicesRequest($expiredToken), $session))->toBeNull()
        ->and($tokens->validateRequest(deckLiveServicesRequest($revokedToken), $revoked->fresh()))->toBeFalse()
        ->and($tokens->resolveDeckParticipant($revokedToken, $session))->toBeNull();

    // Revoking a session touches only its own unrevoked participants.
    expect($tokens->revokeForDeckSession($session))->toBe(2)
        ->and($kept->fresh()->participant_token_revoked_at)->not->toBeNull()
        ->and($tokens->resolveDeckParticipant($outsiderToken, $outsider->deck_session_id)?->id)->toBe($outsider->id);
});

// --- Channel authorisation ---------------------------------------------------

it('authorises host.{product}.v2 channels for the session host only and keeps legacy channels separate', function () {
    config([
        'broadcasting.default' => 'reverb',
        'broadcasting.connections.reverb.key' => 'local',
        'broadcasting.connections.reverb.secret' => 'local-secret',
        'broadcasting.connections.reverb.app_id' => 'local',
    ]);
    $quest = deckLiveServicesSession();
    $quiz = deckLiveServicesSession(Deck::PRODUCT_QUIZ);
    $stranger = DeckFactory::newOwner();

    $auth = fn (string $channel) => $this->postJson('/broadcasting/auth', [
        'socket_id' => '123.456',
        'channel_name' => "private-{$channel}",
    ]);

    Sanctum::actingAs(User::find($quest->host_user_id));
    $auth("host.quest.v2.{$quest->id}")->assertOk()->assertJsonStructure(['auth']);
    $auth("host.quiz.v2.{$quest->id}")->assertForbidden();
    $auth("host.quiz.v2.{$quiz->id}")->assertForbidden();
    // A deck host gains nothing on the legacy channel with the same numeric id.
    $auth("host.quest.{$quest->id}")->assertForbidden();

    Sanctum::actingAs(User::find($quiz->host_user_id));
    $auth("host.quiz.v2.{$quiz->id}")->assertOk();

    Sanctum::actingAs($stranger);
    $auth("host.quest.v2.{$quest->id}")->assertForbidden();
    $auth("host.quiz.v2.{$quiz->id}")->assertForbidden();
});

// --- Aggregate debouncing (§1.7) ---------------------------------------------

it('broadcasts the first aggregate change immediately on the public channel', function () {
    Event::fake([LiveBroadcastEvent::class]);
    Queue::fake([BroadcastDeckAggregate::class]);
    $this->travelTo(now()->startOfSecond());
    $run = deckLiveServicesRun();
    $run->update(['config_snapshot' => ['show_results_to_participants' => true]]);
    $answer = deckLiveServicesAnswer($run);

    app(LiveAggregateService::class)->schedule($run);

    $events = deckLiveServicesEvents('slide.aggregate.updated');
    expect($events)->toHaveCount(1)
        ->and($events[0]->isPrivate())->toBeFalse()
        ->and($events[0]->broadcastOn()->name)->toBe("session.quest.{$run->session->public_channel_key}")
        ->and($events[0]->broadcastWith())->toMatchArray([
            'slide_run_id' => $run->id,
            'total_responses' => 1,
            'aggregate' => ['total_responses' => 1, 'answer_ids' => [$answer->id]],
            'module' => 'quest',
        ])
        ->and(Cache::get(LiveAggregateService::debounceKey($run->id)))->toBe(now()->getTimestampMs());
    Queue::assertNothingPushed();
});

it('coalesces a burst into one trailing job that broadcasts the final count when it runs', function () {
    Event::fake([LiveBroadcastEvent::class]);
    Queue::fake([BroadcastDeckAggregate::class]);
    Sleep::fake();
    $this->travelTo(now()->startOfSecond());
    $aggregates = app(LiveAggregateService::class);
    $run = deckLiveServicesRun();

    deckLiveServicesAnswer($run);
    $aggregates->schedule($run, debounceMs: 500);            // t=0: leading edge
    foreach (range(1, 4) as $step) {                        // t=50..200: inside the window
        $this->travel(50)->milliseconds();
        deckLiveServicesAnswer($run);
        $aggregates->schedule($run, debounceMs: 500);
    }

    expect(deckLiveServicesEvents('slide.aggregate.updated'))->toHaveCount(1);
    Queue::assertPushed(BroadcastDeckAggregate::class, 1);
    $job = Queue::pushed(BroadcastDeckAggregate::class)->first();
    expect($job->slideRunId)->toBe($run->id)
        ->and($job->debounceMs)->toBe(500)
        ->and($job->delay->getTimestampMs())->toBe(now()->subMilliseconds(150)->addMilliseconds(450)->getTimestampMs());

    // Answers after the job was queued are still counted: it computes when it runs.
    $this->travel(100)->milliseconds();
    deckLiveServicesAnswer($run);
    $aggregates->schedule($run, debounceMs: 500);
    Queue::assertPushed(BroadcastDeckAggregate::class, 1);

    $this->travel(300)->milliseconds();                      // t=600: window over
    app()->call([$job, 'handle']);

    Sleep::assertNeverSlept();
    $events = deckLiveServicesEvents('slide.aggregate.updated');
    $finalCount = DeckParticipantAnswer::where('slide_run_id', $run->id)->count();
    expect($finalCount)->toBe(6)
        ->and($events)->toHaveCount(2)
        ->and($events[1]->broadcastWith()['total_responses'])->toBe(6)
        ->and($events[1]->broadcastWith()['aggregate']['answer_ids'])->toHaveCount(6)
        ->and(Cache::get(LiveAggregateService::debounceKey($run->id)))->toBe(now()->getTimestampMs());

    // The job freed its pending marker, so the next burst gets its own trailing job.
    $this->travel(50)->milliseconds();
    deckLiveServicesAnswer($run);
    $aggregates->schedule($run, debounceMs: 500);
    Queue::assertPushed(BroadcastDeckAggregate::class, 2);
    expect(deckLiveServicesEvents('slide.aggregate.updated'))->toHaveCount(2);

    // Once a full window passes without a broadcast, the leading edge fires again.
    $this->travel(600)->milliseconds();
    $aggregates->schedule($run, debounceMs: 500);
    expect(deckLiveServicesEvents('slide.aggregate.updated'))->toHaveCount(3);
});

it('keeps one pending trailing job per run when jobs run through the real queue handler', function () {
    Event::fake([LiveBroadcastEvent::class]);
    Queue::fake([BroadcastDeckAggregate::class]);
    Sleep::fake();
    $this->travelTo(now()->startOfSecond());
    $aggregates = app(LiveAggregateService::class);
    $duringRead = null;
    app(SlideTypeRegistry::class)->register(deckLiveServicesType('live_services_hooked', SlideTypeContract::REVEAL_LIVE, function () use (&$duringRead) {
        [$hook, $duringRead] = [$duringRead, null];
        $hook && $hook();
    }));
    $run = deckLiveServicesRun('live_services_hooked');
    $answer = function () use ($aggregates, $run) {
        deckLiveServicesAnswer($run);
        $aggregates->schedule($run, debounceMs: 500);
    };
    $pushed = fn () => Queue::pushed(BroadcastDeckAggregate::class)->values();
    // A worker's path: payload -> SyncJob -> CallQueuedHandler, including whatever it does after handle().
    $work = function (BroadcastDeckAggregate $job) {
        $queue = new SyncQueue();
        $queue->setContainer(app());
        $queue->setConnectionName('sync');
        $queue->push($job);
    };

    $answer();                                   // t=0: leading edge
    $this->travel(100)->milliseconds();
    $answer();                                   // queues trailing job A
    $answer();                                   // A is pending: nothing new
    expect($pushed())->toHaveCount(1);
    $jobA = $pushed()[0];

    // An answer while A waits out its window is A's to cover; one while A
    // reads and broadcasts queues B.
    Sleep::whenFakingSleep(fn () => $answer());
    $duringRead = $answer;
    $this->travel(100)->milliseconds();          // t=200: whole-second delay, A starts early
    $work($jobA);

    Sleep::assertSleptTimes(1);
    expect($pushed())->toHaveCount(2)
        ->and(deckLiveServicesEvents('slide.aggregate.updated')->last()->broadcastWith()['total_responses'])->toBe(4);
    $jobB = $pushed()[1];

    // A finishing (or failing late) must not free B's marker.
    Sleep::fake();
    $answer();
    $jobA->failed();
    $answer();
    expect($pushed())->toHaveCount(2)
        ->and($jobB->pendingOwner)->not->toBe($jobA->pendingOwner);

    $this->travel(500)->milliseconds();          // t=700: A's window is over
    $work($jobB);

    $events = deckLiveServicesEvents('slide.aggregate.updated');
    expect($events)->toHaveCount(3)
        ->and($events[2]->broadcastWith()['total_responses'])->toBe(DeckParticipantAnswer::where('slide_run_id', $run->id)->count())
        ->and($events[2]->broadcastWith()['total_responses'])->toBe(7);

    // B freed only its own marker, so the next burst gets exactly one new job.
    $answer();
    $answer();
    expect($pushed())->toHaveCount(3);
});

it('lets a trailing job that starts early wait out the rest of the window', function () {
    Event::fake([LiveBroadcastEvent::class]);
    Queue::fake([BroadcastDeckAggregate::class]);
    Sleep::fake();
    $this->travelTo(now()->startOfSecond());
    $aggregates = app(LiveAggregateService::class);
    $run = deckLiveServicesRun();

    $aggregates->schedule($run, debounceMs: 500);
    $this->travel(100)->milliseconds();
    $aggregates->schedule($run, debounceMs: 500);
    app()->call([Queue::pushed(BroadcastDeckAggregate::class)->first(), 'handle']);

    Sleep::assertSlept(fn (CarbonInterval $duration) => (int) $duration->totalMilliseconds === 400, 1);
    expect(deckLiveServicesEvents('slide.aggregate.updated'))->toHaveCount(2);
});

it('waits for the commit, uses the compute closure for the leading edge only, and reports failures', function () {
    Event::fake([LiveBroadcastEvent::class]);
    Queue::fake([BroadcastDeckAggregate::class]);
    Exceptions::fake();
    $aggregates = app(LiveAggregateService::class);
    $run = deckLiveServicesRun();

    DB::transaction(function () use ($aggregates, $run) {
        $aggregates->schedule($run, fn () => ['total_responses' => 99]);
        expect(deckLiveServicesEvents('slide.aggregate.updated'))->toHaveCount(0);
    });
    expect(deckLiveServicesEvents('slide.aggregate.updated')->first()->broadcastWith()['total_responses'])->toBe(99);

    $failing = deckLiveServicesRun();
    $aggregates->schedule($failing, fn () => throw new RuntimeException('bad aggregate'));
    Exceptions::assertReported(RuntimeException::class);
    expect(deckLiveServicesEvents('slide.aggregate.updated'))->toHaveCount(1);
});

it('keeps results of non-live reveal models on the host channel', function () {
    Event::fake([LiveBroadcastEvent::class]);
    $run = deckLiveServicesRun('live_services_hidden');
    // The participant setting never overrides a reveal model that hides results.
    $run->update(['config_snapshot' => ['show_results_to_participants' => true]]);

    app(LiveAggregateService::class)->schedule($run);

    $events = deckLiveServicesEvents('slide.aggregate.updated');
    expect($events)->toHaveCount(1)
        ->and($events[0]->isPrivate())->toBeTrue()
        ->and($events[0]->broadcastOn()->name)->toBe("private-host.quest.v2.{$run->deck_session_id}");
});

it('keeps live results on the host channel unless the slide shows them to participants', function (array $config, bool $public) {
    // Plan §5.6: "Show votes to participants" is off by default, so only the presenter gets the live chart.
    Event::fake([LiveBroadcastEvent::class]);
    $run = deckLiveServicesRun();
    $run->update(['config_snapshot' => $config]);
    $aggregates = app(LiveAggregateService::class);

    $aggregates->schedule($run, debounceMs: 0);

    $events = deckLiveServicesEvents('slide.aggregate.updated');
    expect($aggregates->resultsVisibility($run))->toBe($public ? BroadcastPayload::VISIBILITY_PUBLIC : BroadcastPayload::VISIBILITY_HOST)
        ->and($events)->toHaveCount(1)
        ->and($events[0]->isPrivate())->toBe(! $public)
        ->and($events[0]->broadcastOn()->name)->toBe($public
            ? "session.quest.{$run->session->public_channel_key}"
            : "private-host.quest.v2.{$run->deck_session_id}");
})->with([
    'no setting (default off)' => [[], false],
    'setting off' => [['show_results_to_participants' => false], false],
    'setting on' => [['show_results_to_participants' => true], true],
]);

it('closes a run publicly with the final aggregate when participants may see results', function () {
    Event::fake([LiveBroadcastEvent::class]);
    $run = deckLiveServicesRun();
    $run->update(['config_snapshot' => ['show_results_to_participants' => true]]);
    deckLiveServicesAnswer($run);
    deckLiveServicesAnswer($run);
    $run->update(['state' => DeckSessionSlideRun::STATE_CLOSED, 'state_version' => 2, 'closed_at' => now()]);

    app(LiveAggregateService::class)->broadcastClosed($run);

    $closed = deckLiveServicesEvents('slide.closed');
    expect($closed)->toHaveCount(1)
        ->and($closed[0]->isPrivate())->toBeFalse()
        ->and($closed[0]->broadcastWith())->toMatchArray(['slide_run_id' => $run->id, 'state' => 'closed', 'state_version' => 2, 'total_responses' => 2])
        ->and($closed[0]->broadcastWith()['aggregate']['total_responses'])->toBe(2)
        ->and(deckLiveServicesEvents('slide.aggregate.updated'))->toHaveCount(0);
});

it('closes a run without results on the public channel and sends the final aggregate to the host only', function (string $type, array $config) {
    Event::fake([LiveBroadcastEvent::class]);
    $run = deckLiveServicesRun($type);
    $run->update(['config_snapshot' => $config]);
    deckLiveServicesAnswer($run);
    $run->update(['state' => DeckSessionSlideRun::STATE_CLOSED, 'state_version' => 2, 'closed_at' => now()]);

    DB::transaction(function () use ($run) {
        app(LiveAggregateService::class)->broadcastClosed($run);
        // Answers committed with the close still count: the aggregate is read after commit.
        deckLiveServicesAnswer($run);
        expect(deckLiveServicesEvents('slide.closed'))->toHaveCount(0);
    });

    $closed = deckLiveServicesEvents('slide.closed');
    $final = deckLiveServicesEvents('slide.aggregate.updated');
    expect($closed)->toHaveCount(1)
        ->and($closed[0]->isPrivate())->toBeFalse()
        ->and($closed[0]->broadcastWith()['aggregate'])->toBeNull()
        ->and($closed[0]->broadcastWith()['total_responses'])->toBeNull()
        ->and($final)->toHaveCount(1)
        ->and($final[0]->isPrivate())->toBeTrue()
        ->and($final[0]->broadcastOn()->name)->toBe("private-host.quest.v2.{$run->deck_session_id}")
        ->and($final[0]->broadcastWith()['total_responses'])->toBe(2);
})->with([
    'live type, default setting' => ['live_services_poll', []],
    'hidden reveal model, setting on' => ['live_services_hidden', ['show_results_to_participants' => true]],
]);

it('skips debouncing when the window is zero and serves the current deck snapshot', function () {
    Event::fake([LiveBroadcastEvent::class]);
    Queue::fake([BroadcastDeckAggregate::class]);
    $run = deckLiveServicesRun();
    $answer = deckLiveServicesAnswer($run);
    $run->session->update(['current_slide_run_id' => $run->id]);
    $aggregates = app(LiveAggregateService::class);

    $aggregates->schedule($run, debounceMs: 0);
    $aggregates->schedule($run, debounceMs: 0);

    expect(deckLiveServicesEvents('slide.aggregate.updated'))->toHaveCount(2)
        ->and($aggregates->currentSnapshot('quest', $run->session->fresh()))->toBe(['total_responses' => 1, 'answer_ids' => [$answer->id]])
        ->and($aggregates->currentSnapshot('quest', deckLiveServicesSession()))->toBeNull();
    Queue::assertNothingPushed();
});
