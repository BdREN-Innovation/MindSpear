<?php

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\Controllers\QaController;
use App\Deck\Qa\SessionQaService;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckQaQuestion;
use App\Models\Deck\DeckQaUpvote;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Services\Live\ParticipantTokenService;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

beforeEach(function () {
    config([
        'broadcasting.default' => 'null',
        'cache.default' => 'array',
        'deck.qa_upvote_debounce_ms' => 200,
        'deck.qa_questions_per_minute' => 10,
    ]);
    Queue::fake();
    Event::fake([LiveBroadcastEvent::class]);
});

/** A live quest session (fresh host) with one run and three participants holding tokens. */
function qaApiFixture(array $config = [], string $state = DeckSessionSlideRun::STATE_OPEN, string $type = 'qa_audience'): array
{
    $host = DeckFactory::newOwner();
    $deck = Deck::factory()->ownedBy($host)->create();
    $session = DeckSession::factory()->live()->create(['deck_id' => $deck->id, 'host_user_id' => $host->id]);
    $run = DeckSessionSlideRun::factory()->inState($state)->create([
        'deck_session_id' => $session->id,
        'type_snapshot' => $type,
        'config_snapshot' => $config,
    ]);

    $participants = [];
    $tokens = [];
    foreach (['🦊', '🐼', '🐙'] as $i => $emoji) {
        $participant = DeckParticipant::factory()->create([
            'deck_session_id' => $session->id,
            'display_name' => "Secret Person {$i}",
            'emoji_avatar' => $emoji,
        ]);
        $participants[] = $participant;
        $tokens[] = app(ParticipantTokenService::class)->issue($participant, $session);
    }

    return compact('host', 'deck', 'session', 'run', 'participants', 'tokens');
}

function qaApiUrl(DeckSession|int|string $session, string $path): string
{
    $id = $session instanceof DeckSession ? $session->id : $session;

    return "/api/v1/quest-sessions/v2/{$id}/" . ltrim($path, '/');
}

function qaApiToken(string $token): array
{
    return ['X-Participant-Token' => $token];
}

function qaApiPost(array $fx, int $who, string $body): TestResponse
{
    return test()->postJson(
        qaApiUrl($fx['session'], "slide-runs/{$fx['run']->id}/qa/questions"),
        ['body' => $body],
        qaApiToken($fx['tokens'][$who]),
    );
}

/** Asks through the API and returns the new question's id. */
function qaApiAsk(array $fx, int $who, string $body): int
{
    return (int) qaApiPost($fx, $who, $body)->assertCreated()->json('data.question.question_id');
}

function qaApiUpvote(array $fx, int $who, int $questionId, string $method = 'postJson'): TestResponse
{
    return test()->{$method}(qaApiUrl($fx['session'], "qa/questions/{$questionId}/upvote"), [], qaApiToken($fx['tokens'][$who]));
}

/** The participant feed ($who >= 0) or, signed in as the host, the host feed ($who null). */
function qaApiFeed(array $fx, ?int $who, array $query = []): TestResponse
{
    $url = qaApiUrl($fx['session'], "slide-runs/{$fx['run']->id}/qa/questions") . ($query ? '?' . http_build_query($query) : '');

    return test()->getJson($url, $who === null ? [] : qaApiToken($fx['tokens'][$who]));
}

function qaApiModerate(array $fx, int $questionId, array $flags): TestResponse
{
    return test()->patchJson(qaApiUrl($fx['session'], "qa/questions/{$questionId}"), $flags);
}

/** @return Collection<int, LiveBroadcastEvent> */
function qaApiBroadcasts(string $event): Collection
{
    return Event::dispatched(LiveBroadcastEvent::class)
        ->map(fn (array $call) => $call[0])
        ->filter(fn (LiveBroadcastEvent $e) => $e->broadcastAs() === $event)
        ->values();
}

// --- routes ------------------------------------------------------------------

