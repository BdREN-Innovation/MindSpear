<?php

use App\Deck\Broadcasts\DeckBroadcaster;
use App\Deck\Exceptions\DeckException;
use App\Deck\Participants\AnswerBroadcastPreview;
use App\Deck\Participants\AnswerSubmissionService;
use App\Deck\Participants\ParticipantReadAccess;
use App\Deck\Sessions\SessionStateMachine;
use App\Deck\Slides\Types\Quest\OpenEndedSlideType;
use App\Deck\Slides\Types\Quest\PollSingleSlideType;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Events\Live\LiveBroadcastEvent;
use App\Jobs\Deck\BroadcastDeckAggregate;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Services\Live\LiveAggregateService;
use App\Services\Live\LiveSessionService;
use App\Services\Live\ParticipantTokenService;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Cache\RateLimiter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter as RateLimiterFacade;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;

/*
 * Participant side of a Quest v2 live session (plan §3.1, §3.3, §3.6):
 * join, answers (locked insert-or-merge), my-answer and aggregate visibility.
 */

uses(DatabaseTransactions::class);

beforeEach(function () {
    // No debounce window by default: with the sync queue a trailing job would sleep it out inline.
    config([
        'broadcasting.default' => 'null',
        'cache.default' => 'array',
        'queue.default' => 'sync',
        'deck.aggregate_debounce_ms' => 0,
    ]);
    dpaArrayRateLimiter();
});

/**
 * The container's CACHE_STORE (redis) wins over phpunit.xml, and the
 * RateLimiter singleton is built at boot with it: throttle counters would
 * live in the dev Redis across tests, runs and other suites. Swap in an
 * array-backed limiter with the same named limiters (deck-join, ...).
 */
function dpaArrayRateLimiter(): void
{
    $current = app(RateLimiter::class);
    $limiters = (fn () => $this->limiters)->call($current);
    $fresh = new RateLimiter(app('cache')->store('array'));

    foreach ($limiters as $name => $callback) {
        $fresh->for($name, $callback);
    }

    RateLimiterFacade::swap($fresh);
}

/** Every Quest type that accepts answers (checked against the registry below). */
const DPA_ANSWER_TYPES = [
    'poll_single', 'poll_multi', 'word_cloud', 'open_ended', 'scales', 'ranking',
    'points_allocation', 'rating', 'matrix_2x2', 'pin_on_image',
];

const DPA_BASE = '/api/v1/quest-sessions/v2';

function dpaType(string $key): SlideTypeContract
{
    return app(SlideTypeRegistry::class)->for($key);
}

function dpaSession(string $status = DeckSession::STATUS_LIVE, string $product = Deck::PRODUCT_QUEST): DeckSession
{
    $host = DeckFactory::newOwner();
    $deck = Deck::factory()->ownedBy($host)->state(['product' => $product])->create();

    return DeckSession::factory()->create([
        'deck_id' => $deck->id,
        'host_user_id' => $host->id,
        'status' => $status,
        'started_at' => $status === DeckSession::STATUS_PENDING ? null : now(),
        'ended_at' => $status === DeckSession::STATUS_ENDED ? now() : null,
    ]);
}

/** options_snapshot from the type's default options (made-up option ids). */
function dpaOptions(string $type): array
{
    $options = [];
    foreach (dpaType($type)->defaultOptions() as $i => $option) {
        $options[] = [
            'id' => 7000 + $i + 1,
            'position' => $i + 1,
            'label' => $option['label'] ?? 'Option ' . ($i + 1),
            'image_file_id' => null,
            'image_url' => null,
            'is_correct' => null,
            'payload' => $option['payload'] ?? [],
        ];
    }

    return $options;
}

/** A run of $type with the type's default config (+ $config), made the session's current run unless $current is false. */
function dpaRun(DeckSession $session, string $type, array $config = [], string $state = DeckSessionSlideRun::STATE_VOTING, bool $current = true): DeckSessionSlideRun
{
    $config = array_replace(dpaType($type)->defaultConfig(), $config);
    if ($type === 'pin_on_image') {
        $config['media'] = ['file_id' => 1, 'url' => 'https://example.test/map.png', 'width' => 800, 'height' => 600, 'mime' => 'image/png'];
    }

    $run = DeckSessionSlideRun::factory()->inState($state)->create([
        'deck_session_id' => $session->id,
        'type_snapshot' => $type,
        'config_snapshot' => $config,
        'options_snapshot' => dpaOptions($type),
    ]);

    if ($current) {
        $session->forceFill(['current_slide_run_id' => $run->id])->save();
    }

    return $run;
}

/** @return array{participant: DeckParticipant, token: string} */
function dpaParticipant(DeckSession $session): array
{
    $participant = DeckParticipant::factory()->create(['deck_session_id' => $session->id]);

    return ['participant' => $participant, 'token' => app(ParticipantTokenService::class)->issue($participant, $session)];
}

function dpaSampleAnswer(string $type, array $optionIds): array
{
    return match ($type) {
        'poll_single' => ['option_id' => $optionIds[0]],
        'poll_multi' => ['option_ids' => [$optionIds[2], $optionIds[0]]],
        'word_cloud' => ['entries' => ['Kickoff', 'momentum']],
        'open_ended' => ['text' => 'More time for questions, please.'],
        'scales' => ['ratings' => [['option_id' => $optionIds[0], 'value' => 4]]],
        'ranking' => ['order' => array_reverse($optionIds)],
        'points_allocation' => ['allocations' => [['option_id' => $optionIds[0], 'points' => 60], ['option_id' => $optionIds[1], 'points' => 40]]],
        'rating' => ['ratings' => [['option_id' => $optionIds[1], 'value' => 5]]],
        'matrix_2x2' => ['x' => 25, 'y' => 75.5],
        'pin_on_image' => ['x' => 10.5, 'y' => 20.25],
    };
}

/** A join body carrying $session's join code unless $body sets join_code itself. */
function dpaJoinBody(DeckSession $session, array $body): array
{
    return array_key_exists('join_code', $body) ? $body : ['join_code' => $session->join_code] + $body;
}

function dpaUrl(DeckSession $session, ?DeckSessionSlideRun $run = null, string $suffix = 'answers'): string
{
    return $run === null
        ? DPA_BASE . "/{$session->id}/{$suffix}"
        : DPA_BASE . "/{$session->id}/slide-runs/{$run->id}/{$suffix}";
}

function dpaAnswerRow(DeckParticipant $participant, DeckSessionSlideRun $run): ?DeckParticipantAnswer
{
    return DeckParticipantAnswer::query()
        ->where('deck_participant_id', $participant->id)
        ->where('slide_run_id', $run->id)
        ->first();
}

/** @return Collection<int, LiveBroadcastEvent> */
function dpaEvents(string $name): Collection
{
    return Event::dispatched(LiveBroadcastEvent::class)
        ->map(fn ($call) => $call[0])
        ->filter(fn (LiveBroadcastEvent $event) => $event->broadcastAs() === $name)
        ->values();
}

/** The service with a hook that runs right before its INSERT ... ON CONFLICT DO NOTHING. */
function dpaRacingService(Closure $beforeInsert, ?Closure $insert = null): AnswerSubmissionService
{
    return new class ($beforeInsert, $insert, app(SlideTypeRegistry::class), app(LiveAggregateService::class), app(LiveSessionService::class), app(DeckBroadcaster::class)) extends AnswerSubmissionService {
        public int $inserts = 0;

        public function __construct(
            private readonly Closure $beforeInsert,
            private readonly ?Closure $insert,
            SlideTypeRegistry $registry,
            LiveAggregateService $aggregates,
            LiveSessionService $live,
            DeckBroadcaster $broadcaster,
        ) {
            parent::__construct($registry, $aggregates, $live, $broadcaster);
        }

        protected function insertAnswer(array $row): int
        {
            $this->inserts++;
            ($this->beforeInsert)($row, $this->inserts);

            return $this->insert ? ($this->insert)($row, $this->inserts, fn () => parent::insertAnswer($row)) : parent::insertAnswer($row);
        }
    };
}

