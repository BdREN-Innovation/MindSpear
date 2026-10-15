<?php

use App\Deck\Broadcasts\Payloads\SessionEndedPayload;
use App\Deck\Sessions\JoinCodeGenerator;
use App\Deck\Sessions\SessionStateMachine;
use App\Deck\Slides\AbstractSlideType;
use App\Deck\Slides\SlideTypeRegistry;
use App\Events\Live\LiveBroadcastEvent;
use App\Jobs\Deck\BroadcastDeckAggregate;
use App\Jobs\Deck\TransitionSlideRunJob;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use App\Models\File;
use App\Models\User;
use App\Services\Live\ParticipantTokenService;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Cache\RateLimiter as CacheRateLimiter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Sleep;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

const SESS_API_CODE_PATTERN = '/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/';

beforeEach(function () {
    config([
        'broadcasting.default' => 'null',
        'cache.default' => 'array',
        'queue.default' => 'sync',
        'app.frontend_url' => 'https://play.example.test',
    ]);

    Event::fake([LiveBroadcastEvent::class]);
    Queue::fake([TransitionSlideRunJob::class, BroadcastDeckAggregate::class]);
    // Sleeps advance the frozen test clock, like a real wait would.
    Sleep::fake(syncWithCarbon: true);
});

// --- helpers (prefixed: Pest helpers are global) ---------------------------------

/**
 * A quest deck owned by $owner. Each slide spec is [type, attributes]; attributes
 * may hold `config` (defaults to the type's defaultConfig), `options` (labels or
 * option attribute arrays; polls get two by default) and any slide column.
 */
function sessApiDeck(User $owner, array $slides, array $deckAttributes = []): Deck
{
    $deck = Deck::factory()->ownedBy($owner)->create($deckAttributes);
    $registry = app(SlideTypeRegistry::class);

    foreach ($slides as $spec) {
        $type = $spec[0];
        $attributes = $spec[1] ?? [];
        $config = $attributes['config'] ?? ($registry->has($type) ? $registry->for($type)->defaultConfig() : []);
        $slide = Slide::factory()->ofType($type, $config)->create(
            ['deck_id' => $deck->id] + Arr::except($attributes, ['config', 'options']),
        );

        $defaultOptions = $registry->has($type) && $registry->for($type)->acceptsAnswers() ? ['Yes', 'No'] : [];
        foreach ($attributes['options'] ?? $defaultOptions as $index => $option) {
            SlideOption::factory()->create(['slide_id' => $slide->id, 'position' => $index + 1]
                + (is_array($option) ? $option : ['label' => $option]));
        }
    }

    return $deck;
}

function sessApiFile(User $owner, array $overrides = []): File
{
    return File::create(array_replace([
        'name' => 'pic-' . Str::random(6) . '.webp',
        'type' => 'image',
        'category' => File::CATEGORY_IMAGE,
        'visibility' => File::VISIBILITY_PUBLIC,
        'path' => "storage/library/{$owner->id}/images/pic-" . Str::random(6) . '.webp',
        'mime_type' => 'image/webp',
        'extension' => 'webp',
        'size' => 2048,
        'width' => 800,
        'height' => 600,
        'user_id' => $owner->id,
    ], $overrides));
}

/** Starts a session through the API as $host and returns it. */
function sessApiStart(User $host, Deck $deck): DeckSession
{
    Sanctum::actingAs($host);
    $response = test()->postJson("/api/v1/quests/v2/{$deck->id}/sessions")->assertCreated();

    return DeckSession::findOrFail($response->json('data.session_id'));
}

function sessApiAdvance(DeckSession $session, array $body): TestResponse
{
    return test()->postJson("/api/v1/quest-sessions/v2/{$session->id}/advance", $body);
}

function sessApiCurrent(DeckSession $session): DeckSessionSlideRun
{
    return DeckSessionSlideRun::findOrFail($session->fresh()->current_slide_run_id);
}

/** @return array{0: DeckParticipant, 1: string} a participant of $session and its raw token */
function sessApiParticipant(DeckSession $session): array
{
    $participant = DeckParticipant::factory()->create(['deck_session_id' => $session->id]);

    return [$participant, app(ParticipantTokenService::class)->issue($participant, $session)];
}

/** The participant's resync: GET {session}/state with X-Participant-Token (plan §7.6). */
function sessApiParticipantState(DeckSession $session, string $token): TestResponse
{
    return test()->getJson("/api/v1/quest-sessions/v2/{$session->id}/state", [ParticipantTokenService::HEADER => $token]);
}

/** Size of the Pusher HTTP body Reverb would receive for a captured broadcast. */
function sessApiPublishBytes(LiveBroadcastEvent $event): int
{
    return strlen(json_encode([
        'name' => $event->broadcastAs(),
        'data' => json_encode($event->broadcastWith() + ['socket' => null]),
        'channels' => [$event->broadcastOn()->name],
    ]));
}

/** @return Collection<int, LiveBroadcastEvent> */
function sessApiEvents(?string $name = null): Collection
{
    return Event::dispatched(LiveBroadcastEvent::class)
        ->map(fn ($call) => $call[0])
        ->filter(fn (LiveBroadcastEvent $event) => $name === null || $event->broadcastAs() === $name)
        ->values();
}

/** @return Collection<int, TransitionSlideRunJob> */
function sessApiJobs(): Collection
{
    return Queue::pushed(TransitionSlideRunJob::class)->values();
}

function sessApiRunJob(TransitionSlideRunJob $job): void
{
    app()->call([$job, 'handle']);
}

// --- start --------------------------------------------------------------------