it('registers the Q&A routes under quest-sessions/v2 with participant and host middleware', function () {
    $routes = Route::getRoutes();
    $expect = [
        'deck.quest.sessions.qa.questions.store' => ['POST', 'api/v1/quest-sessions/v2/{session}/slide-runs/{run}/qa/questions', 'store', 'deck.participant'],
        'deck.quest.sessions.qa.questions.index' => ['GET', 'api/v1/quest-sessions/v2/{session}/slide-runs/{run}/qa/questions', 'index', 'throttle:deck-participant'],
        'deck.quest.sessions.qa.questions.upvote' => ['POST', 'api/v1/quest-sessions/v2/{session}/qa/questions/{question}/upvote', 'upvote', 'deck.participant'],
        'deck.quest.sessions.qa.questions.upvote.destroy' => ['DELETE', 'api/v1/quest-sessions/v2/{session}/qa/questions/{question}/upvote', 'removeUpvote', 'deck.participant'],
        'deck.quest.sessions.qa.questions.moderate' => ['PATCH', 'api/v1/quest-sessions/v2/{session}/qa/questions/{question}', 'moderate', 'auth:sanctum'],
    ];

    foreach ($expect as $name => [$method, $uri, $action, $middleware]) {
        $route = $routes->getByName($name);

        expect($route)->not->toBeNull()
            ->and($route->methods())->toContain($method)
            ->and($route->uri())->toBe($uri)
            ->and($route->getActionName())->toBe(QaController::class . '@' . $action)
            ->and($route->gatherMiddleware())->toContain($middleware)
            ->and($route->defaults['product'] ?? null)->toBe('quest');
    }
});

// --- the §3.7 flow -------------------------------------------------------------

it('runs Q&A with three participants: ask, cross-upvote, moderate and read both feeds', function () {
    $fx = qaApiFixture();

    $first = qaApiAskAndCheckShape($fx);
    $q2 = qaApiAsk($fx, 1, 'When is the break?');
    $q3 = qaApiAsk($fx, 2, 'Can we get the slides?');

    // Everyone upvotes the first question (its author too); participant 0 also upvotes q3.
    foreach ([0, 1, 2] as $who) {
        qaApiUpvote($fx, $who, $first)->assertOk();
    }
    qaApiUpvote($fx, 0, $q3)->assertOk()->assertJsonPath('data.upvote_count', 1);

    // A repeat upvote changes nothing.
    qaApiUpvote($fx, 0, $first)->assertOk()
        ->assertJsonPath('data', ['question_id' => $first, 'slide_run_id' => $fx['run']->id, 'upvote_count' => 3, 'has_upvoted' => true]);
    expect(DeckQaUpvote::where('qa_question_id', $first)->count())->toBe(3);

    // top = most upvotes first; new = latest first.
    $top = qaApiFeed($fx, 0, ['sort' => 'top'])->assertOk();
    expect($top->json('data.questions.*.question_id'))->toBe([$first, $q3, $q2])
        ->and($top->json('data.questions.*.upvote_count'))->toBe([3, 1, 0])
        ->and($top->json('data.questions.*.has_upvoted'))->toBe([true, true, false])
        ->and($top->json('data.questions.*.is_mine'))->toBe([true, false, false])
        ->and($top->json('data'))->toMatchArray(['viewer' => 'participant', 'sort' => 'top', 'own_only' => false, 'total' => 3]);

    expect(qaApiFeed($fx, 1, ['sort' => 'new'])->assertOk()->json('data.questions.*.question_id'))->toBe([$q3, $q2, $first]);

    // Host hides q3 and stars q2.
    Sanctum::actingAs($fx['host']);
    qaApiModerate($fx, $q3, ['is_hidden' => true])->assertOk()
        ->assertJsonPath('data.question.question_id', $q3)
        ->assertJsonPath('data.question.is_hidden', true)
        ->assertJsonPath('data.question.participant_id', $fx['participants'][2]->id);
    qaApiModerate($fx, $q2, ['is_starred' => true])->assertOk()->assertJsonPath('data.question.is_starred', true);

    // Participants no longer see q3 (its author included); the starred flag reaches them.
    foreach ([0, 2] as $who) {
        $feed = qaApiFeed($fx, $who, ['sort' => 'top'])->assertOk();
        expect($feed->json('data.questions.*.question_id'))->toBe([$first, $q2])
            ->and($feed->json('data.total'))->toBe(2)
            ->and($feed->json('data.questions.*.is_hidden'))->toBe([false, false])
            ->and($feed->json('data.questions.1.is_starred'))->toBeTrue();
    }

    // The host feed keeps q3 (flagged hidden) and puts starred questions first.
    $host = qaApiFeed($fx, null, ['sort' => 'top'])->assertOk();
    expect($host->json('data.questions.*.question_id'))->toBe([$q2, $first, $q3])
        ->and($host->json('data.questions.*.is_hidden'))->toBe([false, false, true])
        ->and($host->json('data'))->toMatchArray(['viewer' => 'host', 'total' => 3, 'own_only' => false])
        ->and($host->json('data.questions.2'))->toHaveKeys(['participant_id', 'body'])
        ->and($host->json('data.questions.2'))->not->toHaveKey('has_upvoted');

    expect(qaApiFeed($fx, null, ['sort' => 'new'])->json('data.questions.*.question_id'))->toBe([$q2, $q3, $first]);
});