// --- join --------------------------------------------------------------------

it('joins a live session with a cleaned name and a listed emoji, and broadcasts after commit', function () {
    Event::fake([LiveBroadcastEvent::class]);
    $session = dpaSession();
    $existing = dpaParticipant($session)['participant'];

    $response = $this->postJson(dpaUrl($session, null, 'participants/join'), [
        'join_code' => strtolower($session->join_code),
        'display_name' => "  Ada \t  Lovelace\u{200B}  ",
        'emoji_avatar' => '🦊',
    ])->assertCreated()
        ->assertJsonPath('status', true)
        ->assertJsonPath('data.session_id', $session->id)
        ->assertJsonPath('data.public_channel_key', $session->public_channel_key)
        ->assertJsonPath('data.display_name', 'Ada Lovelace')
        ->assertJsonPath('data.emoji_avatar', '🦊');

    $participant = DeckParticipant::findOrFail($response->json('data.participant_id'));
    $token = $response->json('data.participant_token');

    expect($participant->deck_session_id)->toBe($session->id)
        ->and($participant->display_name)->toBe('Ada Lovelace')
        ->and($participant->joined_at)->not->toBeNull()
        ->and(strlen($token))->toBe(64)
        ->and($participant->participant_token_hash)->toBe(hash('sha256', $token))
        ->and(app(ParticipantTokenService::class)->resolveDeckParticipant($token, $session)?->id)->toBe($participant->id);

    $joined = dpaEvents('participant.joined');
    expect($joined)->toHaveCount(1)
        ->and($joined[0]->isPrivate())->toBeTrue()
        ->and($joined[0]->broadcastOn()->name)->toBe("private-host.quest.v2.{$session->id}")
        ->and($joined[0]->broadcastWith())->toMatchArray([
            'participant_id' => $participant->id,
            'display_name' => 'Ada Lovelace',
            'emoji_avatar' => '🦊',
            'session_id' => $session->id,
        ])
        ->and($joined[0]->broadcastWith())->not->toHaveKey('participant_token');

    $count = dpaEvents('participant.count.updated');
    expect($count)->toHaveCount(1)
        ->and($count[0]->isPrivate())->toBeFalse()
        ->and($count[0]->broadcastOn()->name)->toBe("session.quest.{$session->public_channel_key}")
        ->and($count[0]->broadcastWith()['participant_count'])->toBe(2)
        ->and($existing->id)->not->toBe($participant->id);

    // The token works on participant routes straight away.
    $run = dpaRun($session, 'poll_single');
    $this->getJson(dpaUrl($session, $run, 'my-answer'), ['X-Participant-Token' => $token])
        ->assertNotFound()->assertJsonPath('message', 'You have not answered this slide.');
});

it('masks profanity in display names', function () {
    $session = dpaSession();

    $this->postJson(dpaUrl($session, null, 'participants/join'), dpaJoinBody($session, ['display_name' => 'Shit Happens', 'emoji_avatar' => '🐼']))
        ->assertCreated()
        ->assertJsonPath('data.display_name', '**** Happens');
});

it('validates the join body', function (array $body, string $field) {
    $session = dpaSession();

    $this->postJson(dpaUrl($session, null, 'participants/join'), dpaJoinBody($session, $body))
        ->assertUnprocessable()
        ->assertJsonPath('status', false)
        ->assertJsonPath('message', 'Validation Error')
        ->assertJsonStructure(['data' => ['validation_errors' => [$field]]]);

    expect(DeckParticipant::where('deck_session_id', $session->id)->count())->toBe(0);
})->with([
    'emoji not in the list' => [['display_name' => 'Ada', 'emoji_avatar' => '💩'], 'emoji_avatar'],
    'emoji with a variation selector' => [['display_name' => 'Ada', 'emoji_avatar' => "🦊\u{FE0F}"], 'emoji_avatar'],
    'missing emoji' => [['display_name' => 'Ada'], 'emoji_avatar'],
    'empty name' => [['display_name' => '', 'emoji_avatar' => '🦊'], 'display_name'],
    'blank name' => [['display_name' => "   \t ", 'emoji_avatar' => '🦊'], 'display_name'],
    'invisible-only name' => [['display_name' => "\u{200B}\u{FEFF}", 'emoji_avatar' => '🦊'], 'display_name'],
    'name over 40 characters' => [['display_name' => str_repeat('é', 41), 'emoji_avatar' => '🦊'], 'display_name'],
    'non-string name' => [['display_name' => ['Ada'], 'emoji_avatar' => '🦊'], 'display_name'],
    'missing join code' => [['join_code' => null, 'display_name' => 'Ada', 'emoji_avatar' => '🦊'], 'join_code'],
    'non-string join code' => [['join_code' => ['ABCDEF'], 'display_name' => 'Ada', 'emoji_avatar' => '🦊'], 'join_code'],
]);

it('accepts a 40-character name', function () {
    $session = dpaSession();

    $this->postJson(dpaUrl($session, null, 'participants/join'), dpaJoinBody($session, ['display_name' => str_repeat('é', 40), 'emoji_avatar' => '🐲']))
        ->assertCreated()
        ->assertJsonPath('data.display_name', str_repeat('é', 40));
});

it('only lets people join a live session of the route product', function () {
    Event::fake([LiveBroadcastEvent::class]);
    $body = ['display_name' => 'Ada', 'emoji_avatar' => '🦊'];

    $pending = dpaSession(DeckSession::STATUS_PENDING);
    $this->postJson(dpaUrl($pending, null, 'participants/join'), dpaJoinBody($pending, $body))
        ->assertStatus(409)
        ->assertJsonPath('data.code', DeckException::CODE_INVALID_STATE)
        ->assertJsonPath('data.session_status', 'pending');

    $ended = dpaSession(DeckSession::STATUS_ENDED);
    $this->postJson(dpaUrl($ended, null, 'participants/join'), dpaJoinBody($ended, $body))
        ->assertForbidden()
        ->assertJsonPath('message', 'This session has ended.')
        ->assertJsonPath('data.code', DeckException::CODE_FORBIDDEN)
        ->assertJsonPath('data.session_status', 'ended');

    $quiz = dpaSession(product: Deck::PRODUCT_QUIZ);
    $this->postJson(dpaUrl($quiz, null, 'participants/join'), dpaJoinBody($quiz, $body))
        ->assertNotFound()->assertJsonPath('message', 'Session not found.')->assertJsonPath('data.code', 'not_found');

    $missing = (int) DeckSession::max('id') + 1000;
    $this->postJson(DPA_BASE . "/{$missing}/participants/join", $body + ['join_code' => 'ABCDEF'])->assertNotFound()->assertJsonPath('data.code', 'not_found');

    expect(DeckParticipant::whereIn('deck_session_id', [$pending->id, $ended->id, $quiz->id])->count())->toBe(0)
        ->and(dpaEvents('participant.joined'))->toHaveCount(0)
        ->and(dpaEvents('participant.count.updated'))->toHaveCount(0);
});

it('rate-limits repeated joins per IP and display name', function () {
    $session = dpaSession();

    for ($i = 0; $i < 10; $i++) {
        $this->postJson(dpaUrl($session, null, 'participants/join'), dpaJoinBody($session, ['display_name' => 'Spammer', 'emoji_avatar' => '🦊']))->assertCreated();
    }

    $this->postJson(dpaUrl($session, null, 'participants/join'), dpaJoinBody($session, ['display_name' => ' spammer ', 'emoji_avatar' => '🦊']))->assertStatus(429);
    $this->postJson(dpaUrl($session, null, 'participants/join'), dpaJoinBody($session, ['display_name' => 'Someone else', 'emoji_avatar' => '🦊']))->assertCreated();
});