it('starts a live session and snapshots every non-deleted slide', function () {
    $this->travelTo(now()->startOfSecond());
    $host = DeckFactory::newOwner();
    $image = sessApiFile($host);
    $optionImage = sessApiFile($host);
    $deck = sessApiDeck($host, [
        ['poll_single', [
            'title' => 'Lunch?',
            'time_limit_seconds' => 20,
            'get_ready_seconds' => 0,
            'options' => [['label' => 'Pizza', 'image_file_id' => $optionImage->id, 'payload' => ['color' => 'red']], ['label' => 'Soup', 'is_correct' => true]],
        ]],
        ['heading', ['title' => 'Section', 'config' => ['subtitle' => 'Part two']]],
        ['image', ['media_file_id' => $image->id, 'config' => ['caption' => 'Look', 'alt' => 'A view']]],
        ['poll_multi', ['time_limit_seconds' => 30, 'get_ready_seconds' => 5]],
        ['qa_audience'],
    ], ['settings' => ['default_time_limit' => 45, 'get_ready_seconds' => 10, 'theme' => 'default', 'show_qr_sidebar' => true, 'default_qa_sort' => 'top']]);

    // A deleted slide is never snapshotted; a file removed from My Files still is.
    Slide::factory()->ofType('word_cloud')->create(['deck_id' => $deck->id])->delete();
    $image->delete();

    Sanctum::actingAs($host);
    $response = $this->postJson("/api/v1/quests/v2/{$deck->id}/sessions")->assertCreated()
        ->assertJsonPath('status', true)
        ->assertJsonPath('data.session.status', 'live')
        ->assertJsonPath('data.session.total_slides', 5)
        ->assertJsonPath('data.participant_count', 0);

    $session = DeckSession::findOrFail($response->json('data.session_id'));
    $runs = $session->runs()->get();
    $poll = $runs[0];

    expect($session->status)->toBe('live')
        ->and($session->host_user_id)->toBe($host->id)
        ->and($session->started_at)->not->toBeNull()
        ->and($session->join_code)->toMatch(SESS_API_CODE_PATTERN)
        ->and($session->public_channel_key)->toMatch('/^[a-z0-9]{32}$/')
        ->and($session->current_slide_run_id)->toBe($poll->id)
        ->and($response->json('data.join_code'))->toBe($session->join_code)
        ->and($response->json('data.public_channel_key'))->toBe($session->public_channel_key)
        ->and($response->json('data.join'))->toBe([
            'join_code' => $session->join_code,
            'join_url' => 'https://play.example.test/play/' . $session->join_code,
            'public_channel_key' => $session->public_channel_key,
        ])
        ->and($response->json('data.channels'))->toBe([
            'public' => "session.quest.{$session->public_channel_key}",
            'host' => "host.quest.v2.{$session->id}",
        ])
        ->and($runs->pluck('type_snapshot')->all())->toBe(['poll_single', 'heading', 'image', 'poll_multi', 'qa_audience'])
        ->and($runs->pluck('position_snapshot')->all())->toBe([1, 2, 3, 4, 5])
        ->and($runs->pluck('state')->unique()->all())->toBe(['waiting'])
        ->and($runs->pluck('state_version')->unique()->all())->toBe([0])
        ->and($poll->title_snapshot)->toBe('Lunch?');

    // jsonb reorders object keys, so compare by key.
    $options = $deck->slides()->first()->options()->get();
    expect($poll->options_snapshot)->toEqual([
        ['id' => $options[0]->id, 'position' => 1, 'label' => 'Pizza', 'image_file_id' => $optionImage->id, 'image_url' => $optionImage->url, 'is_correct' => null, 'payload' => ['color' => 'red']],
        ['id' => $options[1]->id, 'position' => 2, 'label' => 'Soup', 'image_file_id' => null, 'image_url' => null, 'is_correct' => true, 'payload' => []],
    ])->and($poll->options_snapshot[0]['is_correct'])->toBeNull()
        ->and($poll->options_snapshot[1]['is_correct'])->toBeTrue();

    // Timers come from the slide alone (authoring seeds them from the deck); 0 = off; only answer types are timed.
    expect([$runs[0]->time_limit_seconds, $runs[0]->get_ready_seconds])->toBe([20, null])
        ->and([$runs[3]->time_limit_seconds, $runs[3]->get_ready_seconds])->toBe([30, 5])
        ->and([$runs[1]->time_limit_seconds, $runs[1]->get_ready_seconds])->toBe([null, null])
        ->and([$runs[4]->time_limit_seconds, $runs[4]->get_ready_seconds])->toBe([null, null]);

    // Media through TakesMedia::withMedia with the soft-deleted file, URL from File::url.
    expect($runs[2]->config_snapshot['media'])->toEqual([
        'file_id' => $image->id, 'url' => $image->url, 'width' => 800, 'height' => 600, 'mime' => 'image/webp',
    ])->and($runs[2]->config_snapshot['caption'])->toBe('Look');

    // Host view: every run plus the current one with its aggregate.
    expect($response->json('data.runs'))->toHaveCount(5)
        ->and($response->json('data.current_run.id'))->toBe($poll->id)
        ->and($response->json('data.current_run.aggregate.total_responses'))->toBe(0)
        ->and($response->json('data.results_visibility'))->toBe('host')
        ->and($response->json('data.seconds_remaining'))->toBeNull()
        ->and($response->json('data.server_time'))->toBe(now()->toISOString());
});

it('never brings back a deck default timer the slide turned off', function () {
    $host = DeckFactory::newOwner();
    // Stored the way DeckSettings writes it.
    $settings = ['default_time_limit' => 30, 'get_ready_seconds' => 5, 'theme' => 'default', 'show_qr_sidebar' => true, 'default_qa_sort' => 'top'];
    $deck = sessApiDeck($host, [
        ['poll_single', ['time_limit_seconds' => null, 'get_ready_seconds' => null]],
        ['poll_single', ['time_limit_seconds' => 0, 'get_ready_seconds' => 0]],
        ['poll_single', ['time_limit_seconds' => 15, 'get_ready_seconds' => 3]],
    ], ['settings' => $settings]);

    $runs = sessApiStart($host, $deck)->runs()->get();

    expect($runs->map(fn ($run) => [$run->time_limit_seconds, $run->get_ready_seconds])->all())
        ->toBe([[null, null], [null, null], [15, 3]]);

    // Through the real authoring API: seeded from the deck, then switched off on the slide.
    Sanctum::actingAs($host);
    $authored = $this->postJson('/api/v1/quests/v2', ['title' => 'Timers'])->assertCreated()->json('data.deck.id');
    $this->patchJson("/api/v1/quests/v2/{$authored}", ['settings' => ['get_ready_seconds' => 5, 'default_time_limit' => 30]])->assertOk();
    $slideId = $this->postJson("/api/v1/quests/v2/{$authored}/slides", ['type' => 'poll_single'])->assertCreated()->json('data.slide.id');
    expect(Slide::findOrFail($slideId)->only(['time_limit_seconds', 'get_ready_seconds']))
        ->toBe(['time_limit_seconds' => 30, 'get_ready_seconds' => 5]);
    $this->patchJson("/api/v1/quests/v2/{$authored}/slides/{$slideId}", ['get_ready_seconds' => 0, 'time_limit_seconds' => null])->assertOk();

    $authoredSession = sessApiStart($host, Deck::findOrFail($authored));
    $run = $authoredSession->runs()->where('slide_id', $slideId)->sole();
    expect([$run->time_limit_seconds, $run->get_ready_seconds])->toBe([null, null]);

    if ($authoredSession->fresh()->current_slide_run_id !== $run->id) {
        sessApiAdvance($authoredSession, ['action' => 'jump_to', 'target_run_id' => $run->id])->assertOk();
    }
    sessApiAdvance($authoredSession, ['action' => 'start_voting'])->assertOk()->assertJsonPath('data.current_run.state', 'voting');
});