/** First question of the flow test, with the full participant item shape checked. */
function qaApiAskAndCheckShape(array $fx): int
{
    $response = qaApiPost($fx, 0, '  What is the roadmap?  ')->assertCreated();

    $question = DeckQaQuestion::findOrFail($response->json('data.question.question_id'));
    expect($response->json('status'))->toBeTrue()
        ->and($response->json('data.question'))->toBe([
            'question_id' => $question->id,
            'slide_run_id' => $fx['run']->id,
            'body' => 'What is the roadmap?',
            'participant_emoji' => '🦊',
            'upvote_count' => 0,
            'is_answered' => false,
            'is_starred' => false,
            'submitted_at' => $question->submitted_at->toISOString(),
            'is_hidden' => false,
            'has_upvoted' => false,
            'is_mine' => true,
        ])
        ->and($question->participant_id)->toBe($fx['participants'][0]->id)
        ->and($question->deck_session_id)->toBe($fx['session']->id);

    expect(json_encode($response->json()))->not->toContain('Secret Person');

    $events = qaApiBroadcasts('qa.question.submitted');
    expect($events->last()->isPrivate())->toBeFalse()
        ->and($events->last()->broadcastWith()['question_id'])->toBe($question->id);

    return $question->id;
}

it('removes an upvote, and removing it twice is a no-op', function () {
    $fx = qaApiFixture();
    $question = qaApiAsk($fx, 0, 'Is this recorded?');

    qaApiUpvote($fx, 1, $question)->assertOk()->assertJsonPath('data.upvote_count', 1);
    qaApiUpvote($fx, 2, $question)->assertOk()->assertJsonPath('data.upvote_count', 2);

    qaApiUpvote($fx, 1, $question, 'deleteJson')->assertOk()
        ->assertJsonPath('data', ['question_id' => $question, 'slide_run_id' => $fx['run']->id, 'upvote_count' => 1, 'has_upvoted' => false]);
    qaApiUpvote($fx, 1, $question, 'deleteJson')->assertOk()->assertJsonPath('data.upvote_count', 1);

    expect(DeckQaUpvote::where('qa_question_id', $question)->pluck('participant_id')->all())->toBe([$fx['participants'][2]->id])
        ->and(qaApiFeed($fx, 1)->json('data.questions.0.has_upvoted'))->toBeFalse()
        ->and(qaApiFeed($fx, 2)->json('data.questions.0.has_upvoted'))->toBeTrue();
});

it('keeps hidden questions from every participant, its author included, until the host unhides them', function () {
    $fx = qaApiFixture();
    $question = qaApiAsk($fx, 0, 'Off-topic question');
    qaApiUpvote($fx, 1, $question)->assertOk();

    Sanctum::actingAs($fx['host']);
    qaApiModerate($fx, $question, ['is_hidden' => true])->assertOk();

    expect(qaApiFeed($fx, 0)->json('data.questions'))->toBe([])
        ->and(qaApiFeed($fx, 0)->json('data.total'))->toBe(0);

    qaApiUpvote($fx, 2, $question)->assertNotFound()->assertJsonPath('data.code', 'not_found');
    qaApiUpvote($fx, 1, $question, 'deleteJson')->assertNotFound();
    expect(DeckQaQuestion::findOrFail($question)->upvote_count)->toBe(1);

    // The public moderation event never carries the hidden body.
    $public = qaApiBroadcasts('qa.question.moderated')->reject(fn (LiveBroadcastEvent $e) => $e->isPrivate());
    expect($public->last()->broadcastWith())->toMatchArray(['question_id' => $question, 'is_hidden' => true])
        ->and($public->last()->broadcastWith())->not->toHaveKeys(['body', 'participant_emoji', 'upvote_count']);

    qaApiModerate($fx, $question, ['is_hidden' => false, 'is_answered' => true])->assertOk()
        ->assertJsonPath('data.question.is_hidden', false)
        ->assertJsonPath('data.question.is_answered', true);

    expect(qaApiFeed($fx, 0)->json('data.questions.*.question_id'))->toBe([$question])
        ->and(qaApiFeed($fx, 0)->json('data.questions.0.is_answered'))->toBeTrue();
});