it('refuses a join without the session’s join code, exactly as if the session did not exist', function () {
    Event::fake([LiveBroadcastEvent::class]);
    $session = dpaSession();
    $ended = dpaSession(DeckSession::STATUS_ENDED);
    $other = dpaSession();
    $body = ['display_name' => 'Mallory', 'emoji_avatar' => '🦊'];
    $notFound = ['status' => false, 'message' => 'Session not found.', 'data' => ['code' => 'not_found']];

    $this->postJson(dpaUrl($session, null, 'participants/join'), $body)
        ->assertUnprocessable()->assertJsonStructure(['data' => ['validation_errors' => ['join_code']]]);

    foreach (['ZZZZZZ', $other->join_code, substr($session->join_code, 0, -1), '!!!!'] as $wrong) {
        $this->postJson(dpaUrl($session, null, 'participants/join'), $body + ['join_code' => $wrong])
            ->assertNotFound()->assertExactJson($notFound);
    }

    // A wrong code on an ended session does not reveal that the id exists (no 403).
    $this->postJson(dpaUrl($ended, null, 'participants/join'), $body + ['join_code' => 'ZZZZZZ'])
        ->assertNotFound()->assertExactJson($notFound);

    expect(DeckParticipant::whereIn('deck_session_id', [$session->id, $ended->id])->count())->toBe(0)
        ->and(dpaEvents('participant.joined'))->toHaveCount(0);

    // Case, spaces and dashes do not matter (typed codes, join links).
    $typed = implode('-', str_split(strtolower($session->join_code), 3));
    $this->postJson(dpaUrl($session, null, 'participants/join'), $body + ['join_code' => " {$typed} "])
        ->assertCreated()->assertJsonPath('data.session_id', $session->id);
});

// --- participant tokens ---------------------------------------------------------

it('answers 401 for a missing, unknown, expired, revoked or foreign token', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single');
    ['participant' => $participant, 'token' => $token] = dpaParticipant($session);
    $other = dpaSession();
    $foreign = dpaParticipant($other)['token'];
    $url = dpaUrl($session, $run);
    $body = ['answer_payload' => ['option_id' => 7001]];
    $unauthorized = ['status' => false, 'message' => 'Invalid or expired participant token.', 'data' => ['code' => 'unauthorized']];

    $this->postJson($url, $body)->assertUnauthorized()->assertExactJson($unauthorized);
    $this->postJson($url, $body, ['X-Participant-Token' => 'not-a-token'])->assertUnauthorized()->assertExactJson($unauthorized);
    $this->postJson($url, $body, ['X-Participant-Token' => $foreign])->assertUnauthorized()->assertExactJson($unauthorized);
    $this->getJson(dpaUrl($session, $run, 'my-answer'), ['X-Participant-Token' => $foreign])->assertUnauthorized();

    $participant->forceFill(['participant_token_expires_at' => now()->subMinute()])->save();
    $this->postJson($url, $body, ['X-Participant-Token' => $token])->assertUnauthorized();

    $participant->forceFill(['participant_token_expires_at' => now()->addHour()])->save();
    $this->postJson($url, $body, ['X-Participant-Token' => $token])->assertNoContent();

    app(ParticipantTokenService::class)->revokeParticipant($participant);
    $this->postJson($url, $body, ['X-Participant-Token' => $token])->assertUnauthorized()->assertExactJson($unauthorized);
    $this->getJson(dpaUrl($session, $run, 'my-answer'), ['X-Participant-Token' => $token])->assertUnauthorized();

    expect(DeckParticipantAnswer::where('slide_run_id', $run->id)->count())->toBe(1);
});

// --- answers: every type ------------------------------------------------------

it('covers every answer-accepting Quest type', function () {
    $answerTypes = collect(app(SlideTypeRegistry::class)->forProduct(Deck::PRODUCT_QUEST))
        ->filter(fn (SlideTypeContract $type) => $type->acceptsAnswers())
        ->keys()->sort()->values()->all();

    expect($answerTypes)->toBe(collect(DPA_ANSWER_TYPES)->sort()->values()->all());
});

it('stores a valid answer and tells the host, for every answer type', function (string $type) {
    Event::fake([LiveBroadcastEvent::class]);
    $this->travelTo(now()->startOfSecond());
    $session = dpaSession();
    $run = dpaRun($session, $type);
    $run->forceFill(['voting_started_at' => now()->subMilliseconds(2500)])->save();
    ['participant' => $participant, 'token' => $token] = dpaParticipant($session);
    $sample = dpaSampleAnswer($type, array_column($run->options_snapshot, 'id'));

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => $sample], ['X-Participant-Token' => $token])
        ->assertNoContent();

    $row = dpaAnswerRow($participant, $run);
    $expected = dpaType($type)->validateAnswer($sample, $run->config_snapshot, $run->options_snapshot);

    expect($row)->not->toBeNull()
        ->and($row->answer_payload)->toEqual($expected)
        ->and($row->time_to_answer_ms)->toBe(2500)
        ->and($row->submitted_at->equalTo(now()))->toBeTrue();

    $submitted = dpaEvents('answer.submitted');
    expect($submitted)->toHaveCount(1)
        ->and($submitted[0]->isPrivate())->toBeTrue()
        ->and($submitted[0]->broadcastOn()->name)->toBe("private-host.quest.v2.{$session->id}")
        ->and($submitted[0]->broadcastWith())->toMatchArray([
            'slide_run_id' => $run->id,
            'answer_id' => $row->id,
            'participant_id' => $participant->id,
            'emoji_avatar' => $participant->emoji_avatar,
            'time_to_answer_ms' => 2500,
            'total_responses' => 1,
            'is_update' => false,
        ])
        // The submission itself; open-ended bodies come with body_truncated, like the aggregate cards.
        ->and($submitted[0]->broadcastWith()['answer'])->toEqual(AnswerBroadcastPreview::make($expected));

    // Results stay on the presenter by default: the leading-edge aggregate is host-only.
    $aggregate = dpaEvents('slide.aggregate.updated');
    expect($aggregate)->toHaveCount(1)
        ->and($aggregate[0]->isPrivate())->toBeTrue()
        ->and($aggregate[0]->broadcastWith()['aggregate'])->toEqual(app(SlideTypeRegistry::class)->aggregate($run->fresh()));

    $this->getJson(dpaUrl($session, $run, 'my-answer'), ['X-Participant-Token' => $token])
        ->assertOk()
        ->assertJsonPath('data.slide_run_id', $run->id)
        ->assertJsonPath('data.time_to_answer_ms', 2500)
        ->assertJsonPath('data.submitted_at', now()->toISOString());
    expect($this->getJson(dpaUrl($session, $run, 'my-answer'), ['X-Participant-Token' => $token])->json('data.answer_payload'))
        ->toEqual($expected);
})->with(DPA_ANSWER_TYPES);

it('rejects an invalid answer with answer_payload-prefixed errors and stores nothing', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single');
    ['participant' => $participant, 'token' => $token] = dpaParticipant($session);
    $headers = ['X-Participant-Token' => $token];

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 999999]], $headers)
        ->assertUnprocessable()
        ->assertJsonPath('message', 'Validation Error')
        ->assertJsonStructure(['data' => ['validation_errors' => ['answer_payload.option_id']]]);

    $this->postJson(dpaUrl($session, $run), [], $headers)
        ->assertUnprocessable()
        ->assertJsonStructure(['data' => ['validation_errors' => ['answer_payload']]]);

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => 'A'], $headers)
        ->assertUnprocessable()
        ->assertJsonStructure(['data' => ['validation_errors' => ['answer_payload']]]);

    $points = dpaRun($session, 'points_allocation');
    $this->postJson(dpaUrl($session, $points), ['answer_payload' => ['allocations' => [['option_id' => 7001, 'points' => 50]]]], $headers)
        ->assertUnprocessable()
        ->assertJsonStructure(['data' => ['validation_errors' => ['answer_payload.allocations']]]);

    expect(DeckParticipantAnswer::where('deck_participant_id', $participant->id)->count())->toBe(0);
});

// --- answers: when they are accepted --------------------------------------------