it('refuses to snapshot a pin on image slide without a usable image and names its position', function () {
    $host = DeckFactory::newOwner();
    $deck = sessApiDeck($host, [['heading'], ['pin_on_image']]);

    Sanctum::actingAs($host);
    $this->postJson("/api/v1/quests/v2/{$deck->id}/sessions")
        ->assertStatus(422)
        ->assertJsonPath('status', false)
        ->assertJsonPath('message', 'Validation Error')
        ->assertJsonValidationErrors(['slides.2.media'], 'data.validation_errors');

    // An image without recorded dimensions is not usable either.
    $file = sessApiFile($host, ['width' => null, 'height' => null]);
    $deck->slides()->where('type', 'pin_on_image')->update(['media_file_id' => $file->id]);

    $response = $this->postJson("/api/v1/quests/v2/{$deck->id}/sessions")->assertStatus(422);
    $errors = $response->json('data.validation_errors');

    expect(array_keys($errors))->toContain('slides.2.media', 'slides.2.media.width', 'slides.2.media.height')
        ->and($errors['slides.2.media'][0])->toStartWith('Slide 2: ')
        ->and(DeckSession::where('deck_id', $deck->id)->count())->toBe(0);

    $file->forceFill(['width' => 640, 'height' => 480])->save();
    $this->postJson("/api/v1/quests/v2/{$deck->id}/sessions")->assertCreated();
});

it('allows one live session per deck at a time', function () {
    $host = DeckFactory::newOwner();
    $deck = sessApiDeck($host, [['poll_single']]);
    $first = sessApiStart($host, $deck);

    $this->postJson("/api/v1/quests/v2/{$deck->id}/sessions")
        ->assertStatus(409)
        ->assertJsonPath('data.code', 'conflict')
        ->assertJsonPath('data.session_id', $first->id);

    $this->postJson("/api/v1/quest-sessions/v2/{$first->id}/end")->assertOk();
    $second = sessApiStart($host, $deck);

    expect($second->id)->not->toBe($first->id)
        ->and($second->join_code)->not->toBe($first->join_code);
});

it('refuses empty decks, other hosts, other products, guests and types the product does not offer', function () {
    $host = DeckFactory::newOwner();
    $empty = Deck::factory()->ownedBy($host)->create();
    $quiz = Deck::factory()->quiz()->ownedBy($host)->create();
    Slide::factory()->ofType('heading')->create(['deck_id' => $quiz->id]);
    $deck = sessApiDeck($host, [['heading']]);

    $this->postJson("/api/v1/quests/v2/{$deck->id}/sessions")->assertUnauthorized();

    Sanctum::actingAs($host);
    $this->postJson("/api/v1/quests/v2/{$empty->id}/sessions")->assertStatus(409)->assertJsonPath('data.code', 'conflict');
    $this->postJson("/api/v1/quests/v2/{$quiz->id}/sessions")->assertNotFound()->assertJsonPath('message', 'Deck not found.');

    $deck->delete();
    $this->postJson("/api/v1/quests/v2/{$deck->id}/sessions")->assertNotFound();

    $other = sessApiDeck(DeckFactory::newOwner(), [['heading']]);
    $this->postJson("/api/v1/quests/v2/{$other->id}/sessions")->assertNotFound();

    app(SlideTypeRegistry::class)->register(new class () extends AbstractSlideType {
        public function key(): string
        {
            return 'sess_api_quiz_only';
        }

        public function products(): array
        {
            return ['quiz'];
        }

        public function category(): string
        {
            return self::CATEGORY_POLL;
        }

        public function revealModel(): string
        {
            return self::REVEAL_HIDDEN;
        }
    });
    $mixed = sessApiDeck($host, [['heading'], ['sess_api_quiz_only', ['config' => []]]]);

    $this->postJson("/api/v1/quests/v2/{$mixed->id}/sessions")
        ->assertStatus(422)
        ->assertJsonPath('data.code', 'unsupported_type')
        ->assertJsonPath('data.type', 'sess_api_quiz_only')
        ->assertJsonPath('data.position', 2)
        ->assertJsonValidationErrors(['slides.2.type'], 'data.validation_errors');

    expect(DeckSession::whereIn('deck_id', [$empty->id, $quiz->id, $deck->id, $other->id, $mixed->id])->count())->toBe(0);
});

it('retries join code collisions up to five times', function () {
    $taken = DeckSession::factory()->create()->join_code;
    $fresh = 'F' . Str::upper(Str::random(9));
    $generator = fn (array $codes) => new class ($codes) extends JoinCodeGenerator {
        public function __construct(private array $codes) {}

        public function candidate(): string
        {
            return array_shift($this->codes);
        }
    };

    expect($generator([$taken, $taken, $taken, $taken, $fresh])->generate())->toBe($fresh);

    $host = DeckFactory::newOwner();
    $deck = sessApiDeck($host, [['heading']]);
    app()->instance(JoinCodeGenerator::class, $generator(array_fill(0, 5, $taken)));

    Sanctum::actingAs($host);
    $this->postJson("/api/v1/quests/v2/{$deck->id}/sessions")->assertStatus(409)->assertJsonPath('data.code', 'conflict');

    $codes = collect(range(1, 200))->map(fn () => (new JoinCodeGenerator())->candidate());
    expect($codes->every(fn (string $code) => preg_match(SESS_API_CODE_PATTERN, $code) === 1))->toBeTrue()
        ->and(DeckSession::where('deck_id', $deck->id)->count())->toBe(0);
});

// --- join-code lookup ---------------------------------------------------------------

it('looks up live sessions by join code, case-insensitively, and shows nothing private', function () {
    $host = DeckFactory::newOwner();
    $deck = sessApiDeck($host, [['poll_single']], ['title' => 'Team retro']);
    $session = sessApiStart($host, $deck);
    $code = $session->join_code;

    $response = $this->getJson('/api/v1/quest-sessions/v2/by-code/' . strtolower($code))->assertOk();

    expect($response->json('data'))->toBe([
        'session_id' => $session->id,
        'join_code' => $code,
        'product' => 'quest',
        'deck_title' => 'Team retro',
        'status' => 'live',
        'public_channel_key' => $session->public_channel_key,
    ]);

    $this->getJson('/api/v1/quest-sessions/v2/by-code/' . substr($code, 0, 3) . '-' . strtolower(substr($code, 3)))
        ->assertOk()->assertJsonPath('data.session_id', $session->id);
    $this->getJson('/api/v1/quest-sessions/v2/by-code/ZZZZZZZZZZZZ')->assertNotFound()->assertJsonPath('data.code', 'not_found');

    $quizSession = DeckSession::factory()->live()->create(['deck_id' => Deck::factory()->quiz()->create()->id, 'join_code' => 'QUIZ' . Str::upper(Str::random(6))]);
    $this->getJson("/api/v1/quest-sessions/v2/by-code/{$quizSession->join_code}")->assertNotFound();

    $this->postJson("/api/v1/quest-sessions/v2/{$session->id}/end")->assertOk();
    $this->getJson("/api/v1/quest-sessions/v2/by-code/{$code}")->assertNotFound();
});