it("uses the slide's sort setting when the feed request has none", function (string $setting, string $expected) {
    $fx = qaApiFixture(['sort' => $setting]);
    $older = qaApiAsk($fx, 0, 'Older question');
    $newer = qaApiAsk($fx, 1, 'Newer question');
    qaApiUpvote($fx, 2, $older)->assertOk();

    $feed = qaApiFeed($fx, 2)->assertOk();

    expect($feed->json('data.sort'))->toBe($expected)
        ->and($feed->json('data.questions.*.question_id'))->toBe($expected === 'top' ? [$older, $newer] : [$newer, $older]);

    // 'newest' is accepted as an alias of 'new'.
    expect(qaApiFeed($fx, 2, ['sort' => 'newest'])->json('data.sort'))->toBe('new');
})->with([
    'top' => ['top', 'top'],
    'newest' => ['newest', 'new'],
]);

it('shows participants only their own questions when the slide hides the feed', function () {
    $fx = qaApiFixture(['show_feed_to_participants' => false]);
    $mine = qaApiAsk($fx, 0, 'My question');
    $theirs = qaApiAsk($fx, 1, 'Their question');

    // Submissions go to the host channel only.
    expect(qaApiBroadcasts('qa.question.submitted')->every(fn (LiveBroadcastEvent $e) => $e->isPrivate()))->toBeTrue();

    $feed = qaApiFeed($fx, 0)->assertOk();
    expect($feed->json('data.questions.*.question_id'))->toBe([$mine])
        ->and($feed->json('data'))->toMatchArray(['own_only' => true, 'show_feed_to_participants' => false, 'total' => 1]);
    expect(qaApiFeed($fx, 2)->json('data.questions'))->toBe([]);

    qaApiUpvote($fx, 0, $theirs)->assertNotFound();
    qaApiUpvote($fx, 0, $mine)->assertOk()->assertJsonPath('data.upvote_count', 1);

    Sanctum::actingAs($fx['host']);
    expect(qaApiFeed($fx, null)->json('data.questions.*.question_id'))->toBe([$mine, $theirs]);
});

// --- state, type and validation ----------------------------------------------

it('answers 409 when the Q&A slide is not open', function (string $state) {
    $fx = qaApiFixture([], $state);

    // Same extras as the answer endpoint's not_voting 409, so the client can resync.
    qaApiPost($fx, 0, 'Too early or too late?')->assertStatus(409)
        ->assertJsonPath('status', false)
        ->assertJsonPath('data', [
            'code' => 'invalid_state',
            'reason' => 'not_open',
            'slide_run_id' => $fx['run']->id,
            'state' => $state,
            'state_version' => 1,
        ]);

    expect(DeckQaQuestion::where('slide_run_id', $fx['run']->id)->count())->toBe(0);
})->with([
    DeckSessionSlideRun::STATE_WAITING,
    DeckSessionSlideRun::STATE_GET_READY,
    DeckSessionSlideRun::STATE_CLOSED,
]);