it('answers 409 when the run is not the current one', function () {
    $session = dpaSession();
    $old = dpaRun($session, 'poll_single');
    dpaRun($session, 'poll_single');
    ['participant' => $participant, 'token' => $token] = dpaParticipant($session);

    $this->postJson(dpaUrl($session, $old), ['answer_payload' => ['option_id' => 7001]], ['X-Participant-Token' => $token])
        ->assertStatus(409)
        ->assertJsonPath('message', 'Not accepting answers.')
        ->assertJsonPath('data.code', DeckException::CODE_INVALID_STATE)
        ->assertJsonPath('data.reason', 'not_current_slide');

    expect(dpaAnswerRow($participant, $old))->toBeNull();
});

it('answers 409 unless the current run is voting', function (string $state) {
    Event::fake([LiveBroadcastEvent::class]);
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single', state: $state);
    ['participant' => $participant, 'token' => $token] = dpaParticipant($session);

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 7001]], ['X-Participant-Token' => $token])
        ->assertStatus(409)
        ->assertJsonPath('data.code', DeckException::CODE_INVALID_STATE)
        ->assertJsonPath('data.reason', 'not_voting')
        ->assertJsonPath('data.state', $state);

    expect(dpaAnswerRow($participant, $run))->toBeNull()
        ->and(dpaEvents('answer.submitted'))->toHaveCount(0);
})->with([
    DeckSessionSlideRun::STATE_WAITING,
    DeckSessionSlideRun::STATE_GET_READY,
    DeckSessionSlideRun::STATE_CLOSED,
]);

it('stops taking answers once a timed slide runs out, after a short grace', function () {
    $this->travelTo(now()->startOfSecond());
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single');
    $run->forceFill(['time_limit_seconds' => 10, 'voting_started_at' => now()->subMilliseconds(10_000 + AnswerSubmissionService::DEADLINE_GRACE_MS)])->save();
    ['participant' => $onTime, 'token' => $onTimeToken] = dpaParticipant($session);
    ['participant' => $late, 'token' => $lateToken] = dpaParticipant($session);

    // Exactly at deadline + grace still counts (the timer job has not closed the run yet).
    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 7001]], ['X-Participant-Token' => $onTimeToken])->assertNoContent();

    $this->travel(1)->milliseconds();
    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 7001]], ['X-Participant-Token' => $lateToken])
        ->assertStatus(409)
        ->assertJsonPath('data.reason', 'time_up')
        ->assertJsonPath('data.state', 'voting');

    expect(dpaAnswerRow($onTime, $run)->time_to_answer_ms)->toBe(11_000)
        ->and(dpaAnswerRow($late, $run))->toBeNull();
});

it('answers 409 for slides that take no answers and 404 for runs of another session', function () {
    $session = dpaSession();
    ['token' => $token] = dpaParticipant($session);
    $headers = ['X-Participant-Token' => $token];

    $heading = dpaRun($session, 'heading');
    $this->postJson(dpaUrl($session, $heading), ['answer_payload' => ['option_id' => 1]], $headers)
        ->assertStatus(409)->assertJsonPath('data.reason', 'no_answers');

    $qa = dpaRun($session, 'qa_audience', state: DeckSessionSlideRun::STATE_OPEN);
    $this->postJson(dpaUrl($session, $qa), ['answer_payload' => ['text' => 'Hi']], $headers)
        ->assertStatus(409)->assertJsonPath('data.reason', 'no_answers');

    $other = dpaSession();
    $foreignRun = dpaRun($other, 'poll_single');
    $this->postJson(dpaUrl($session, $foreignRun), ['answer_payload' => ['option_id' => 7001]], $headers)
        ->assertNotFound()->assertJsonPath('message', 'Slide not found in this session.');
    $this->getJson(dpaUrl($session, $foreignRun, 'my-answer'), $headers)->assertNotFound();

    expect(DeckParticipantAnswer::where('slide_run_id', $foreignRun->id)->count())->toBe(0);
});

it('answers 409 when the session is no longer live', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single');
    ['token' => $token] = dpaParticipant($session);
    $session->forceFill(['status' => DeckSession::STATUS_ENDED, 'ended_at' => now()])->save();

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 7001]], ['X-Participant-Token' => $token])
        ->assertStatus(409)
        ->assertJsonPath('data.reason', 'session_not_live')
        ->assertJsonPath('data.session_status', 'ended');
});

it('answers 413 for a body over config(deck.max_answer_body_kb)', function () {
    config(['deck.max_answer_body_kb' => 4]);
    $session = dpaSession();
    $run = dpaRun($session, 'open_ended', ['max_length' => 2000]);
    ['participant' => $participant, 'token' => $token] = dpaParticipant($session);
    $headers = ['X-Participant-Token' => $token];

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['text' => str_repeat('a', 5000)]], $headers)
        ->assertStatus(413)
        ->assertJsonPath('status', false)
        ->assertJsonPath('data.code', 'payload_too_large')
        ->assertJsonPath('data.max_kb', 4);

    // Checked before the token: no lookup for an oversized body.
    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['text' => str_repeat('a', 5000)]])->assertStatus(413);

    expect(dpaAnswerRow($participant, $run))->toBeNull();

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['text' => str_repeat('a', 1500)]], $headers)->assertNoContent();
});

it('uses the default 32 KB cap', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'word_cloud');
    ['token' => $token] = dpaParticipant($session);

    expect(config('deck.max_answer_body_kb'))->toBe(32);

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['entries' => [str_repeat('x', 33 * 1024)]]], ['X-Participant-Token' => $token])
        ->assertStatus(413)->assertJsonPath('data.max_kb', 32);
});

// --- answers: merge vs replace ------------------------------------------------------

it('replaces the answer of a non-appending type and flags the update', function () {
    Event::fake([LiveBroadcastEvent::class]);
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single');
    ['participant' => $participant, 'token' => $token] = dpaParticipant($session);
    $headers = ['X-Participant-Token' => $token];

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 7001]], $headers)->assertNoContent();
    $first = dpaAnswerRow($participant, $run);
    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 7002]], $headers)->assertNoContent();
    $second = dpaAnswerRow($participant, $run);

    expect($second->id)->toBe($first->id)
        ->and($second->answer_payload)->toBe(['option_id' => 7002])
        ->and(DeckParticipantAnswer::where('slide_run_id', $run->id)->count())->toBe(1);

    $submitted = dpaEvents('answer.submitted');
    expect($submitted)->toHaveCount(2)
        ->and($submitted[0]->broadcastWith()['is_update'])->toBeFalse()
        ->and($submitted[1]->broadcastWith())->toMatchArray(['is_update' => true, 'total_responses' => 1, 'answer' => ['option_id' => 7002]]);
});

it('merges word cloud submissions when multiple submissions are on, up to the cap', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'word_cloud', ['allow_multiple_submissions' => true, 'max_entries_per_participant' => 3]);
    ['participant' => $participant, 'token' => $token] = dpaParticipant($session);
    $headers = ['X-Participant-Token' => $token];

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['entries' => ['alpha']]], $headers)->assertNoContent();
    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['entries' => ['beta', 'ALPHA']]], $headers)->assertNoContent();

    $row = dpaAnswerRow($participant, $run);
    expect($row->answer_payload['entries'])->toBe(['alpha', 'beta'])
        ->and($row->answer_payload['entry_times'])->toHaveCount(2);

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['entries' => ['gamma', 'delta']]], $headers)
        ->assertUnprocessable()
        ->assertJsonStructure(['data' => ['validation_errors' => ['answer_payload.entries']]]);

    expect(dpaAnswerRow($participant, $run)->answer_payload['entries'])->toBe(['alpha', 'beta']);
});

it('replaces word cloud entries when multiple submissions are off', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'word_cloud', ['allow_multiple_submissions' => false]);
    ['participant' => $participant, 'token' => $token] = dpaParticipant($session);
    $headers = ['X-Participant-Token' => $token];

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['entries' => ['alpha']]], $headers)->assertNoContent();
    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['entries' => ['beta']]], $headers)->assertNoContent();

    expect(dpaAnswerRow($participant, $run)->answer_payload['entries'])->toBe(['beta']);
});