it('throttles by-code lookups per IP, whatever participant token is sent', function () {
    // Array-backed copy of the registered limiters: counters stay out of the dev Redis.
    $limiters = (fn () => $this->limiters)->call(app(CacheRateLimiter::class));
    $fresh = new CacheRateLimiter(app('cache')->store('array'));
    foreach ($limiters as $name => $callback) {
        $fresh->for($name, $callback);
    }
    RateLimiter::swap($fresh);

    $route = app('router')->getRoutes()->getByName('deck.quest.sessions.by-code');
    expect($route->gatherMiddleware())->toContain('throttle:deck-lookup')->not->toContain('throttle:deck-participant');

    $request = Request::create('/x', 'GET', server: ['REMOTE_ADDR' => '10.0.0.9', 'HTTP_X_PARTICIPANT_TOKEN' => Str::random(64)]);
    [$misses, $all] = $fresh->limiter('deck-lookup')($request);
    expect($misses->key)->toBe('deck-lookup-miss:10.0.0.9')
        ->and($misses->maxAttempts)->toBe(30)
        ->and($all->key)->toBe('deck-lookup:10.0.0.9')
        ->and($all->maxAttempts)->toBe(300);

    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single']]));
    app('auth')->forgetGuards();
    $lookup = fn (string $code, string $ip = '10.0.0.9') => $this->withServerVariables(['REMOTE_ADDR' => $ip])
        ->getJson("/api/v1/quest-sessions/v2/by-code/{$code}", [ParticipantTokenService::HEADER => Str::random(64)]);

    // Found codes only use the classroom-sized budget.
    foreach (range(1, 40) as $i) {
        $lookup($session->join_code)->assertOk();
    }

    // Guesses: 30 a minute per IP, fresh made-up tokens or not.
    foreach (range(1, 30) as $i) {
        $lookup('ZZZZ' . $i)->assertNotFound();
    }
    $lookup('ZZZZ31')->assertStatus(429);
    $lookup($session->join_code)->assertStatus(429);
    $lookup($session->join_code, '10.0.0.10')->assertOk();

    $this->travel(61)->seconds();
    $lookup($session->join_code)->assertOk();
});

// --- state views ---------------------------------------------------------------------

it('gives the host every run with the live aggregate and participants only what they may see', function () {
    $host = DeckFactory::newOwner();
    $deck = sessApiDeck($host, [['poll_single'], ['heading']]);
    $session = sessApiStart($host, $deck);
    $run = sessApiCurrent($session);
    [$participant, $token] = sessApiParticipant($session);
    sessApiParticipant($session);

    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk();
    $this->app['auth']->forgetGuards();
    sessApiParticipantState($session, $token)->assertOk()
        ->assertJsonPath('data.has_answered', false)
        ->assertJsonPath('data.my_submission_for_current_slide', null);

    $answer = DeckParticipantAnswer::factory()->create([
        'slide_run_id' => $run->id,
        'deck_participant_id' => $participant->id,
        'answer_payload' => ['option_id' => $run->options_snapshot[0]['id']],
    ]);
    Sanctum::actingAs($host);

    $hostView = $this->getJson("/api/v1/quest-sessions/v2/{$session->id}/state")->assertOk();
    expect($hostView->json('data.participant_count'))->toBe(2)
        ->and($hostView->json('data.runs'))->toHaveCount(2)
        ->and($hostView->json('data.runs.0'))->not->toHaveKey('aggregate')
        ->and($hostView->json('data.current_run.state'))->toBe('voting')
        ->and($hostView->json('data.current_run.aggregate.total_responses'))->toBe(1)
        ->and($hostView->json('data.current_run.aggregate.options.0.count'))->toBe(1)
        ->and($hostView->json('data.results_visibility'))->toBe('host');

    // Results are host-only by default: the participant never gets them, voting or closed.
    // The token picks the participant view even for a signed-in caller.
    $view = sessApiParticipantState($session, $token)->assertOk();
    expect($view->json('data.aggregate'))->toBeNull()
        ->and($view->json('data.results_visibility'))->toBe('host')
        ->and($view->json('data.has_answered'))->toBeTrue()
        ->and($view->json('data.my_submission_for_current_slide'))->toBe([
            'slide_run_id' => $run->id,
            'answer_payload' => ['option_id' => $run->options_snapshot[0]['id']],
            'time_to_answer_ms' => $answer->time_to_answer_ms,
            'submitted_at' => $answer->submitted_at?->toISOString(),
        ])
        ->and($view->json('data.current_slide_run'))->toBe($view->json('data.current_run'))
        ->and($view->json('data'))->not->toHaveKey('participant_count')
        ->and($view->json('data.participant.id'))->toBe($participant->id)
        ->and($view->json('data.session.public_channel_key'))->toBe($session->public_channel_key)
        ->and($view->json('data.session.total_slides'))->toBe(2)
        ->and($view->json('data.current_run.id'))->toBe($run->id)
        ->and($view->json('data.current_run'))->not->toHaveKey('aggregate')
        ->and(collect($view->json('data.current_run.options'))->every(fn ($option) => ! array_key_exists('is_correct', $option)))->toBeTrue()
        ->and($view->json('data'))->not->toHaveKey('runs')
        ->and($view->json('data'))->toHaveKeys(['seconds_remaining', 'ends_at', 'duration_seconds', 'server_time']);

    sessApiAdvance($session, ['action' => 'close_voting'])->assertOk();
    expect(sessApiParticipantState($session, $token)->json('data.aggregate'))->toBeNull();

    // "Show votes to participants" makes the aggregate public.
    $run->forceFill(['config_snapshot' => ['show_results_to_participants' => true] + $run->config_snapshot])->save();
    $public = sessApiParticipantState($session, $token)->assertOk();
    expect($public->json('data.results_visibility'))->toBe('public')
        ->and($public->json('data.aggregate.total_responses'))->toBe(1);
});

it('keeps both state views to their own callers', function () {
    $this->travelTo(now()->startOfSecond());
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single']]));
    [, $token] = sessApiParticipant($session);
    $otherSession = sessApiStart($otherHost = DeckFactory::newOwner(), sessApiDeck($otherHost, [['heading']]));
    [, $otherToken] = sessApiParticipant($otherSession);

    // Another host: 404, like a session that does not exist.
    Sanctum::actingAs(DeckFactory::newOwner());
    $this->getJson("/api/v1/quest-sessions/v2/{$session->id}/state")->assertNotFound()->assertJsonPath('message', 'Session not found.');
    sessApiAdvance($session, ['action' => 'start_voting'])->assertNotFound();
    $this->postJson("/api/v1/quest-sessions/v2/{$session->id}/end")->assertNotFound();

    // GET state serves a participant token with the participant view; tokens only work for their own session.
    $this->app['auth']->forgetGuards();
    sessApiParticipantState($session, $token)->assertOk()
        ->assertJsonPath('data.session_id', $session->id)
        ->assertJsonPath('data.session.public_channel_key', $session->public_channel_key)
        ->assertJsonMissingPath('data.runs')
        ->assertJsonMissingPath('data.join');
    sessApiParticipantState($session, $otherToken)->assertUnauthorized()->assertJsonPath('data.code', 'unauthorized');
    sessApiParticipantState($session, 'not-a-token')->assertUnauthorized();
    $this->getJson('/api/v1/quest-sessions/v2/999999999999/state', [ParticipantTokenService::HEADER => $token])->assertNotFound();
    // Signed out and no token: 401.
    $this->getJson("/api/v1/quest-sessions/v2/{$session->id}/state")->assertUnauthorized()->assertJsonPath('data.code', 'unauthorized');

    // The participant-state alias is token-only and answers the same view.
    $this->getJson("/api/v1/quest-sessions/v2/{$session->id}/participant-state")->assertUnauthorized()->assertJsonPath('data.code', 'unauthorized');
    $alias = $this->getJson("/api/v1/quest-sessions/v2/{$session->id}/participant-state", [ParticipantTokenService::HEADER => $token])->assertOk();
    expect($alias->json('data'))->toBe(sessApiParticipantState($session, $token)->json('data'));

    // Participant tokens never open the host actions.
    $this->postJson("/api/v1/quest-sessions/v2/{$session->id}/advance", ['action' => 'start_voting'], [ParticipantTokenService::HEADER => $token])->assertUnauthorized();
    expect(sessApiCurrent($session)->state)->toBe('waiting');
});

