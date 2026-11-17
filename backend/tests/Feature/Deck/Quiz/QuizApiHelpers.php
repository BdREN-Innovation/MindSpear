<?php

/*
 * Shared helpers for the quiz engine / HTTP tests (QuizAuthoringApiTest,
 * QuizSessionApiTest, QuizEndToEndTest). Not a test
 * file itself (no *Test.php suffix); each test file require_once's it.
 * Everything is prefixed `qapi` because Pest helpers are global.
 */

use App\Events\Live\LiveBroadcastEvent;
use App\Jobs\Deck\BroadcastDeckAggregate;
use App\Models\User;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Cache\RateLimiter;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter as RateLimiterFacade;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

const QAPI_AUTHOR = '/api/v1/quizzes';
const QAPI_SESSIONS = '/api/v1/quiz-sessions';

/** Every Quiz-only slide type (products ['quiz']; pick_answer_multi is retired but still registered for old runs). */
const QAPI_QUIZ_TYPES = [
    'categorise', 'correct_order', 'drag_drop', 'fill_blanks', 'leaderboard', 'match_pairs',
    'pick_answer_multi', 'pick_answer_single', 'short_answer', 'spinner_wheel', 'true_false',
];

/**
 * The scored types QuizEndToEndTest authors and plays (pick_answer_multi:
 * added by its retired key, so it is a Pick answer with two correct options).
 * QuizNewTypesApiTest plays true_false, fill_blanks and drag_drop.
 */
const QAPI_SCORED_TYPES = [
    'categorise', 'correct_order', 'match_pairs', 'pick_answer_multi', 'pick_answer_single', 'short_answer',
];

/** Keys that would give an answer away; never in a participant payload before the reveal. */
const QAPI_SECRET_KEYS = [
    'is_correct', 'correct', 'answer_key', 'pair_key', 'correct_category_key', 'correct_order_index',
    'correct_option_ids', 'accepted_answers', 'correct_responses', 'points_awarded',
];

function qapiSetUp(): void
{
    config([
        'broadcasting.default' => 'null',
        'cache.default' => 'array',
        'queue.default' => 'sync',
        'deck.aggregate_debounce_ms' => 0,
        'app.frontend_url' => 'https://play.example.test',
    ]);

    Event::fake([LiveBroadcastEvent::class]);
    qapiArrayRateLimiter();
}

/** Array-backed copy of the registered limiters, so throttle counters stay out of the dev Redis. */
function qapiArrayRateLimiter(): void
{
    $current = app(RateLimiter::class);
    $limiters = (fn () => $this->limiters)->call($current);
    $fresh = new RateLimiter(app('cache')->store('array'));

    foreach ($limiters as $name => $callback) {
        $fresh->for($name, $callback);
    }

    RateLimiterFacade::swap($fresh);
}

/** A quiz host. */
function qapiOwner(): User
{
    return DeckFactory::newOwner();
}

function qapiAsHost(User $host): void
{
    app('auth')->forgetGuards();
    Sanctum::actingAs($host);
}

/** No signed-in user: the next request carries only what a participant's browser sends. */
function qapiAsGuest(): void
{
    app('auth')->forgetGuards();
}

function qapiHeaders(string $token): array
{
    return ['X-Participant-Token' => $token, 'Accept' => 'application/json'];
}

/** POST /quizzes → the deck detail (one qr_code slide at position 1). */
function qapiCreateQuiz(User $host, string $title = 'Quiz'): array
{
    qapiAsHost($host);

    return test()->postJson(QAPI_AUTHOR, ['title' => $title])
        ->assertCreated()
        ->assertJsonPath('data.deck.product', 'quiz')
        ->assertJsonPath('data.deck.slides.0.type', 'qr_code')
        ->assertJsonPath('data.deck.slides.0.position', 1)
        ->json('data.deck');
}

/** POST /quizzes/{deck}/slides {type} → the new slide. */
function qapiAppend(User $host, int $deckId, string $type): array
{
    qapiAsHost($host);

    return test()->postJson(QAPI_AUTHOR . "/{$deckId}/slides", ['type' => $type])
        ->assertCreated()
        ->assertJsonPath('data.slide.type', $type)
        ->json('data.slide');
}

function qapiPatchSlide(User $host, int $deckId, int $slideId, array $body): TestResponse
{
    qapiAsHost($host);

    return test()->patchJson(QAPI_AUTHOR . "/{$deckId}/slides/{$slideId}", $body);
}

function qapiPatchOption(User $host, int $deckId, int $slideId, int $optionId, array $body): TestResponse
{
    qapiAsHost($host);

    return test()->patchJson(QAPI_AUTHOR . "/{$deckId}/slides/{$slideId}/options/{$optionId}", $body);
}