it('appends open ended responses up to max_submissions_per_participant, and replaces at 1', function () {
    $session = dpaSession();
    $multi = dpaRun($session, 'open_ended', ['max_submissions_per_participant' => 2]);
    ['participant' => $participant, 'token' => $token] = dpaParticipant($session);
    $headers = ['X-Participant-Token' => $token];

    $this->postJson(dpaUrl($session, $multi), ['answer_payload' => ['text' => 'First']], $headers)->assertNoContent();
    $this->postJson(dpaUrl($session, $multi), ['answer_payload' => ['text' => 'Second']], $headers)->assertNoContent();
    $this->postJson(dpaUrl($session, $multi), ['answer_payload' => ['text' => 'Third']], $headers)
        ->assertUnprocessable()
        ->assertJsonStructure(['data' => ['validation_errors' => ['answer_payload.text']]]);

    expect(array_column(dpaAnswerRow($participant, $multi)->answer_payload['entries'], 'body'))->toBe(['First', 'Second']);

    $single = dpaRun($session, 'open_ended');
    $this->postJson(dpaUrl($session, $single), ['answer_payload' => ['text' => 'First']], $headers)->assertNoContent();
    $this->postJson(dpaUrl($session, $single), ['answer_payload' => ['text' => 'Changed my mind']], $headers)->assertNoContent();

    expect(array_column(dpaAnswerRow($participant, $single)->answer_payload['entries'], 'body'))->toBe(['Changed my mind']);
});

// --- answers: concurrency -------------------------------------------------------------

it('keeps both entries of back-to-back submissions through the locked insert-or-merge path', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'word_cloud', ['allow_multiple_submissions' => true]);
    ['participant' => $participant, 'token' => $token] = dpaParticipant($session);
    $headers = ['X-Participant-Token' => $token];

    $queries = [];
    DB::listen(function ($query) use (&$queries) {
        $queries[] = strtolower($query->sql);
    });

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['entries' => ['first']]], $headers)->assertNoContent();
    $firstRequest = $queries;
    $queries = [];
    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['entries' => ['second']]], $headers)->assertNoContent();

    $find = fn (array $sqls, string ...$needles) => collect($sqls)->search(
        fn (string $sql) => collect($needles)->every(fn ($needle) => str_contains($sql, $needle))
    );

    // Both requests lock the run against a concurrent close and insert with ON CONFLICT DO NOTHING.
    foreach ([$firstRequest, $queries] as $sqls) {
        expect($find($sqls, 'from "deck_session_slide_runs"', 'for share'))->not->toBeFalse()
            ->and($find($sqls, 'insert into "deck_participant_answers"', 'on conflict do nothing'))->not->toBeFalse();
    }

    // Only the second one found a row and merged it under FOR UPDATE.
    $insert = $find($queries, 'insert into "deck_participant_answers"', 'on conflict do nothing');
    $lock = $find($queries, 'from "deck_participant_answers"', 'for update');
    $update = $find($queries, 'update "deck_participant_answers"');
    expect($find($firstRequest, 'from "deck_participant_answers"', 'for update'))->toBeFalse()
        ->and($lock)->toBeGreaterThan($insert)
        ->and($update)->toBeGreaterThan($lock)
        ->and(dpaAnswerRow($participant, $run)->answer_payload['entries'])->toBe(['first', 'second'])
        ->and(DeckParticipantAnswer::where('slide_run_id', $run->id)->count())->toBe(1);
});

it('merges into a row a racing submission inserted first instead of failing on the unique index', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'word_cloud', ['allow_multiple_submissions' => true]);
    ['participant' => $participant] = dpaParticipant($session);
    $run->setRelation('session', $session->load('deck'));

    // The racing request wins between our checks and our INSERT.
    $service = dpaRacingService(function (array $row, int $call) use ($participant, $run) {
        if ($call === 1) {
            DeckParticipantAnswer::create([
                'deck_participant_id' => $participant->id,
                'slide_run_id' => $run->id,
                'answer_payload' => ['entries' => ['racer'], 'entry_times' => [now()->subSecond()->toISOString()]],
                'submitted_at' => now()->subSecond(),
            ]);
        }
    });

    $result = $service->submit($session, $participant, $run, ['entries' => ['mine']]);

    expect($service->inserts)->toBe(1)
        ->and($result->isUpdate)->toBeTrue()
        ->and($result->merged)->toBeTrue()
        ->and(dpaAnswerRow($participant, $run)->answer_payload['entries'])->toBe(['racer', 'mine'])
        ->and(DeckParticipantAnswer::where('slide_run_id', $run->id)->count())->toBe(1);

    // A plain INSERT would have hit the unique index; the service's ON CONFLICT path never does.
    expect(fn () => DB::transaction(fn () => DeckParticipantAnswer::query()->insert([
        'deck_participant_id' => $participant->id,
        'slide_run_id' => $run->id,
        'answer_payload' => '{}',
    ])))->toThrow(Illuminate\Database\UniqueConstraintViolationException::class);
});

it('replaces a racing row for replace-type answers', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single');
    ['participant' => $participant] = dpaParticipant($session);
    $run->setRelation('session', $session->load('deck'));

    $service = dpaRacingService(function (array $row, int $call) use ($participant, $run) {
        if ($call === 1) {
            DeckParticipantAnswer::create([
                'deck_participant_id' => $participant->id,
                'slide_run_id' => $run->id,
                'answer_payload' => ['option_id' => 7001],
                'submitted_at' => now(),
            ]);
        }
    });

    $result = $service->submit($session, $participant, $run, ['option_id' => 7002]);

    expect($result->isUpdate)->toBeTrue()
        ->and($result->merged)->toBeFalse()
        ->and(dpaAnswerRow($participant, $run)->answer_payload)->toBe(['option_id' => 7002]);
});

it('retries when the conflicting row vanished, and gives up with 409 after MAX_ATTEMPTS', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single');
    ['participant' => $participant] = dpaParticipant($session);
    $run->setRelation('session', $session->load('deck'));

    // First INSERT reports a conflict but no row is there (the other transaction rolled back / was deleted).
    $service = dpaRacingService(fn () => null, fn (array $row, int $call, Closure $insert) => $call === 1 ? 0 : $insert());
    $result = $service->submit($session, $participant, $run, ['option_id' => 7001]);

    expect($service->inserts)->toBe(2)
        ->and($result->isUpdate)->toBeFalse()
        ->and(dpaAnswerRow($participant, $run)->answer_payload)->toBe(['option_id' => 7001]);

    $other = dpaParticipant($session)['participant'];
    $stuck = dpaRacingService(fn () => null, fn () => 0);

    expect(fn () => $stuck->submit($session, $other, $run, ['option_id' => 7001]))
        ->toThrow(fn (DeckException $e) => expect([$e->status, $e->errorCode])->toBe([409, DeckException::CODE_CONFLICT]))
        ->and($stuck->inserts)->toBe(AnswerSubmissionService::MAX_ATTEMPTS)
        ->and(dpaAnswerRow($other, $run))->toBeNull();
});

it('re-checks the run state inside the transaction', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single');
    ['participant' => $participant] = dpaParticipant($session);
    $run->setRelation('session', $session->load('deck'));

    // The host closes the slide after our unlocked check but before the locked one: the stale model still says voting.
    DeckSessionSlideRun::whereKey($run->id)->update(['state' => DeckSessionSlideRun::STATE_CLOSED, 'closed_at' => now()]);

    expect(fn () => app(AnswerSubmissionService::class)->submit($session, $participant, $run, ['option_id' => 7001]))
        ->toThrow(fn (DeckException $e) => expect($e->extra['reason'])->toBe('not_voting'))
        ->and(dpaAnswerRow($participant, $run))->toBeNull();
});

it('prefixes merge-cap errors from the service', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'word_cloud', ['allow_multiple_submissions' => true, 'max_entries_per_participant' => 1]);
    ['participant' => $participant] = dpaParticipant($session);
    $run->setRelation('session', $session->load('deck'));
    $service = app(AnswerSubmissionService::class);

    $service->submit($session, $participant, $run, ['entries' => ['one']]);

    expect(fn () => $service->submit($session, $participant, $run, ['entries' => ['two']]))
        ->toThrow(fn (ValidationException $e) => expect(array_keys($e->errors()))->toBe(['answer_payload.entries']));
});