// --- transitions ----------------------------------------------------------------------

it('runs a poll through waiting, voting and closed and broadcasts every transition', function () {
    $this->travelTo(now()->startOfSecond());
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single'], ['heading']]));
    $run = sessApiCurrent($session);

    sessApiAdvance($session, ['action' => 'close_voting'])->assertStatus(409)
        ->assertJsonPath('data.code', 'invalid_state')
        ->assertJsonPath('data.state', 'waiting')
        ->assertJsonPath('data.slide_run_id', $run->id);

    $response = sessApiAdvance($session, ['action' => 'start_voting'])->assertOk()
        ->assertJsonPath('data.current_run.state', 'voting')
        ->assertJsonPath('data.current_run.state_version', 1);
    $run->refresh();

    expect($run->state)->toBe('voting')
        ->and($run->state_version)->toBe(1)
        ->and($run->state_started_at->toISOString())->toBe(now()->toISOString())
        ->and($run->voting_started_at->toISOString())->toBe(now()->toISOString())
        ->and($response->json('data.seconds_remaining'))->toBeNull()
        ->and(sessApiJobs())->toHaveCount(0); // untimed: no auto-close

    $state = sessApiEvents('slide.state.changed')->last();
    expect($state->broadcastOn()->name)->toBe("session.quest.{$session->public_channel_key}")
        ->and($state->broadcastWith())->toMatchArray(['slide_run_id' => $run->id, 'state' => 'voting', 'state_version' => 1]);

    sessApiAdvance($session, ['action' => 'start_voting'])->assertStatus(409)->assertJsonPath('data.state', 'voting');

    $this->travel(3)->seconds();
    sessApiAdvance($session, ['action' => 'close_voting'])->assertOk()->assertJsonPath('data.current_run.state', 'closed');
    $run->refresh();

    expect($run->state_version)->toBe(2)
        ->and($run->closed_at->toISOString())->toBe(now()->toISOString())
        ->and(sessApiEvents('slide.state.changed')->last()->broadcastWith())->toMatchArray(['state' => 'closed', 'state_version' => 2]);

    // Results are host-only: slide.closed is public without them, the host gets the final aggregate privately.
    $closed = sessApiEvents('slide.closed')->sole();
    $final = sessApiEvents('slide.aggregate.updated')->last();
    expect($closed->broadcastWith()['aggregate'])->toBeNull()
        ->and($closed->isPrivate())->toBeFalse()
        ->and($final->isPrivate())->toBeTrue()
        ->and($final->broadcastOn()->name)->toBe("private-host.quest.v2.{$session->id}");

    // A closed run is never reopened or closed twice.
    sessApiAdvance($session, ['action' => 'start_voting'])->assertStatus(409)->assertJsonPath('data.state', 'closed');
    sessApiAdvance($session, ['action' => 'close_voting'])->assertStatus(409);
    expect($run->fresh()->state_version)->toBe(2);
});

it('runs Q&A slides through open instead of voting and never times them', function () {
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['qa_audience', ['time_limit_seconds' => 30, 'get_ready_seconds' => 5]]]));
    $run = sessApiCurrent($session);

    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk()->assertJsonPath('data.current_run.state', 'open');
    expect($run->fresh()->state)->toBe('open')
        ->and($run->fresh()->voting_started_at)->not->toBeNull()
        ->and(sessApiJobs())->toHaveCount(0);

    sessApiAdvance($session, ['action' => 'start_voting'])->assertStatus(409);
    sessApiAdvance($session, ['action' => 'close_voting'])->assertOk()->assertJsonPath('data.current_run.state', 'closed');
    expect($run->fresh()->state_version)->toBe(2)
        ->and(sessApiEvents('slide.closed'))->toHaveCount(1);
});

it('only navigates on content slides', function () {
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['heading'], ['bullets'], ['poll_single']]));
    $first = sessApiCurrent($session);

    sessApiAdvance($session, ['action' => 'start_voting'])->assertStatus(409)->assertJsonPath('message', 'This slide does not take votes.');
    sessApiAdvance($session, ['action' => 'close_voting'])->assertStatus(409);
    sessApiAdvance($session, ['action' => 'previous_slide'])->assertStatus(409)->assertJsonPath('message', 'This is already the first slide.');

    sessApiAdvance($session, ['action' => 'next_slide'])->assertOk()->assertJsonPath('data.current_run.type', 'bullets');
    sessApiAdvance($session, ['action' => 'next_slide'])->assertOk()->assertJsonPath('data.current_run.type', 'poll_single');
    sessApiAdvance($session, ['action' => 'next_slide'])->assertStatus(409)->assertJsonPath('message', 'This is already the last slide.');
    sessApiAdvance($session, ['action' => 'previous_slide'])->assertOk()->assertJsonPath('data.current_run.type', 'bullets');

    // Visiting a content slide is not a transition of that slide.
    expect($first->fresh()->state)->toBe('waiting')
        ->and($first->fresh()->state_version)->toBe(0);
});

it('closes a voting slide before moving on and broadcasts the slide change', function () {
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single'], ['poll_multi']]));
    [$first, $second] = $session->runs()->get()->all();

    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk();
    Event::fake([LiveBroadcastEvent::class]);

    sessApiAdvance($session, ['action' => 'next_slide'])->assertOk()
        ->assertJsonPath('data.session.current_slide_run_id', $second->id)
        ->assertJsonPath('data.current_run.state', 'waiting');

    expect($first->fresh()->state)->toBe('closed')
        ->and($first->fresh()->state_version)->toBe(2)
        ->and($second->fresh()->state_version)->toBe(0)
        ->and(sessApiEvents()->map->broadcastAs()->all())->toBe([
            'slide.state.changed', 'slide.closed', 'slide.aggregate.updated', 'slide.changed', 'slide.state.changed',
        ]);

    $changed = sessApiEvents('slide.changed')->sole()->broadcastWith();
    expect($changed)->toMatchArray(['slide_run_id' => $second->id, 'position' => 2, 'total_slides' => 2, 'type' => 'poll_multi', 'state' => 'waiting'])
        ->and($changed['slide'])->not->toHaveKey('aggregate')
        ->and($changed['slide']['id'])->toBe($second->id);

    // Going back from a waiting slide needs no confirmation; the closed slide stays closed.
    sessApiAdvance($session, ['action' => 'previous_slide'])->assertOk()
        ->assertJsonPath('data.current_run.id', $first->id)
        ->assertJsonPath('data.current_run.state', 'closed');
});