it('answers 409 to votes once the slide closes, but still serves the final feed', function () {
    $fx = qaApiFixture();
    $question = qaApiAsk($fx, 0, 'Asked while open');
    qaApiUpvote($fx, 1, $question)->assertOk();

    $fx['run']->forceFill(['state' => DeckSessionSlideRun::STATE_CLOSED, 'closed_at' => now()])->save();

    $closed = ['code' => 'invalid_state', 'reason' => 'not_open', 'slide_run_id' => $fx['run']->id, 'state' => 'closed', 'state_version' => 1];
    qaApiUpvote($fx, 2, $question)->assertStatus(409)->assertJsonPath('data', $closed);
    qaApiUpvote($fx, 1, $question, 'deleteJson')->assertStatus(409)->assertJsonPath('data', $closed);
    expect(DeckQaQuestion::findOrFail($question)->upvote_count)->toBe(1);

    qaApiFeed($fx, 2)->assertOk()
        ->assertJsonPath('data.state', 'closed')
        ->assertJsonPath('data.questions.0.upvote_count', 1);
});

it('answers 409 when the session is no longer live', function () {
    $fx = qaApiFixture();
    $fx['session']->forceFill(['status' => DeckSession::STATUS_ENDED, 'ended_at' => now()])->save();

    // data.reason + data.session_status, like the answer endpoint's session_not_live 409.
    qaApiPost($fx, 0, 'Anyone there?')->assertStatus(409)
        ->assertJsonPath('data', ['code' => 'invalid_state', 'reason' => 'session_not_live', 'session_status' => 'ended']);
});

it('answers 409 on runs that are not Q&A slides', function () {
    $fx = qaApiFixture([], DeckSessionSlideRun::STATE_VOTING, 'poll_single');

    $wrongType = ['code' => 'invalid_state', 'reason' => 'not_qa_slide', 'slide_run_id' => $fx['run']->id, 'type' => 'poll_single'];
    qaApiPost($fx, 0, 'Wrong slide')->assertStatus(409)->assertJsonPath('data', $wrongType);
    qaApiFeed($fx, 0)->assertStatus(409)->assertJsonPath('data', $wrongType);
});

it('validates the question body with the slide rules and masks profanity', function () {
    $fx = qaApiFixture(['max_question_length' => 20]);

    qaApiPost($fx, 0, '')->assertUnprocessable()
        ->assertJsonPath('message', 'Validation Error')
        ->assertJsonStructure(['data' => ['validation_errors' => ['body']]]);
    test()->postJson(qaApiUrl($fx['session'], "slide-runs/{$fx['run']->id}/qa/questions"), [], qaApiToken($fx['tokens'][0]))
        ->assertUnprocessable()->assertJsonStructure(['data' => ['validation_errors' => ['body']]]);
    test()->postJson(qaApiUrl($fx['session'], "slide-runs/{$fx['run']->id}/qa/questions"), ['body' => ['array']], qaApiToken($fx['tokens'][0]))
        ->assertUnprocessable()->assertJsonStructure(['data' => ['validation_errors' => ['body']]]);
    qaApiPost($fx, 0, "\u{00A0}\u{200B}   ")->assertUnprocessable()->assertJsonStructure(['data' => ['validation_errors' => ['body']]]);
    qaApiPost($fx, 0, str_repeat('a', 21))->assertUnprocessable()
        ->assertJsonPath('data.validation_errors.body.0', 'A question must be between 1 and 20 characters.');

    expect(DeckQaQuestion::where('slide_run_id', $fx['run']->id)->count())->toBe(0);

    qaApiPost($fx, 0, 'what the shit')->assertCreated()->assertJsonPath('data.question.body', 'what the ****');
});

it('caps question submissions per participant per minute', function () {
    config(['deck.qa_questions_per_minute' => 2]);
    $fx = qaApiFixture();

    qaApiAsk($fx, 0, 'One');
    qaApiAsk($fx, 0, 'Two');
    qaApiPost($fx, 0, 'Three')->assertStatus(429)
        ->assertJsonPath('data.code', 'too_many_requests')
        ->assertJsonStructure(['data' => ['retry_after']]);

    // Other participants have their own budget.
    qaApiAsk($fx, 1, 'Mine is fine');
    expect(DeckQaQuestion::where('slide_run_id', $fx['run']->id)->count())->toBe(3)
        ->and((int) RateLimiter::attempts(SessionQaService::submitRateKey($fx['participants'][0])))->toBe(2);
});