// --- answers: aggregate scheduling --------------------------------------------------

it('schedules the run aggregate after every accepted answer', function () {
    $spy = $this->spy(LiveAggregateService::class);
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single');
    ['token' => $token] = dpaParticipant($session);

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 7001]], ['X-Participant-Token' => $token])->assertNoContent();
    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 7002]], ['X-Participant-Token' => $token])->assertNoContent();
    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 0]], ['X-Participant-Token' => $token])->assertUnprocessable();

    $spy->shouldHaveReceived('schedule')
        ->twice()
        ->withArgs(fn ($scheduled) => $scheduled instanceof DeckSessionSlideRun
            && $scheduled->id === $run->id
            && $scheduled->relationLoaded('session'));
});

it('debounces aggregate broadcasts: leading edge now, one trailing job for the burst', function () {
    config(['deck.aggregate_debounce_ms' => 500]);
    Event::fake([LiveBroadcastEvent::class]);
    Queue::fake([BroadcastDeckAggregate::class]);
    $this->travelTo(now()->startOfSecond());
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single', ['show_results_to_participants' => true]);

    foreach (range(1, 3) as $i) {
        ['token' => $token] = dpaParticipant($session);
        $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 7001]], ['X-Participant-Token' => $token])->assertNoContent();
    }

    $aggregates = dpaEvents('slide.aggregate.updated');
    expect($aggregates)->toHaveCount(1)
        ->and($aggregates[0]->isPrivate())->toBeFalse()
        ->and($aggregates[0]->broadcastOn()->name)->toBe("session.quest.{$session->public_channel_key}")
        ->and($aggregates[0]->broadcastWith()['total_responses'])->toBe(1)
        ->and(dpaEvents('answer.submitted')->map(fn ($event) => $event->broadcastWith()['total_responses'])->all())->toBe([1, 2, 3]);
    Queue::assertPushed(BroadcastDeckAggregate::class, 1);
});

// --- my-answer --------------------------------------------------------------------------

it('returns only the caller’s own answer', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single');
    ['token' => $mine] = dpaParticipant($session);
    ['token' => $theirs] = dpaParticipant($session);

    $this->getJson(dpaUrl($session, $run, 'my-answer'), ['X-Participant-Token' => $mine])
        ->assertNotFound()->assertJsonPath('data.code', 'not_found');

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 7002]], ['X-Participant-Token' => $theirs])->assertNoContent();
    $this->getJson(dpaUrl($session, $run, 'my-answer'), ['X-Participant-Token' => $mine])->assertNotFound();

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 7001]], ['X-Participant-Token' => $mine])->assertNoContent();
    // Still readable after the slide closed (review screen).
    $run->forceFill(['state' => DeckSessionSlideRun::STATE_CLOSED, 'closed_at' => now()])->save();

    $this->getJson(dpaUrl($session, $run, 'my-answer'), ['X-Participant-Token' => $mine])
        ->assertOk()
        ->assertJsonPath('data.answer_payload', ['option_id' => 7001])
        ->assertJsonStructure(['data' => ['slide_run_id', 'answer_payload', 'time_to_answer_ms', 'submitted_at']]);
});

// --- aggregate --------------------------------------------------------------------------

it('gives the host the aggregate even when participants may not see it', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single');
    ['token' => $token] = dpaParticipant($session);
    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 7001]], ['X-Participant-Token' => $token])->assertNoContent();

    $this->getJson(dpaUrl($session, $run, 'aggregate'), ['X-Participant-Token' => $token])
        ->assertForbidden()
        ->assertJsonPath('status', false)
        ->assertJsonPath('data.code', 'results_hidden');

    Sanctum::actingAs($session->host);

    $this->getJson(dpaUrl($session, $run, 'aggregate'))
        ->assertOk()
        ->assertJsonPath('data.slide_run_id', $run->id)
        ->assertJsonPath('data.type', 'poll_single')
        ->assertJsonPath('data.state', 'voting')
        ->assertJsonPath('data.final', false)
        ->assertJsonPath('data.visibility', 'host')
        ->assertJsonPath('data.total_responses', 1)
        ->assertJsonPath('data.aggregate.total_votes', 1)
        ->assertJsonPath('data.aggregate.options.0.option_id', 7001)
        ->assertJsonPath('data.aggregate.options.0.count', 1);
});

it('gives participants the aggregate only when the slide shows results to them', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'scales', ['show_results_to_participants' => true]);
    ['token' => $token] = dpaParticipant($session);
    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['ratings' => [['option_id' => 7002, 'value' => 5]]]], ['X-Participant-Token' => $token])
        ->assertNoContent();

    $response = $this->getJson(dpaUrl($session, $run, 'aggregate'), ['X-Participant-Token' => $token])
        ->assertOk()
        ->assertJsonPath('data.visibility', 'public')
        ->assertJsonPath('data.total_responses', 1);

    expect($response->json('data.aggregate'))->toEqual(app(SlideTypeRegistry::class)->aggregate($run->fresh()));

    // Content and Q&A slides never show participants an aggregate here.
    $heading = dpaRun($session, 'heading', current: false);
    $this->getJson(dpaUrl($session, $heading, 'aggregate'), ['X-Participant-Token' => $token])
        ->assertForbidden()->assertJsonPath('data.code', 'results_hidden');
});

it('returns the frozen final aggregate of a closed run', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'poll_multi', ['show_results_to_participants' => true]);
    ['token' => $first] = dpaParticipant($session);
    ['token' => $late] = dpaParticipant($session);
    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_ids' => [7001, 7003]]], ['X-Participant-Token' => $first])->assertNoContent();

    $run->forceFill(['state' => DeckSessionSlideRun::STATE_CLOSED, 'state_version' => 5, 'closed_at' => now()])->save();
    $before = $this->getJson(dpaUrl($session, $run, 'aggregate'), ['X-Participant-Token' => $first])->assertOk()->json('data');

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_ids' => [7002]]], ['X-Participant-Token' => $late])
        ->assertStatus(409)->assertJsonPath('data.reason', 'not_voting');

    $after = $this->getJson(dpaUrl($session, $run, 'aggregate'), ['X-Participant-Token' => $late])->assertOk()->json('data');

    expect($before['final'])->toBeTrue()
        ->and($before['state'])->toBe('closed')
        ->and($before['state_version'])->toBe(5)
        ->and($before['closed_at'])->not->toBeNull()
        ->and($after['aggregate'])->toBe($before['aggregate'])
        ->and($after['aggregate']['total_responses'])->toBe(1)
        ->and(collect($after['aggregate']['options'])->pluck('count', 'option_id')->all())->toBe([7001 => 1, 7002 => 0, 7003 => 1]);
});

it('pages open ended cards on ?page=N', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'open_ended', ['show_results_to_participants' => true]);
    ['token' => $token] = dpaParticipant($session);
    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['text' => str_repeat('long ', 60)]], ['X-Participant-Token' => $token])->assertNoContent();

    $preview = $this->getJson(dpaUrl($session, $run, 'aggregate'), ['X-Participant-Token' => $token])->assertOk();
    expect($preview->json('data.aggregate.per_page'))->toBe(10)
        ->and($preview->json('data.aggregate.items.0.body_truncated'))->toBeTrue();

    $page = $this->getJson(dpaUrl($session, $run, 'aggregate') . '?page=1', ['X-Participant-Token' => $token])->assertOk();
    expect($page->json('data.aggregate.per_page'))->toBe(20)
        ->and($page->json('data.aggregate.items.0.body'))->toBe(trim(str_repeat('long ', 60)))
        ->and($page->json('data.aggregate.items.0.body_truncated'))->toBeFalse();

    $this->getJson(dpaUrl($session, $run, 'aggregate') . '?page=0', ['X-Participant-Token' => $token])
        ->assertUnprocessable()->assertJsonStructure(['data' => ['validation_errors' => ['page']]]);
});