/** POST /quizzes/{deck}/sessions → host state. */
function qapiStart(User $host, int $deckId): array
{
    qapiAsHost($host);

    return test()->postJson(QAPI_AUTHOR . "/{$deckId}/sessions")
        ->assertCreated()
        ->assertJsonPath('data.session.product', 'quiz')
        ->assertJsonPath('data.session.status', 'live')
        ->json('data');
}

/**
 * Participants look the session up by code and join.
 *
 * @return list<array{id:int, token:string, name:string, emoji:string}>
 */
function qapiJoin(array $hostState, array $names = ['Ada', 'Grace', 'Linus']): array
{
    qapiAsGuest();
    $sessionId = $hostState['session_id'];

    test()->getJson(QAPI_SESSIONS . '/by-code/' . strtolower($hostState['join_code']))
        ->assertOk()
        ->assertJsonPath('data.session_id', $sessionId)
        ->assertJsonPath('data.product', 'quiz');

    $emoji = config('deck.emoji_avatars');
    $people = [];
    foreach (array_values($names) as $i => $name) {
        $joined = test()->postJson(QAPI_SESSIONS . "/{$sessionId}/participants/join", [
            'join_code' => $hostState['join_code'],
            'display_name' => $name,
            'emoji_avatar' => $emoji[$i],
        ])->assertCreated()->json('data');

        $people[] = ['id' => (int) $joined['participant_id'], 'token' => $joined['participant_token'], 'name' => $name, 'emoji' => $emoji[$i]];
    }

    return $people;
}

function qapiAdvance(User $host, int $sessionId, array $body): TestResponse
{
    qapiAsHost($host);

    return test()->postJson(QAPI_SESSIONS . "/{$sessionId}/advance", $body);
}

function qapiHostState(User $host, int $sessionId): TestResponse
{
    qapiAsHost($host);

    return test()->getJson(QAPI_SESSIONS . "/{$sessionId}/state");
}

function qapiState(int $sessionId, string $token): TestResponse
{
    qapiAsGuest();

    return test()->getJson(QAPI_SESSIONS . "/{$sessionId}/state", qapiHeaders($token));
}

function qapiSubmit(int $sessionId, int $runId, string $token, array $payload): TestResponse
{
    qapiAsGuest();

    return test()->postJson(QAPI_SESSIONS . "/{$sessionId}/slide-runs/{$runId}/answers", ['answer_payload' => $payload], qapiHeaders($token));
}

function qapiMyAnswer(int $sessionId, int $runId, string $token): TestResponse
{
    qapiAsGuest();

    return test()->getJson(QAPI_SESSIONS . "/{$sessionId}/slide-runs/{$runId}/my-answer", qapiHeaders($token));
}

function qapiLeaderboard(int $sessionId, ?string $token = null, ?User $host = null, array $query = []): TestResponse
{
    $host ? qapiAsHost($host) : qapiAsGuest();
    $url = QAPI_SESSIONS . "/{$sessionId}/leaderboard" . ($query === [] ? '' : '?' . http_build_query($query));

    return test()->getJson($url, $token ? qapiHeaders($token) : ['Accept' => 'application/json']);
}

/**
 * Broadcasts so far, optionally of one event name.
 *
 * @return Collection<int, LiveBroadcastEvent>
 */
function qapiEvents(?string $name = null): Collection
{
    return Event::dispatched(LiveBroadcastEvent::class)
        ->map(fn ($call) => $call[0])
        ->filter(fn (LiveBroadcastEvent $event) => $name === null || $event->broadcastAs() === $name)
        ->values();
}

/** Every key at any depth of $data. */
function qapiKeysDeep(mixed $data): array
{
    if (! is_array($data)) {
        return [];
    }

    $keys = [];
    foreach ($data as $key => $value) {
        if (is_string($key)) {
            $keys[] = $key;
        }
        array_push($keys, ...qapiKeysDeep($value));
    }

    return array_values(array_unique($keys));
}

/** Asserts no answer-key data anywhere in $payload. */
function qapiAssertNoSecrets(mixed $payload, string $where = 'payload'): void
{
    $found = array_values(array_intersect(qapiKeysDeep($payload), QAPI_SECRET_KEYS));

    expect($found)->toBe([], "{$where} leaks: " . implode(', ', $found));
}

/** Silences the trailing aggregate job (deck.aggregate_debounce_ms 0 broadcasts on the leading edge only). */
function qapiNoTrailingJobs(): void
{
    Illuminate\Support\Facades\Queue::fake([BroadcastDeckAggregate::class]);
}