it('does not count submissions the Q&A rules reject toward the cap', function () {
    config(['deck.qa_questions_per_minute' => 2]);
    $fx = qaApiFixture(['max_question_length' => 20]);

    // Both pass the FormRequest and are rejected by LiveQaService, after a cap slot was taken.
    qaApiPost($fx, 2, "\u{00A0}\u{200B}")->assertUnprocessable()->assertJsonStructure(['data' => ['validation_errors' => ['body']]]);
    qaApiPost($fx, 2, str_repeat('a', 21))->assertUnprocessable()->assertJsonStructure(['data' => ['validation_errors' => ['body']]]);
    expect((int) RateLimiter::attempts(SessionQaService::submitRateKey($fx['participants'][2])))->toBe(0);

    // The whole budget is still there.
    qaApiAsk($fx, 2, 'First real one');
    qaApiAsk($fx, 2, 'Second real one');
    qaApiPost($fx, 2, 'Over the cap')->assertStatus(429);

    // A 409 (slide closed) gives its slot back too.
    $other = qaApiFixture([], DeckSessionSlideRun::STATE_CLOSED);
    config(['deck.qa_questions_per_minute' => 1]);
    qaApiPost($other, 0, 'Too late')->assertStatus(409);
    $other['run']->forceFill(['state' => DeckSessionSlideRun::STATE_OPEN])->save();
    qaApiAsk($other, 0, 'Now it is open');

    expect(DeckQaQuestion::where('participant_id', $fx['participants'][2]->id)->count())->toBe(2)
        ->and(DeckQaQuestion::where('participant_id', $other['participants'][0]->id)->count())->toBe(1);
});

it('reserves a cap slot before storing, so a parallel submission cannot overshoot the cap', function () {
    config(['deck.qa_questions_per_minute' => 1]);
    $fx = qaApiFixture();
    $participant = $fx['participants'][0];
    $run = $fx['run']->fresh()->setRelation('session', $fx['session']->fresh()->load('deck'));
    $parallel = null;
    $fired = false;

    // A second request from the same participant arrives while the first is between its cap check and its commit.
    DB::listen(function ($query) use (&$fired, &$parallel, $run, $participant) {
        if ($fired || ! str_starts_with(strtolower($query->sql), 'insert into "deck_qa_questions"')) {
            return;
        }
        $fired = true;

        try {
            app(SessionQaService::class)->submit($run, $participant, 'Sent in parallel');
        } catch (DeckException $e) {
            $parallel = $e;
        }
    });

    qaApiAsk($fx, 0, 'First');

    expect($fired)->toBeTrue()
        ->and($parallel)->toBeInstanceOf(DeckException::class)
        ->and($parallel->status)->toBe(429)
        ->and($parallel->errorCode)->toBe('too_many_requests')
        ->and(DeckQaQuestion::where('participant_id', $participant->id)->pluck('body')->all())->toBe(['First'])
        ->and((int) RateLimiter::attempts(SessionQaService::submitRateKey($participant)))->toBe(1);
});

it('locks the session row before the run row when storing a question, like the state machine', function () {
    $fx = qaApiFixture();
    $queries = [];
    DB::listen(function ($query) use (&$queries) {
        $queries[] = strtolower($query->sql);
    });

    qaApiAsk($fx, 0, 'Lock order');

    $locks = collect($queries)
        ->filter(fn (string $sql) => str_ends_with($sql, 'for share') || str_ends_with($sql, 'for update') || str_starts_with($sql, 'insert into "deck_qa_questions"'))
        ->map(fn (string $sql) => match (true) {
            str_starts_with($sql, 'insert into') => 'insert',
            str_contains($sql, 'from "deck_sessions"') => 'session:' . (str_ends_with($sql, 'for share') ? 'share' : 'update'),
            str_contains($sql, 'from "deck_session_slide_runs"') => 'run:' . (str_ends_with($sql, 'for share') ? 'share' : 'update'),
            default => 'other',
        })
        ->values()
        ->all();

    // Session first, then run: a host advance/end (session FOR UPDATE, then run FOR UPDATE)
    // waits on the session row instead of deadlocking with the question INSERT's FK check.
    expect($locks)->toBe(['session:share', 'run:share', 'insert']);
});