it('guards the aggregate: 401 without credentials, 404 for strangers, other products and foreign runs', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single', ['show_results_to_participants' => true]);
    $url = dpaUrl($session, $run, 'aggregate');
    $foreign = dpaParticipant(dpaSession())['token'];

    $this->getJson($url)->assertUnauthorized()->assertJsonPath('data.code', 'unauthorized');
    $this->getJson($url, ['X-Participant-Token' => 'nope'])->assertUnauthorized();
    $this->getJson($url, ['X-Participant-Token' => $foreign])->assertUnauthorized();

    $quiz = dpaSession(product: Deck::PRODUCT_QUIZ);
    $quizRun = dpaRun($quiz, 'heading');
    Sanctum::actingAs($quiz->host);
    $this->getJson(dpaUrl($quiz, $quizRun, 'aggregate'))->assertNotFound()->assertJsonPath('message', 'Session not found.');

    Sanctum::actingAs(DeckFactory::newOwner());
    $this->getJson($url)->assertNotFound()->assertJsonPath('message', 'Session not found.');

    // A signed-in user who also plays (sends a token) is treated as a participant.
    ['token' => $token] = dpaParticipant($session);
    $this->getJson($url, ['X-Participant-Token' => $token])->assertOk()->assertJsonPath('data.visibility', 'public');

    Sanctum::actingAs($session->host);
    $otherRun = dpaRun(dpaSession(), 'poll_single');
    $this->getJson(dpaUrl($session, $otherRun, 'aggregate'))->assertNotFound()->assertJsonPath('message', 'Slide not found in this session.');
});

// --- unsupported types -----------------------------------------------------------------

it('rejects answers to slide types the session product does not offer', function (string $type) {
    Event::fake([LiveBroadcastEvent::class]);
    app(SlideTypeRegistry::class)->register(new class () extends PollSingleSlideType {
        public function key(): string
        {
            return 'dpa_quiz_only';
        }

        public function products(): array
        {
            return [Deck::PRODUCT_QUIZ];
        }
    });

    $session = dpaSession();
    $run = DeckSessionSlideRun::factory()->inState(DeckSessionSlideRun::STATE_VOTING)->create([
        'deck_session_id' => $session->id,
        'type_snapshot' => $type,
        'config_snapshot' => dpaType('poll_single')->defaultConfig(),
        'options_snapshot' => dpaOptions('poll_single'),
    ]);
    $session->forceFill(['current_slide_run_id' => $run->id])->save();
    ['token' => $token] = dpaParticipant($session);

    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 7001]], ['X-Participant-Token' => $token])
        ->assertUnprocessable()
        ->assertJsonPath('status', false)
        ->assertJsonPath('data.code', DeckException::CODE_UNSUPPORTED_TYPE)
        ->assertJsonPath('data.type', $type)
        ->assertJsonStructure(['data' => ['validation_errors' => ['type']]]);

    expect(DeckParticipantAnswer::where('slide_run_id', $run->id)->count())->toBe(0)
        ->and(dpaEvents('answer.submitted'))->toHaveCount(0)
        ->and(dpaEvents('slide.aggregate.updated'))->toHaveCount(0);
})->with([
    'a Quiz-only type' => ['dpa_quiz_only'],
    'a type no product registers' => ['pick_answer_single'],
]);

// --- answer.submitted size ---------------------------------------------------------------

/** Bytes of the Pusher HTTP body for $event (data JSON-encoded inside the JSON body, as pusher-php-server sends it). */
function dpaPusherBytes(LiveBroadcastEvent $event): int
{
    $channel = $event->broadcastOn()->name;

    return strlen(json_encode([
        'name' => $event->broadcastAs(),
        'data' => json_encode($event->broadcastWith()),
        'channels' => [$channel],
    ]));
}

it('keeps answer.submitted under Reverb’s 10,000-byte limit and sends only the new submission', function (string $type, array $config, Closure $submission, int $times) {
    Event::fake([LiveBroadcastEvent::class]);
    $session = dpaSession();
    $run = dpaRun($session, $type, $config);
    ['participant' => $participant, 'token' => $token] = dpaParticipant($session);
    $participant->forceFill(['display_name' => str_repeat('🦊', 40), 'emoji_avatar' => '🦊'])->save();

    for ($i = 0; $i < $times; $i++) {
        $this->postJson(dpaUrl($session, $run), ['answer_payload' => $submission($i)], ['X-Participant-Token' => $token])->assertNoContent();
    }

    $events = dpaEvents('answer.submitted');
    expect($events)->toHaveCount($times);

    foreach ($events as $event) {
        expect(dpaPusherBytes($event))->toBeLessThan(10_000)
            ->and(AnswerBroadcastPreview::bytes($event->broadcastWith()['answer']))->toBeLessThanOrEqual(AnswerBroadcastPreview::BUDGET_BYTES);
    }

    $last = $events->last()->broadcastWith();
    $stored = dpaAnswerRow($participant, $run)->answer_payload;
    expect($last['is_update'])->toBe($times > 1)
        ->and($last['total_responses'])->toBe(1);

    if ($type === 'open_ended') {
        // The stored row keeps every full response; the event only the last one, cut to the preview length.
        expect($stored['entries'])->toHaveCount($times)
            ->and(mb_strlen($stored['entries'][0]['body']))->toBe(2000)
            ->and($last['answer']['entries'])->toHaveCount(1)
            ->and($last['answer']['entries'][0]['body_truncated'])->toBeTrue()
            ->and(mb_strlen($last['answer']['entries'][0]['body']))->toBeLessThanOrEqual(OpenEndedSlideType::PREVIEW_LENGTH)
            ->and($stored['entries'][$times - 1]['body'])->toStartWith($last['answer']['entries'][0]['body']);
    } else {
        // Every word stays (the host ticker shows them), each cut short, with truncated: true.
        expect($stored['entries'])->toHaveCount(10)
            ->and(mb_strlen($stored['entries'][0]))->toBe(100)
            ->and($last['answer']['truncated'] ?? false)->toBeTrue()
            ->and($last['answer']['entries'])->toHaveCount(10)
            ->and(mb_strlen($last['answer']['entries'][0]))->toBeLessThan(100)
            ->and($last['answer']['entry_times'])->toBe($stored['entry_times']);
    }
})->with([
    'open_ended, 2,000 Bengali characters, 5 submissions' => [
        'open_ended',
        ['max_length' => 2000, 'max_submissions_per_participant' => 5],
        fn (int $i) => ['text' => str_repeat('ক', 1999) . $i],
        5,
    ],
    'open_ended, 2,000 emoji' => [
        'open_ended',
        ['max_length' => 2000, 'max_submissions_per_participant' => 2],
        fn (int $i) => ['text' => str_repeat('🦊', 1999) . $i],
        2,
    ],
    'word_cloud, 10 entries of 100 non-Latin characters' => [
        'word_cloud',
        ['max_entries_per_participant' => 10, 'max_entry_length' => 100],
        fn (int $i) => ['entries' => array_map(fn ($n) => str_repeat('ক', 99) . $n, range(0, 9))],
        1,
    ],
]);

it('leaves small answers whole and omits an answer that cannot be cut to size', function () {
    expect(AnswerBroadcastPreview::make(['option_ids' => [1, 2, 3]]))->toBe(['option_ids' => [1, 2, 3]])
        ->and(AnswerBroadcastPreview::make(['entries' => [['body' => 'Hi', 'submitted_at' => '2026-10-18T10:00:00.000000Z']]]))
        ->toBe(['entries' => [['body' => 'Hi', 'submitted_at' => '2026-10-18T10:00:00.000000Z', 'body_truncated' => false]]])
        ->and(AnswerBroadcastPreview::make(['allocations' => array_fill(0, 2000, ['option_id' => 123456, 'points' => 1])]))
        ->toBe(['omitted' => true]);
});

// --- post-session review -------------------------------------------------------------------