it('keeps every slide.changed under the Reverb request limit and flags slim ones for a refetch', function () {
    $host = DeckFactory::newOwner();
    $bengali = str_repeat('আমাদের সোনার বাংলা ', 10); // 200 characters
    $paragraph = ['type' => 'doc', 'content' => array_fill(0, 10, ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => mb_substr($bengali, 0, 150)]]])];

    // Stored without the authoring budget (e.g. before it existed).
    $session = sessApiStart($host, sessApiDeck($host, [
        ['heading', ['title' => 'Start']],
        ['paragraph', ['title' => 'Long', 'body' => $paragraph]],
        ['poll_single', ['title' => 'Many', 'options' => array_fill(0, 8, mb_substr($bengali, 0, 200))]],
        ['poll_single', ['title' => 'Small']],
    ]));
    [, $long, $many, $small] = $session->runs()->get()->all();
    Event::fake([LiveBroadcastEvent::class]);

    foreach ([$long, $many, $small] as $expected) {
        sessApiAdvance($session, ['action' => 'next_slide'])->assertOk()->assertJsonPath('data.current_run.id', $expected->id);
    }

    $events = sessApiEvents();
    $changed = sessApiEvents('slide.changed');
    expect($events->every(fn (LiveBroadcastEvent $event) => sessApiPublishBytes($event) <= SessionStateMachine::SLIDE_CHANGED_MAX_BYTES))->toBeTrue()
        ->and($changed)->toHaveCount(3);

    [$longEvent, $manyEvent, $smallEvent] = $changed->map->broadcastWith()->all();
    foreach ([[$longEvent, $long, 'paragraph'], [$manyEvent, $many, 'poll_single']] as [$event, $run, $type]) {
        expect($event['slide'])->toMatchArray(['id' => $run->id, 'type' => $type, 'position' => $run->position_snapshot, 'state' => 'waiting', 'refetch' => true])
            ->and($event['slide'])->not->toHaveKeys(['title', 'body', 'options', 'config'])
            ->and($event)->toMatchArray(['slide_run_id' => $run->id, 'total_slides' => 4]);
    }

    // A slide that fits goes out whole.
    expect($smallEvent['slide'])->not->toHaveKey('refetch')
        ->and($smallEvent['slide']['title'])->toBe('Small')
        ->and($smallEvent['slide']['options'])->toHaveCount(2);

    // The refetch gets the full slide.
    [, $token] = sessApiParticipant($session);
    sessApiAdvance($session, ['action' => 'jump_to', 'target_run_id' => $many->id])->assertOk();
    $this->app['auth']->forgetGuards();
    $state = sessApiParticipantState($session, $token)->assertOk();
    expect($state->json('data.current_run.options'))->toHaveCount(8)
        ->and($state->json('data.current_run.title'))->toBe('Many');
});

it('needs force to go back from a voting slide', function () {
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single'], ['poll_single'], ['poll_single']]));
    [$first, $second, $third] = $session->runs()->get()->all();

    sessApiAdvance($session, ['action' => 'next_slide'])->assertOk();
    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk();

    sessApiAdvance($session, ['action' => 'previous_slide'])->assertStatus(409)
        ->assertJsonPath('data.code', 'invalid_state')
        ->assertJsonPath('data.requires_force', true)
        ->assertJsonPath('data.state', 'voting');
    sessApiAdvance($session, ['action' => 'jump_to', 'target_run_id' => $first->id])->assertStatus(409)->assertJsonPath('data.requires_force', true);
    expect($second->fresh()->state)->toBe('voting');

    sessApiAdvance($session, ['action' => 'previous_slide', 'force' => true])->assertOk()->assertJsonPath('data.current_run.id', $first->id);
    expect($second->fresh()->state)->toBe('closed');

    // Forward jumps close the voting slide without asking.
    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk();
    sessApiAdvance($session, ['action' => 'jump_to', 'target_run_id' => $third->id])->assertOk()->assertJsonPath('data.current_run.id', $third->id);
    expect($first->fresh()->state)->toBe('closed');

    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk();
    sessApiAdvance($session, ['action' => 'jump_to', 'target_run_id' => $first->id, 'force' => 1])->assertOk()->assertJsonPath('data.current_run.id', $first->id);
    expect($third->fresh()->state)->toBe('closed');
});

it('validates jump targets and actions', function () {
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single'], ['heading']]));
    $current = sessApiCurrent($session);
    $foreignRun = DeckSessionSlideRun::factory()->create();

    sessApiAdvance($session, ['action' => 'jump_to'])->assertStatus(422)->assertJsonValidationErrors(['target_run_id'], 'data.validation_errors');
    sessApiAdvance($session, ['action' => 'jump_to', 'target_run_id' => 'abc'])->assertStatus(422);
    sessApiAdvance($session, ['action' => 'jump_to', 'target_run_id' => $foreignRun->id])->assertNotFound()->assertJsonPath('message', 'Slide not found in this session.');
    sessApiAdvance($session, ['action' => 'jump_to', 'target_run_id' => $current->id])->assertStatus(409)->assertJsonPath('message', 'This slide is already showing.');
    sessApiAdvance($session, ['action' => 'reveal'])->assertStatus(422)->assertJsonValidationErrors(['action'], 'data.validation_errors');
    sessApiAdvance($session, [])->assertStatus(422);
    sessApiAdvance($session, ['action' => 'next_slide', 'force' => 'maybe'])->assertStatus(422);
});

it('refuses transitions once the session is not live', function () {
    $host = DeckFactory::newOwner();
    $deck = sessApiDeck($host, [['poll_single']]);
    $pending = DeckSession::factory()->create(['deck_id' => $deck->id]);

    Sanctum::actingAs($host);
    sessApiAdvance($pending, ['action' => 'start_voting'])->assertStatus(409)->assertJsonPath('data.status', 'pending');

    $session = sessApiStart($host, $deck);
    $this->postJson("/api/v1/quest-sessions/v2/{$session->id}/end")->assertOk();
    sessApiAdvance($session, ['action' => 'start_voting'])->assertStatus(409)->assertJsonPath('message', 'This session is not live.');
});

// --- timers -------------------------------------------------------------------------