it('validates feed parameters and limits the feed', function () {
    $fx = qaApiFixture();
    foreach (['One', 'Two', 'Three'] as $i => $body) {
        qaApiAsk($fx, $i, $body);
    }

    qaApiFeed($fx, 0, ['sort' => 'popular'])->assertUnprocessable()->assertJsonStructure(['data' => ['validation_errors' => ['sort']]]);
    qaApiFeed($fx, 0, ['limit' => 0])->assertUnprocessable()->assertJsonStructure(['data' => ['validation_errors' => ['limit']]]);
    qaApiFeed($fx, 0, ['limit' => 501])->assertUnprocessable();

    $feed = qaApiFeed($fx, 0, ['sort' => 'new', 'limit' => 2])->assertOk();
    expect($feed->json('data.questions'))->toHaveCount(2)
        ->and($feed->json('data.total'))->toBe(3)
        ->and($feed->json('data.limit'))->toBe(2);
});

// --- moderation access -----------------------------------------------------------

it('keeps moderation to the host of the session', function () {
    $fx = qaApiFixture();
    $question = qaApiAsk($fx, 0, 'Moderate me');

    // A participant token is not a host login.
    test()->patchJson(qaApiUrl($fx['session'], "qa/questions/{$question}"), ['is_hidden' => true], qaApiToken($fx['tokens'][0]))
        ->assertUnauthorized();

    // Someone else's session looks missing.
    Sanctum::actingAs(DeckFactory::newOwner());
    qaApiModerate($fx, $question, ['is_hidden' => true])->assertNotFound()
        ->assertJsonPath('data.code', 'not_found')
        ->assertJsonPath('message', 'Session not found.');
    qaApiFeed($fx, null)->assertNotFound();

    // The host cannot reach another session's question through this session.
    Sanctum::actingAs($fx['host']);
    $other = qaApiFixture();
    $foreign = DeckQaQuestion::factory()->create([
        'deck_session_id' => $other['session']->id,
        'slide_run_id' => $other['run']->id,
        'participant_id' => $other['participants'][0]->id,
    ]);
    qaApiModerate($fx, $foreign->id, ['is_hidden' => true])->assertNotFound()->assertJsonPath('message', 'Question not found.');

    expect(DeckQaQuestion::findOrFail($question)->is_hidden)->toBeFalse()
        ->and($foreign->fresh()->is_hidden)->toBeFalse();
});

it('validates moderation flags', function (array $body, string $key) {
    $fx = qaApiFixture();
    $question = qaApiAsk($fx, 0, 'Flag me');

    Sanctum::actingAs($fx['host']);
    qaApiModerate($fx, $question, $body)->assertUnprocessable()
        ->assertJsonStructure(['data' => ['validation_errors' => [$key]]]);
})->with([
    'no flags' => [[], 'flags'],
    'unknown flag only' => [['is_pinned' => true], 'flags'],
    'not a boolean' => [['is_hidden' => 'yes'], 'is_hidden'],
    'null' => [['is_starred' => null], 'is_starred'],
    'alias not a boolean' => [['hide' => 'yes'], 'hide'],
    'alias disagrees with its is_* key' => [['hide' => true, 'is_hidden' => false], 'hide'],
]);

it('accepts the plan action names hide, star and mark_answered as moderation flags', function () {
    $fx = qaApiFixture();
    $question = qaApiAsk($fx, 0, 'Alias me');

    Sanctum::actingAs($fx['host']);
    qaApiModerate($fx, $question, ['hide' => true])->assertOk()->assertJsonPath('data.question.is_hidden', true);
    qaApiModerate($fx, $question, ['star' => true, 'mark_answered' => 1])->assertOk()
        ->assertJsonPath('data.question.is_starred', true)
        ->assertJsonPath('data.question.is_answered', true);
    // An alias and its is_* key may be sent together when they agree.
    qaApiModerate($fx, $question, ['hide' => false, 'is_hidden' => '0'])->assertOk()->assertJsonPath('data.question.is_hidden', false);

    expect(DeckQaQuestion::findOrFail($question)->only(['is_hidden', 'is_starred', 'is_answered']))
        ->toBe(['is_hidden' => false, 'is_starred' => true, 'is_answered' => true]);
});

it('does not broadcast or change anything for a no-op moderation', function () {
    $fx = qaApiFixture();
    $question = qaApiAsk($fx, 0, 'Already visible');

    Sanctum::actingAs($fx['host']);
    qaApiModerate($fx, $question, ['is_hidden' => false])->assertOk()->assertJsonPath('data.question.is_hidden', false);

    expect(qaApiBroadcasts('qa.question.moderated'))->toBeEmpty();
});