it('lets participants read their own answers and public results after the session ended, but not write', function () {
    $session = dpaSession();
    $public = dpaRun($session, 'poll_single', ['show_results_to_participants' => true]);
    ['participant' => $participant, 'token' => $token] = dpaParticipant($session);
    ['participant' => $removed, 'token' => $removedToken] = dpaParticipant($session);
    $headers = ['X-Participant-Token' => $token];

    $this->postJson(dpaUrl($session, $public), ['answer_payload' => ['option_id' => 7002]], $headers)->assertNoContent();
    $this->postJson(dpaUrl($session, $public), ['answer_payload' => ['option_id' => 7001]], ['X-Participant-Token' => $removedToken])->assertNoContent();
    $public->forceFill(['state' => DeckSessionSlideRun::STATE_CLOSED, 'closed_at' => now()])->save();

    $hidden = dpaRun($session, 'poll_single');
    $this->postJson(dpaUrl($session, $hidden), ['answer_payload' => ['option_id' => 7001]], $headers)->assertNoContent();

    // Removed by the host during the session: stays locked out afterwards.
    app(ParticipantTokenService::class)->revokeParticipant($removed);
    $this->travel(2)->seconds();

    app(SessionStateMachine::class)->end($session->fresh());
    expect($session->fresh()->status)->toBe(DeckSession::STATUS_ENDED)
        ->and($participant->fresh()->participant_token_revoked_at)->not->toBeNull();

    $this->getJson(dpaUrl($session, $public, 'my-answer'), $headers)
        ->assertOk()->assertJsonPath('data.answer_payload', ['option_id' => 7002]);
    $this->getJson(dpaUrl($session, $hidden, 'my-answer'), $headers)
        ->assertOk()->assertJsonPath('data.answer_payload', ['option_id' => 7001]);

    $this->getJson(dpaUrl($session, $public, 'aggregate'), $headers)
        ->assertOk()
        ->assertJsonPath('data.final', true)
        ->assertJsonPath('data.visibility', 'public')
        ->assertJsonPath('data.total_responses', 2);
    $this->getJson(dpaUrl($session, $hidden, 'aggregate'), $headers)
        ->assertForbidden()->assertJsonPath('data.code', 'results_hidden');

    // Writes keep the strict token check.
    $this->postJson(dpaUrl($session, $hidden), ['answer_payload' => ['option_id' => 7002]], $headers)
        ->assertUnauthorized()->assertJsonPath('data.code', 'unauthorized');

    $removedHeaders = ['X-Participant-Token' => $removedToken];
    $this->getJson(dpaUrl($session, $public, 'my-answer'), $removedHeaders)->assertUnauthorized();
    $this->getJson(dpaUrl($session, $public, 'aggregate'), $removedHeaders)->assertUnauthorized();

    // Tokens of another ended session or made-up ones do not work.
    $foreignSession = dpaSession();
    ['token' => $foreign] = dpaParticipant($foreignSession);
    app(SessionStateMachine::class)->end($foreignSession);
    $this->getJson(dpaUrl($session, $public, 'my-answer'), ['X-Participant-Token' => $foreign])->assertUnauthorized();
    $this->getJson(dpaUrl($session, $public, 'aggregate'), ['X-Participant-Token' => Str::random(64)])->assertUnauthorized();

    // Not past the token's own expiry.
    $this->travel(7)->hours();
    $this->getJson(dpaUrl($session, $public, 'my-answer'), $headers)->assertUnauthorized();
    $this->getJson(dpaUrl($session, $public, 'aggregate'), $headers)->assertUnauthorized();
});

it('does not take a revoked token for reads while the session is live', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single', ['show_results_to_participants' => true]);
    ['participant' => $participant, 'token' => $token] = dpaParticipant($session);
    app(ParticipantTokenService::class)->revokeParticipant($participant);

    $this->getJson(dpaUrl($session, $run, 'my-answer'), ['X-Participant-Token' => $token])->assertUnauthorized();
    $this->getJson(dpaUrl($session, $run, 'aggregate'), ['X-Participant-Token' => $token])->assertUnauthorized();
});

// --- runs not reached yet --------------------------------------------------------------------

it('hides the aggregate of runs the host has not reached from participants', function () {
    $session = dpaSession();
    $heading = dpaRun($session, 'heading', state: DeckSessionSlideRun::STATE_WAITING);
    $future = dpaRun($session, 'poll_single', ['show_results_to_participants' => true], DeckSessionSlideRun::STATE_WAITING, current: false);
    ['token' => $token] = dpaParticipant($session);
    $headers = ['X-Participant-Token' => $token];

    $response = $this->getJson(dpaUrl($session, $future, 'aggregate'), $headers)
        ->assertForbidden()
        ->assertJsonPath('data.code', 'results_hidden')
        ->assertJsonMissingPath('data.type');
    expect($response->getContent())->not->toContain('7001')->not->toContain('poll_single');

    // The host still sees it.
    Sanctum::actingAs($session->host);
    $this->getJson(dpaUrl($session, $future, 'aggregate'))->assertOk()->assertJsonPath('data.type', 'poll_single');
    app('auth')->forgetGuards();

    // Shown (current, still waiting): visible.
    $session->forceFill(['current_slide_run_id' => $future->id])->save();
    $this->getJson(dpaUrl($session, $future, 'aggregate'), $headers)->assertOk()->assertJsonPath('data.state', 'waiting');

    // Left behind after voting: still visible.
    $future->forceFill(['state' => DeckSessionSlideRun::STATE_CLOSED, 'closed_at' => now()])->save();
    $session->forceFill(['current_slide_run_id' => $heading->id])->save();
    $this->getJson(dpaUrl($session, $future, 'aggregate'), $headers)->assertOk()->assertJsonPath('data.final', true);
});

// --- throttling --------------------------------------------------------------------------------

it('caps participant routes per IP even when every request sends a different made-up token', function () {
    $session = dpaSession();
    $run = dpaRun($session, 'poll_single', ['show_results_to_participants' => true]);
    $url = dpaUrl($session, $run, 'aggregate');

    for ($i = 0; $i < ParticipantReadAccess::IP_PER_MINUTE; $i++) {
        $this->getJson($url, ['X-Participant-Token' => Str::random(64)])->assertUnauthorized();
    }

    $this->getJson($url, ['X-Participant-Token' => Str::random(64)])->assertStatus(429);
    $this->getJson(dpaUrl($session, $run, 'my-answer'), ['X-Participant-Token' => Str::random(64)])->assertStatus(429);
    $this->postJson(dpaUrl($session, $run), ['answer_payload' => ['option_id' => 7001]], ['X-Participant-Token' => Str::random(64)])
        ->assertStatus(429);
});

// --- routes -------------------------------------------------------------------------------

it('registers the participant routes under the quest sessions prefix', function () {
    $routes = app('router')->getRoutes();

    foreach ([
        'deck.quest.sessions.participants.join' => ['POST', 'api/v1/quest-sessions/v2/{session}/participants/join'],
        'deck.quest.sessions.runs.answers.store' => ['POST', 'api/v1/quest-sessions/v2/{session}/slide-runs/{run}/answers'],
        'deck.quest.sessions.runs.my-answer' => ['GET', 'api/v1/quest-sessions/v2/{session}/slide-runs/{run}/my-answer'],
        'deck.quest.sessions.runs.aggregate' => ['GET', 'api/v1/quest-sessions/v2/{session}/slide-runs/{run}/aggregate'],
    ] as $name => [$method, $uri]) {
        $route = $routes->getByName($name);

        expect($route)->not->toBeNull()
            ->and($route->uri())->toBe($uri)
            ->and($route->methods())->toContain($method)
            ->and($route->defaults['product'] ?? null)->toBe('quest');
    }

    expect($routes->getByName('deck.quest.sessions.participants.join')->gatherMiddleware())->toContain('throttle:deck-join')
        ->and($routes->getByName('deck.quest.sessions.runs.answers.store')->gatherMiddleware())->toContain(ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant', 'deck.participant')
        ->and($routes->getByName('deck.quest.sessions.runs.my-answer')->gatherMiddleware())->toContain(ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant')
        ->and($routes->getByName('deck.quest.sessions.runs.aggregate')->gatherMiddleware())->toContain(ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant');

    $this->postJson(DPA_BASE . '/abc/participants/join', ['display_name' => 'Ada', 'emoji_avatar' => '🦊'])->assertNotFound();
});