it('counts down get_ready and opens voting from the delayed job, ignoring stale jobs', function () {
    $this->travelTo(now()->startOfSecond());
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single', ['get_ready_seconds' => 5, 'time_limit_seconds' => 20]]]));
    $run = sessApiCurrent($session);

    $response = sessApiAdvance($session, ['action' => 'start_voting'])->assertOk()
        ->assertJsonPath('data.current_run.state', 'get_ready')
        ->assertJsonPath('data.seconds_remaining', 5)
        ->assertJsonPath('data.duration_seconds', 5);

    $getReady = sessApiJobs()->sole();
    expect($getReady)->toMatchObject([
        'sessionId' => $session->id, 'slideRunId' => $run->id, 'expectedStateVersion' => 1, 'expectedState' => 'get_ready',
    ])->and($getReady->delay->getTimestamp())->toBe(now()->addSeconds(5)->getTimestamp())
        ->and($response->json('data.ends_at'))->toBe(now()->addSeconds(5)->toISOString());

    // Started early anyway (a retry, clock skew): it re-queues instead of acting, and never sleeps.
    $this->travel(1)->seconds();
    sessApiRunJob($getReady);
    expect($run->fresh()->state)->toBe('get_ready');

    $this->travel(3500)->milliseconds();
    sessApiRunJob($getReady);
    expect($run->fresh()->state)->toBe('get_ready');
    Sleep::assertNeverSlept();

    // At the deadline it opens voting.
    $this->travel(500)->milliseconds();
    sessApiRunJob($getReady);
    $run->refresh();

    expect($run->state)->toBe('voting')
        ->and($run->state_version)->toBe(2)
        ->and($run->voting_started_at)->not->toBeNull()
        ->and(sessApiEvents('slide.state.changed')->last()->broadcastWith())->toMatchArray([
            'state' => 'voting', 'state_version' => 2, 'seconds_remaining' => 20, 'duration_seconds' => 20,
        ]);

    // The time limit is queued for the voting state.
    $close = sessApiJobs()->last();
    expect($close)->toMatchObject(['expectedStateVersion' => 2, 'expectedState' => 'voting'])
        ->and($close->delay->getTimestamp())->toBe(now()->addSeconds(20)->getTimestamp());

    // Re-running the get_ready job (a duplicate delivery) changes nothing.
    sessApiRunJob($getReady);
    expect($run->fresh()->state_version)->toBe(2);

    expect(app(SessionStateMachine::class)->applyTimer($session->id, $run->id, 1, 'get_ready'))->toBeFalse();
});

it('never queues a timer job before its deadline, even mid-second', function () {
    // Queue delays are whole Unix seconds: a deadline at .300 must round up, not down.
    $this->travelTo(now()->startOfSecond()->addMilliseconds(300));
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single', ['get_ready_seconds' => 3, 'time_limit_seconds' => 10]]]));
    $run = sessApiCurrent($session);

    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk();
    $deadline = now()->addSeconds(3);
    $job = sessApiJobs()->sole();

    expect($job->delay->getTimestamp())->toBe($deadline->getTimestamp() + 1)
        ->and($job->delay->getTimestampMs())->toBeGreaterThanOrEqual($deadline->getTimestampMs());

    // When the queue makes it available (that whole second), it is due: no sleep, no re-queue.
    $this->travelTo($job->delay);
    sessApiRunJob($job);
    expect($run->fresh()->state)->toBe('voting');
    Sleep::assertNeverSlept();

    $close = sessApiJobs()->last();
    expect($close->delay->getTimestampMs())->toBeGreaterThanOrEqual(now()->addSeconds(10)->getTimestampMs())
        ->and($close->delay->getTimestampMs() - now()->addSeconds(10)->getTimestampMs())->toBeLessThan(1000);
});

it('commits an overdue timer even when the host action that found it fails', function () {
    $this->travelTo(now()->startOfSecond());
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single', ['time_limit_seconds' => 10]], ['heading']]));
    $run = sessApiCurrent($session);
    [, $token] = sessApiParticipant($session);

    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk();
    $this->travel(11)->seconds();
    Event::fake([LiveBroadcastEvent::class]);

    // Illegal now (the time limit closed it): the 409 reports what the database holds.
    sessApiAdvance($session, ['action' => 'start_voting'])->assertStatus(409)
        ->assertJsonPath('data.code', 'invalid_state')
        ->assertJsonPath('data.state', 'closed')
        ->assertJsonPath('data.state_version', 2);

    $run->refresh();
    expect($run->state)->toBe('closed')
        ->and($run->state_version)->toBe(2)
        ->and(sessApiEvents('slide.closed'))->toHaveCount(1)
        ->and(sessApiEvents('slide.state.changed')->sole()->broadcastWith())->toMatchArray(['state' => 'closed', 'state_version' => 2]);

    $this->app['auth']->forgetGuards();
    sessApiParticipantState($session, $token)->assertOk()->assertJsonPath('data.current_run.state', 'closed');
});

it('commits an overdue timer when a jump target does not exist', function () {
    $this->travelTo(now()->startOfSecond());
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single', ['get_ready_seconds' => 2]], ['heading']]));
    $run = sessApiCurrent($session);

    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk()->assertJsonPath('data.current_run.state', 'get_ready');
    $this->travel(2)->seconds();

    sessApiAdvance($session, ['action' => 'jump_to', 'target_run_id' => DeckSessionSlideRun::factory()->create()->id])->assertNotFound();
    expect($run->fresh()->only(['state', 'state_version']))->toBe(['state' => 'voting', 'state_version' => 2]);
});

it('applies an overdue timer before answering the aggregate, for the host and participants', function (string $viewer) {
    $this->travelTo(now()->startOfSecond());
    $host = DeckFactory::newOwner();
    $config = ['show_results_to_participants' => true] + app(SlideTypeRegistry::class)->for('poll_single')->defaultConfig();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single', ['time_limit_seconds' => 10, 'config' => $config]]]));
    $run = sessApiCurrent($session);
    [, $token] = sessApiParticipant($session);
    $url = "/api/v1/quest-sessions/v2/{$session->id}/slide-runs/{$run->id}/aggregate";
    $headers = $viewer === 'participant' ? [ParticipantTokenService::HEADER => $token] : [];

    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk();
    if ($viewer === 'participant') {
        app('auth')->forgetGuards();
    }

    $this->getJson($url, $headers)->assertOk()->assertJsonPath('data.state', 'voting')->assertJsonPath('data.final', false);

    // The timer job is late (faked, never runs): the read applies the deadline itself.
    $this->travel(11)->seconds();
    $this->getJson($url, $headers)->assertOk()
        ->assertJsonPath('data.state', 'closed')
        ->assertJsonPath('data.state_version', 2)
        ->assertJsonPath('data.final', true);

    expect($run->fresh()->state)->toBe('closed')
        ->and(sessApiEvents('slide.closed'))->toHaveCount(1);
})->with(['host', 'participant']);

it('closes voting when the time limit runs out', function () {
    $this->travelTo(now()->startOfSecond());
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single', ['time_limit_seconds' => 10]]]));
    $run = sessApiCurrent($session);

    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk()->assertJsonPath('data.seconds_remaining', 10);
    $job = sessApiJobs()->sole();
    expect($job)->toMatchObject(['expectedStateVersion' => 1, 'expectedState' => 'voting']);

    $this->travel(10)->seconds();
    sessApiRunJob($job);
    $run->refresh();

    expect($run->state)->toBe('closed')
        ->and($run->state_version)->toBe(2)
        ->and($run->closed_at->toISOString())->toBe(now()->toISOString())
        ->and(sessApiEvents('slide.closed')->sole()->broadcastWith()['slide_run_id'])->toBe($run->id);
});