// --- participant auth and scoping ---------------------------------------------------

it('requires a valid participant token', function () {
    $fx = qaApiFixture();
    $other = qaApiFixture();
    $question = qaApiAsk($fx, 0, 'Token check');
    $ask = qaApiUrl($fx['session'], "slide-runs/{$fx['run']->id}/qa/questions");
    $upvote = qaApiUrl($fx['session'], "qa/questions/{$question}/upvote");
    $unauthorized = ['status' => false, 'message' => 'Invalid or expired participant token.', 'data' => ['code' => 'unauthorized']];

    test()->postJson($ask, ['body' => 'No token'])->assertUnauthorized()->assertExactJson($unauthorized);
    test()->postJson($ask, ['body' => 'Junk'], qaApiToken('not-a-token'))->assertUnauthorized();
    test()->postJson($ask, ['body' => 'Wrong session'], qaApiToken($other['tokens'][0]))->assertUnauthorized();
    test()->postJson($upvote)->assertUnauthorized();
    test()->deleteJson($upvote)->assertUnauthorized();
    test()->getJson(qaApiUrl($fx['session'], "slide-runs/{$fx['run']->id}/qa/questions"), qaApiToken('not-a-token'))
        ->assertUnauthorized()->assertExactJson($unauthorized);

    // No token and not signed in.
    qaApiFeed($fx, null)->assertUnauthorized()->assertJsonPath('data.code', 'unauthorized');

    // Revoked (e.g. the session ended) and expired tokens.
    app(ParticipantTokenService::class)->revokeParticipant($fx['participants'][1]);
    qaApiPost($fx, 1, 'Revoked')->assertUnauthorized();
    qaApiUpvote($fx, 1, $question)->assertUnauthorized();
    $fx['participants'][2]->forceFill(['participant_token_expires_at' => now()->subMinute()])->save();
    qaApiFeed($fx, 2)->assertUnauthorized();

    expect(DeckQaQuestion::where('deck_session_id', $fx['session']->id)->count())->toBe(1)
        ->and(DeckQaUpvote::where('qa_question_id', $question)->count())->toBe(0);
});

it('scopes runs and questions to the session in the URL', function () {
    $fx = qaApiFixture();
    $other = qaApiFixture();
    $foreign = DeckQaQuestion::factory()->create([
        'deck_session_id' => $other['session']->id,
        'slide_run_id' => $other['run']->id,
        'participant_id' => $other['participants'][0]->id,
    ]);
    $token = qaApiToken($fx['tokens'][0]);

    test()->postJson(qaApiUrl($fx['session'], "slide-runs/{$other['run']->id}/qa/questions"), ['body' => 'Cross-session'], $token)
        ->assertNotFound()->assertJsonPath('message', 'Slide not found in this session.');
    test()->getJson(qaApiUrl($fx['session'], "slide-runs/{$other['run']->id}/qa/questions"), $token)->assertNotFound();
    test()->postJson(qaApiUrl($fx['session'], "qa/questions/{$foreign->id}/upvote"), [], $token)
        ->assertNotFound()->assertJsonPath('message', 'Question not found.');
    test()->postJson(qaApiUrl($fx['session'], 'qa/questions/999999999999/upvote'), [], $token)->assertNotFound();
    test()->postJson(qaApiUrl($fx['session'], 'qa/questions/abc/upvote'), [], $token)->assertNotFound();

    // Using another session's id with this session's token: the token does not belong there.
    test()->postJson(qaApiUrl($other['session'], "qa/questions/{$foreign->id}/upvote"), [], $token)->assertUnauthorized();

    // A quiz session does not exist on the quest routes.
    $quizDeck = Deck::factory()->quiz()->ownedBy($fx['host'])->create();
    $quizSession = DeckSession::factory()->live()->create(['deck_id' => $quizDeck->id, 'host_user_id' => $fx['host']->id]);
    test()->getJson(qaApiUrl($quizSession, "slide-runs/{$fx['run']->id}/qa/questions"), $token)
        ->assertNotFound()->assertJsonPath('message', 'Session not found.');

    expect($foreign->fresh()->upvote_count)->toBe(0);
});