it('no-ops a timer job once the host has moved the run on', function () {
    $this->travelTo(now()->startOfSecond());
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single', ['time_limit_seconds' => 10]], ['poll_single', ['time_limit_seconds' => 10]]]));
    [$first, $second] = $session->runs()->get()->all();

    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk();
    $stale = sessApiJobs()->sole();
    sessApiAdvance($session, ['action' => 'close_voting'])->assertOk();
    sessApiAdvance($session, ['action' => 'next_slide'])->assertOk();
    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk();

    $this->travel(10)->seconds();
    $closedEvents = sessApiEvents('slide.closed')->count();
    sessApiRunJob($stale);

    expect($first->fresh()->state_version)->toBe(2)
        ->and($second->fresh()->state)->toBe('voting')
        ->and(sessApiEvents('slide.closed')->count())->toBe($closedEvents);

    // A job for a run that is no longer current never closes it either.
    expect(app(SessionStateMachine::class)->applyTimer($session->id, $first->id, 2, 'closed'))->toBeFalse();

    sessApiRunJob(sessApiJobs()->last());
    expect($second->fresh()->state)->toBe('closed');
});

it('applies an overdue timer on the next state read when no job ran', function () {
    $this->travelTo(now()->startOfSecond());
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single', ['get_ready_seconds' => 3, 'time_limit_seconds' => 10]]]));
    $run = sessApiCurrent($session);
    [, $token] = sessApiParticipant($session);

    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk();

    $this->travel(3)->seconds();
    sessApiParticipantState($session, $token)->assertOk()
        ->assertJsonPath('data.current_run.state', 'voting')
        ->assertJsonPath('data.seconds_remaining', 10);

    $this->travel(10)->seconds();
    $this->getJson("/api/v1/quest-sessions/v2/{$session->id}/state")->assertOk()
        ->assertJsonPath('data.current_run.state', 'closed')
        ->assertJsonPath('data.seconds_remaining', null);
    expect($run->fresh()->state_version)->toBe(3);

    // The jobs that never ran are now stale.
    sessApiJobs()->each(fn (TransitionSlideRunJob $job) => sessApiRunJob($job));
    expect($run->fresh()->state_version)->toBe(3);
});

it('never sleeps in the request or skips a countdown when the sync queue runs a timer job inline', function () {
    $this->travelTo(now()->startOfSecond());
    Queue::fake([BroadcastDeckAggregate::class]); // TransitionSlideRunJob now runs on the real sync queue
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single', ['get_ready_seconds' => 2]]]));

    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk()->assertJsonPath('data.current_run.state', 'get_ready');
    Sleep::assertNeverSlept();
    expect(sessApiCurrent($session)->state)->toBe('get_ready');

    $this->travel(2)->seconds();
    $this->getJson("/api/v1/quest-sessions/v2/{$session->id}/state")->assertOk()->assertJsonPath('data.current_run.state', 'voting');
});

it('treats close_voting as done when the time limit closed the slide in the same request', function () {
    $this->travelTo(now()->startOfSecond());
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single', ['time_limit_seconds' => 5]]]));

    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk();
    $this->travel(6)->seconds();

    sessApiAdvance($session, ['action' => 'close_voting'])->assertOk()->assertJsonPath('data.current_run.state', 'closed');
    expect(sessApiCurrent($session)->state_version)->toBe(2)
        ->and(sessApiEvents('slide.closed'))->toHaveCount(1);
});

// --- end --------------------------------------------------------------------------

it('ends a session, closes the voting slide and revokes every participant token', function () {
    $this->travelTo(now()->startOfSecond());
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single'], ['heading']]));
    $run = sessApiCurrent($session);
    [, $token] = sessApiParticipant($session);
    [$other] = sessApiParticipant($session);

    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk();
    sessApiParticipantState($session, $token)->assertOk();

    $this->postJson("/api/v1/quest-sessions/v2/{$session->id}/end")->assertOk()
        ->assertJsonPath('message', 'Session ended.')
        ->assertJsonPath('data.session.status', 'ended')
        ->assertJsonPath('data.session.ended_at', now()->toISOString())
        ->assertJsonPath('data.current_run.state', 'closed');

    $session->refresh();
    expect($session->status)->toBe('ended')
        ->and($session->ended_at)->not->toBeNull()
        ->and($run->fresh()->state)->toBe('closed')
        ->and(DeckParticipant::where('deck_session_id', $session->id)->whereNull('participant_token_revoked_at')->count())->toBe(0)
        ->and($other->fresh()->participant_token_revoked_at)->not->toBeNull()
        ->and(sessApiEvents('slide.closed'))->toHaveCount(1);

    $ended = sessApiEvents('session.ended')->sole();
    expect($ended->isPrivate())->toBeFalse()
        ->and($ended->broadcastOn()->name)->toBe("session.quest.{$session->public_channel_key}")
        ->and(Arr::only($ended->broadcastWith(), ['slide_run_id', 'session_id', 'status', 'ended_at', 'server_time']))->toEqual([
            'slide_run_id' => $run->id,
            'session_id' => $session->id,
            'status' => 'ended',
            'ended_at' => now()->toISOString(),
            'server_time' => now()->toISOString(),
        ])
        ->and(array_keys(SessionEndedPayload::fromSession($session)->toArray()))->toBe(['slide_run_id', 'session_id', 'status', 'ended_at', 'server_time']);

    // The session-ended broadcast goes out after the slide closed.
    expect(sessApiEvents()->map->broadcastAs()->last())->toBe('session.ended');

    sessApiParticipantState($session, $token)->assertUnauthorized();
    $this->postJson("/api/v1/quest-sessions/v2/{$session->id}/end")->assertStatus(409)->assertJsonPath('data.code', 'invalid_state');
    $this->getJson("/api/v1/quest-sessions/v2/{$session->id}/state")->assertOk()->assertJsonPath('data.session.status', 'ended');
});

it('locks the session row and then the run row for host actions and session end', function () {
    $host = DeckFactory::newOwner();
    $session = sessApiStart($host, sessApiDeck($host, [['poll_single'], ['heading']]));

    DB::enableQueryLog();
    sessApiAdvance($session, ['action' => 'start_voting'])->assertOk();
    $this->postJson("/api/v1/quest-sessions/v2/{$session->id}/end")->assertOk();
    $locks = collect(DB::getQueryLog())->pluck('query')->filter(fn (string $sql) => str_ends_with($sql, 'for update'))->values();
    DB::disableQueryLog();

    $tables = $locks->map(fn (string $sql) => str_contains($sql, 'from "deck_sessions"') ? 'session' : (str_contains($sql, 'from "deck_session_slide_runs"') ? 'run' : 'other'));
    expect($tables->all())->toBe(['session', 'run', 'session', 'run']);
});
