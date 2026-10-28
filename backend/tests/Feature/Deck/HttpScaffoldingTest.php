<?php

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\Controllers\DeckController;
use App\Deck\Http\DeckRoutes;
use App\Deck\Http\DeckValidation;
use App\Deck\Http\Middleware\ResolveDeckParticipant;
use App\Deck\Http\Resources\DeckPresenter;
use App\Deck\Http\Resources\MediaPresenter;
use App\Deck\Http\Resources\OptionPresenter;
use App\Deck\Http\Resources\SlidePresenter;
use App\Deck\Policies\DeckPolicy;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Support\OptionLimits;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use App\Models\File;
use App\Models\User;
use App\Providers\DeckServiceProvider;
use App\Services\Live\ParticipantTokenService;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File as Filesystem;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

/** DeckController's protected lookups, exposed for the probe routes (anonymous: no class to autoload). */
function deckHttpProbe(): DeckController
{
    static $probe;

    return $probe ??= new class () extends DeckController {
        public function deck(Request $request, string $deck)
        {
            return $this->okResponse(['product' => $this->product($request)] + DeckPresenter::summary($this->ownedDeck($request, $deck)));
        }

        public function slide(Request $request, string $deck, string $slide)
        {
            return $this->okResponse(SlidePresenter::slide($this->ownedSlide($this->ownedDeck($request, $deck), $slide)));
        }

        public function option(Request $request, string $deck, string $slide, string $option)
        {
            $slide = $this->ownedSlide($this->ownedDeck($request, $deck), $slide);

            return $this->okResponse(OptionPresenter::option($this->ownedOption($slide, $option)));
        }

        public function session(Request $request, string $session)
        {
            return $this->okResponse(['id' => $this->ownedSession($request, $session)->id]);
        }

        public function run(Request $request, string $session, string $run)
        {
            $run = $this->sessionRun($this->ownedSession($request, $session), $run);

            return $this->okResponse(['id' => $run->id, 'sessionLoaded' => $run->relationLoaded('session')]);
        }

        public function me(Request $request)
        {
            $participant = $this->participant($request);

            return $this->okResponse([
                'participantId' => $participant->id,
                'sessionId' => $this->participantSession($request)->id,
                'product' => $this->product($request),
            ]);
        }

        public function invalidConfig()
        {
            return $this->prefixErrors('config', fn () => throw ValidationException::withMessages(['option_ids' => 'Pick an option.']));
        }

        public function unsupported()
        {
            throw DeckException::unsupportedType('pick_answer_single');
        }
    };
}

/** Probe routes, registered the way routes/deck files are (api group + deck flag + product defaults). */
function deckHttpProbeRoutes(): void
{
    Route::group(['middleware' => 'api', 'prefix' => 'api/v1', DeckServiceProvider::ROUTE_FLAG => true], function () {
        foreach (['quest' => 'deck-probe/quests', 'quiz' => 'deck-probe/quizzes'] as $product => $prefix) {
            DeckRoutes::group($product, $prefix, "deck-probe.{$product}.", function () {
                Route::middleware('auth:sanctum')->group(function () {
                    Route::get('{deck}', fn (Request $r, string $deck) => deckHttpProbe()->deck($r, $deck));
                    Route::get('{deck}/slides/{slide}', fn (Request $r, string $deck, string $slide) => deckHttpProbe()->slide($r, $deck, $slide));
                    Route::get('{deck}/slides/{slide}/options/{option}', fn (Request $r, string $deck, string $slide, string $option) => deckHttpProbe()->option($r, $deck, $slide, $option));
                    Route::get('sessions/{session}', fn (Request $r, string $session) => deckHttpProbe()->session($r, $session));
                    Route::get('sessions/{session}/runs/{run}', fn (Request $r, string $session, string $run) => deckHttpProbe()->run($r, $session, $run));
                });
                Route::get('play/{session}/me', fn (Request $r) => deckHttpProbe()->me($r))->middleware('deck.participant');
                Route::post('invalid-config', fn () => deckHttpProbe()->invalidConfig());
                Route::post('unsupported', fn () => deckHttpProbe()->unsupported());
            });
        }
    });
}

function deckHttpFile(User $owner, array $overrides = []): File
{
    return File::create(array_replace([
        'name' => 'pic-' . Str::random(6) . '.webp',
        'type' => 'image',
        'category' => File::CATEGORY_IMAGE,
        'visibility' => File::VISIBILITY_PUBLIC,
        'path' => "storage/library/{$owner->id}/images/pic.webp",
        'mime_type' => 'image/webp',
        'extension' => 'webp',
        'size' => 2048,
        'width' => 800,
        'height' => 600,
        'user_id' => $owner->id,
    ], $overrides));
}

/** A live session of a deck owned by $host, with one run, and a participant holding a fresh token. */
function deckHttpLiveSession(?User $host = null, string $product = Deck::PRODUCT_QUEST): array
{
    $host ??= DeckFactory::newOwner();
    $deck = Deck::factory()->ownedBy($host)->state(['product' => $product])->create();
    $session = DeckSession::factory()->live()->create(['deck_id' => $deck->id, 'host_user_id' => $host->id]);
    $run = DeckSessionSlideRun::factory()->create(['deck_session_id' => $session->id]);
    $participant = DeckParticipant::factory()->create(['deck_session_id' => $session->id]);
    $token = app(ParticipantTokenService::class)->issue($participant, $session);

    return compact('host', 'deck', 'session', 'run', 'participant', 'token');
}

beforeEach(function () {
    config(['broadcasting.default' => 'null', 'cache.default' => 'array', 'queue.default' => 'sync']);
    deckHttpProbeRoutes();
});

// --- route files -----------------------------------------------------------

it('loads every routes/deck file, sorted by name, inside api/v1', function () {
    $files = DeckServiceProvider::routeFiles(base_path('routes/deck'));

    expect($files)->toContain(base_path('routes/deck/meta.php'))
        ->and($files)->toBe(collect($files)->sort()->values()->all());

    $route = Route::getRoutes()->getByName('deck.meta.emoji-avatars');
    expect($route)->not->toBeNull()
        ->and($route->uri())->toBe('api/v1/meta/emoji-avatars')
        ->and($route->gatherMiddleware())->toContain('api')
        ->and($route->getAction(DeckServiceProvider::ROUTE_FLAG))->toBeTrue();
});

it('loads route files from a directory in name order with product defaults', function () {
    $dir = storage_path('framework/testing/deck-routes-' . Str::uuid());
    Filesystem::ensureDirectoryExists($dir);
    $GLOBALS['deckHttpLoadOrder'] = [];

    Filesystem::put("{$dir}/b_sessions.php", <<<'PHP'
        <?php
        $GLOBALS['deckHttpLoadOrder'][] = 'b';
        App\Deck\Http\DeckRoutes::sessions(function (string $product) {
            Illuminate\Support\Facades\Route::get('{session}/probe-b', fn () => 'b')->whereNumber('session')->name('probe-b');
        });
        PHP);
    Filesystem::put("{$dir}/a_authoring.php", <<<'PHP'
        <?php
        $GLOBALS['deckHttpLoadOrder'][] = 'a';
        App\Deck\Http\DeckRoutes::authoring(function (string $product) {
            Illuminate\Support\Facades\Route::get('probe-a', fn () => $product)->name('probe-a');
        });
        PHP);
    Filesystem::put("{$dir}/notes.txt", 'ignored');

    try {
        DeckServiceProvider::loadRouteFiles($dir);
    } finally {
        Filesystem::deleteDirectory($dir);
    }
    Route::getRoutes()->refreshNameLookups();

    expect($GLOBALS['deckHttpLoadOrder'])->toBe(['a', 'b']);

    $authoring = Route::getRoutes()->getByName('deck.quest.probe-a');
    $sessions = Route::getRoutes()->getByName('deck.quest.sessions.probe-b');

    expect($authoring->uri())->toBe('api/v1/quests/v2/probe-a')
        ->and($authoring->defaults)->toBe(['product' => 'quest'])
        ->and($authoring->gatherMiddleware())->toContain('api')
        ->and($sessions->uri())->toBe('api/v1/quest-sessions/v2/{session}/probe-b')
        ->and($sessions->defaults)->toBe(['product' => 'quest']);

    $this->get('/api/v1/quests/v2/probe-a')->assertOk()->assertSee('quest');
});

it('registers product-scoped routes once per configured product', function () {
    config(['deck.routes.quiz' => ['authoring' => 'quizzes/v2-probe', 'sessions' => 'quiz-sessions/v2-probe']]);

    Route::middleware('api')->prefix('api/v1')->group(function () {
        DeckRoutes::authoring(fn (string $product) => Route::get('product-probe', fn () => $product)->name('product-probe'));
        DeckRoutes::sessions(fn () => Route::get('quiz-only-probe', fn () => 'x')->name('quiz-only-probe'), products: ['quiz']);
    });
    Route::getRoutes()->refreshNameLookups();

    expect(Route::getRoutes()->getByName('deck.quest.product-probe')->uri())->toBe('api/v1/quests/v2/product-probe')
        ->and(Route::getRoutes()->getByName('deck.quiz.product-probe')->uri())->toBe('api/v1/quizzes/v2-probe/product-probe')
        ->and(Route::getRoutes()->getByName('deck.quiz.sessions.quiz-only-probe'))->not->toBeNull()
        ->and(Route::getRoutes()->getByName('deck.quest.sessions.quiz-only-probe'))->toBeNull();

    $this->get('/api/v1/quests/v2/product-probe')->assertSee('quest');
    $this->get('/api/v1/quizzes/v2-probe/product-probe')->assertSee('quiz');
    expect(DeckRoutes::prefixes('authoring'))->toBe(['quest' => 'quests/v2', 'quiz' => 'quizzes/v2-probe']);
});

it('refuses routes without a product and unknown products', function () {
    expect(fn () => DeckRoutes::product(Request::create('/x')))->toThrow(LogicException::class)
        ->and(fn () => DeckRoutes::group('survey', 'surveys/v2', 'x.', fn () => null))->toThrow(LogicException::class)
        ->and(DeckRoutes::productOf(null))->toBeNull();
});

it('parses route ids strictly', function (mixed $value, ?int $expected) {
    expect(DeckRoutes::id($value))->toBe($expected);
})->with([
    'numeric string' => ['42', 42],
    'int' => [7, 7],
    'zero' => ['0', null],
    'negative' => ['-3', null],
    'leading zero' => ['007', null],
    'letters' => ['abc', null],
    'decimal' => ['1.5', null],
    'bigint overflow' => ['99999999999999999999', null],
    'null' => [null, null],
]);

// --- ownership ---------------------------------------------------------------

it('returns the owned deck and 404s everyone else', function () {
    $owner = DeckFactory::newOwner();
    $deck = Deck::factory()->ownedBy($owner)->create(['title' => 'Mine']);

    Sanctum::actingAs($owner);
    $this->getJson("/api/v1/deck-probe/quests/{$deck->id}")
        ->assertOk()
        ->assertJsonPath('status', true)
        ->assertJsonPath('data.product', 'quest')
        ->assertJsonPath('data.id', $deck->id)
        ->assertJsonPath('data.title', 'Mine');

    // Wrong product route, junk ids, soft-deleted: all 404 not_found.
    $this->getJson("/api/v1/deck-probe/quizzes/{$deck->id}")->assertNotFound()->assertJsonPath('data.code', 'not_found');
    $this->getJson('/api/v1/deck-probe/quests/abc')->assertNotFound()->assertJsonPath('status', false);
    $this->getJson('/api/v1/deck-probe/quests/99999999999999999999')->assertNotFound();

    Sanctum::actingAs(DeckFactory::newOwner());
    $this->getJson("/api/v1/deck-probe/quests/{$deck->id}")
        ->assertNotFound()
        ->assertExactJson(['status' => false, 'message' => 'Deck not found.', 'data' => ['code' => 'not_found']]);

    Sanctum::actingAs($owner);
    $deck->delete();
    $this->getJson("/api/v1/deck-probe/quests/{$deck->id}")->assertNotFound();
});

it('scopes decks to the route product', function () {
    $owner = DeckFactory::newOwner();
    $quiz = Deck::factory()->ownedBy($owner)->quiz()->create();
    Sanctum::actingAs($owner);

    $this->getJson("/api/v1/deck-probe/quizzes/{$quiz->id}")->assertOk()->assertJsonPath('data.product', 'quiz');
    $this->getJson("/api/v1/deck-probe/quests/{$quiz->id}")->assertNotFound();
});

it('404s slides and options outside the deck', function () {
    $owner = DeckFactory::newOwner();
    $deck = Deck::factory()->ownedBy($owner)->create();
    $other = Deck::factory()->ownedBy($owner)->create();
    $slide = Slide::factory()->create(['deck_id' => $deck->id]);
    $foreignSlide = Slide::factory()->create(['deck_id' => $other->id]);
    $option = SlideOption::factory()->create(['slide_id' => $slide->id]);
    $foreignOption = SlideOption::factory()->create(['slide_id' => $foreignSlide->id]);
    Sanctum::actingAs($owner);

    $this->getJson("/api/v1/deck-probe/quests/{$deck->id}/slides/{$slide->id}")->assertOk()->assertJsonPath('data.id', $slide->id);
    $this->getJson("/api/v1/deck-probe/quests/{$deck->id}/slides/{$foreignSlide->id}")
        ->assertNotFound()->assertJsonPath('message', 'Slide not found.');
    $this->getJson("/api/v1/deck-probe/quests/{$deck->id}/slides/{$slide->id}/options/{$option->id}")
        ->assertOk()->assertJsonPath('data.id', $option->id);
    $this->getJson("/api/v1/deck-probe/quests/{$deck->id}/slides/{$slide->id}/options/{$foreignOption->id}")
        ->assertNotFound()->assertJsonPath('message', 'Option not found.');

    $slide->delete();
    $this->getJson("/api/v1/deck-probe/quests/{$deck->id}/slides/{$slide->id}")->assertNotFound();

    // Someone else cannot reach the slide through its deck either.
    Sanctum::actingAs(DeckFactory::newOwner());
    $this->getJson("/api/v1/deck-probe/quests/{$other->id}/slides/{$foreignSlide->id}")->assertNotFound()->assertJsonPath('message', 'Deck not found.');
});

it('returns hosted sessions and their runs only', function () {
    $live = deckHttpLiveSession();
    $otherRun = DeckSessionSlideRun::factory()->create();
    Sanctum::actingAs($live['host']);

    $this->getJson("/api/v1/deck-probe/quests/sessions/{$live['session']->id}")->assertOk()->assertJsonPath('data.id', $live['session']->id);
    $this->getJson("/api/v1/deck-probe/quests/sessions/{$live['session']->id}/runs/{$live['run']->id}")
        ->assertOk()->assertJsonPath('data.id', $live['run']->id)->assertJsonPath('data.sessionLoaded', true);
    $this->getJson("/api/v1/deck-probe/quests/sessions/{$live['session']->id}/runs/{$otherRun->id}")
        ->assertNotFound()->assertJsonPath('data.code', 'not_found');
    $this->getJson("/api/v1/deck-probe/quizzes/sessions/{$live['session']->id}")->assertNotFound();
    $this->getJson('/api/v1/deck-probe/quests/sessions/0')->assertNotFound();

    Sanctum::actingAs(DeckFactory::newOwner());
    $this->getJson("/api/v1/deck-probe/quests/sessions/{$live['session']->id}")
        ->assertNotFound()->assertJsonPath('message', 'Session not found.');
});

it('authorises decks and sessions through DeckPolicy', function () {
    $owner = DeckFactory::newOwner();
    $stranger = DeckFactory::newOwner();
    $deck = Deck::factory()->ownedBy($owner)->create();
    $session = DeckSession::factory()->create(['deck_id' => $deck->id, 'host_user_id' => $owner->id]);

    expect(Gate::getPolicyFor(Deck::class))->toBeInstanceOf(DeckPolicy::class)
        ->and(Gate::getPolicyFor(DeckSession::class))->toBeInstanceOf(DeckPolicy::class)
        ->and(Gate::forUser($owner)->allows('manage', $deck))->toBeTrue()
        ->and(Gate::forUser($stranger)->allows('manage', $deck))->toBeFalse()
        ->and(Gate::forUser($owner)->allows('manage', $session))->toBeTrue()
        ->and(Gate::forUser($stranger)->allows('manage', $session))->toBeFalse();
});

// --- participant middleware ----------------------------------------------------

it('resolves the participant from X-Participant-Token', function () {
    $live = deckHttpLiveSession();

    $this->getJson("/api/v1/deck-probe/quests/play/{$live['session']->id}/me", ['X-Participant-Token' => $live['token']])
        ->assertOk()
        ->assertJsonPath('data.participantId', $live['participant']->id)
        ->assertJsonPath('data.sessionId', $live['session']->id)
        ->assertJsonPath('data.product', 'quest');
});

it('answers 401 for a missing, unknown, expired, revoked or foreign token', function () {
    $live = deckHttpLiveSession();
    $other = deckHttpLiveSession();
    $url = "/api/v1/deck-probe/quests/play/{$live['session']->id}/me";
    $unauthorized = ['status' => false, 'message' => 'Invalid or expired participant token.', 'data' => ['code' => 'unauthorized']];

    $this->getJson($url)->assertUnauthorized()->assertExactJson($unauthorized);
    $this->getJson($url, ['X-Participant-Token' => 'not-a-token'])->assertUnauthorized()->assertExactJson($unauthorized);
    $this->getJson($url, ['X-Participant-Token' => $other['token']])->assertUnauthorized();

    $live['participant']->forceFill(['participant_token_expires_at' => now()->subMinute()])->save();
    $this->getJson($url, ['X-Participant-Token' => $live['token']])->assertUnauthorized();

    $live['participant']->forceFill(['participant_token_expires_at' => now()->addHour()])->save();
    $this->getJson($url, ['X-Participant-Token' => $live['token']])->assertOk();

    app(ParticipantTokenService::class)->revokeForDeckSession($live['session']);
    $this->getJson($url, ['X-Participant-Token' => $live['token']])->assertUnauthorized();
});

it('answers 404 when the session is missing or of another product', function () {
    $quiz = deckHttpLiveSession(product: Deck::PRODUCT_QUIZ);
    $missing = (int) DeckSession::max('id') + 1000;

    $this->getJson("/api/v1/deck-probe/quests/play/{$missing}/me", ['X-Participant-Token' => $quiz['token']])
        ->assertNotFound()->assertJsonPath('message', 'Session not found.')->assertJsonPath('data.code', 'not_found');
    $this->getJson('/api/v1/deck-probe/quests/play/abc/me', ['X-Participant-Token' => $quiz['token']])->assertNotFound();
    $this->getJson("/api/v1/deck-probe/quests/play/{$quiz['session']->id}/me", ['X-Participant-Token' => $quiz['token']])->assertNotFound();
    $this->getJson("/api/v1/deck-probe/quizzes/play/{$quiz['session']->id}/me", ['X-Participant-Token' => $quiz['token']])
        ->assertOk()->assertJsonPath('data.product', 'quiz');
});

it('fails loudly when a controller reads a participant without the middleware', function () {
    expect(fn () => ResolveDeckParticipant::participant(Request::create('/x')))->toThrow(LogicException::class)
        ->and(fn () => ResolveDeckParticipant::session(Request::create('/x')))->toThrow(LogicException::class);
});

// --- errors ---------------------------------------------------------------------

it('renders slide-type validation errors like BaseFormRequest, keys prefixed', function () {
    $this->postJson('/api/v1/deck-probe/quests/invalid-config')
        ->assertStatus(422)
        ->assertExactJson([
            'status' => false,
            'message' => 'Validation Error',
            'data' => ['validation_errors' => ['config.option_ids' => ['Pick an option.']]],
        ]);

    expect(DeckValidation::prefixErrors(['items.2' => ['x']], 'answer_payload'))->toBe(['answer_payload.items.2' => ['x']])
        ->and(DeckValidation::prefixErrors(['a' => ['x']], ''))->toBe(['a' => ['x']]);
});

it('renders DeckException codes in the app envelope', function () {
    $this->postJson('/api/v1/deck-probe/quests/unsupported')
        ->assertStatus(422)
        ->assertExactJson([
            'status' => false,
            'message' => 'Unsupported slide type for this product.',
            'data' => [
                'code' => 'unsupported_type',
                'type' => 'pick_answer_single',
                'validation_errors' => ['type' => ['Unsupported slide type for this product.']],
            ],
        ]);

    $cases = [
        [DeckException::notFound(), 404, 'not_found'],
        [DeckException::conflict('Busy.'), 409, 'conflict'],
        [DeckException::invalidState('Not voting.'), 409, 'invalid_state'],
        [DeckException::forbidden(), 403, 'forbidden'],
        [DeckException::unauthorized(), 401, 'unauthorized'],
    ];
    foreach ($cases as [$exception, $status, $code]) {
        $response = $exception->render();
        expect($response->getStatusCode())->toBe($status)
            ->and($response->getData(true))->toBe(['status' => false, 'message' => $exception->getMessage(), 'data' => ['code' => $code]]);
    }
});

// --- presenters -------------------------------------------------------------------

it('presents a full deck with slides, options and resolved files', function () {
    $owner = DeckFactory::newOwner();
    $cover = deckHttpFile($owner);
    $media = deckHttpFile($owner, ['width' => 1024, 'height' => 768]);
    $optionImage = deckHttpFile($owner, ['mime_type' => 'image/png', 'extension' => 'png']);
    $deck = Deck::factory()->ownedBy($owner)->create(['title' => 'Deck', 'cover_file_id' => $cover->id, 'settings' => []]);
    $poll = Slide::factory()->ofType('poll_single', ['submit_mode' => 'confirm'])->create(['deck_id' => $deck->id, 'time_limit_seconds' => 30]);
    $image = Slide::factory()->ofType('image', [])->create(['deck_id' => $deck->id, 'media_file_id' => $media->id, 'title' => null]);
    $second = SlideOption::factory()->create(['slide_id' => $poll->id, 'position' => 2, 'label' => 'B']);
    $first = SlideOption::factory()->create(['slide_id' => $poll->id, 'position' => 1, 'label' => 'A', 'image_file_id' => $optionImage->id]);
    $cover->delete(); // removed from My Files: the deck keeps showing it

    $data = DeckPresenter::detail($deck->fresh());
    $registry = app(SlideTypeRegistry::class);

    expect(array_keys($data))->toBe(['id', 'product', 'title', 'description', 'coverFileId', 'cover', 'settings', 'visibility', 'slideCount', 'publishedAt', 'createdAt', 'updatedAt', 'slides'])
        ->and($data['id'])->toBe($deck->id)
        ->and($data['coverFileId'])->toBe($cover->id)
        ->and($data['cover'])->toMatchArray(['fileId' => $cover->id, 'url' => $cover->url, 'mime' => 'image/webp', 'width' => 800, 'height' => 600, 'inLibrary' => false])
        ->and($data['slideCount'])->toBe(2)
        ->and(json_encode($data['settings']))->toBe('{}')
        ->and(array_column($data['slides'], 'id'))->toBe([$poll->id, $image->id]);

    [$pollData, $imageData] = $data['slides'];
    expect(array_keys($pollData))->toBe(['id', 'deckId', 'type', 'category', 'revealModel', 'acceptsAnswers', 'position', 'title', 'body', 'config', 'mediaFileId', 'media', 'timeLimitSeconds', 'getReadySeconds', 'pointsMin', 'pointsMax', 'speedBonusEnabled', 'options', 'createdAt', 'updatedAt'])
        ->and($pollData)->toMatchArray([
            'deckId' => $deck->id,
            'type' => 'poll_single',
            'category' => $registry->for('poll_single')->category(),
            'revealModel' => $registry->for('poll_single')->revealModel(),
            'acceptsAnswers' => true,
            'config' => ['submit_mode' => 'confirm'],
            'mediaFileId' => null,
            'media' => null,
            'timeLimitSeconds' => 30,
        ])
        ->and(array_column($pollData['options'], 'id'))->toBe([$first->id, $second->id])
        ->and($imageData['media'])->toBe([
            'fileId' => $media->id,
            'url' => $media->url,
            'name' => $media->name,
            'mime' => 'image/webp',
            'category' => 'image',
            'width' => 1024,
            'height' => 768,
            'size' => 2048,
            'inLibrary' => true,
        ])
        ->and($imageData['acceptsAnswers'])->toBeFalse()
        ->and(json_encode($imageData['config']))->toBe('{}');

    $option = $pollData['options'][0];
    expect(array_keys($option))->toBe(['id', 'slideId', 'position', 'label', 'imageFileId', 'image', 'isCorrect', 'payload', 'createdAt', 'updatedAt'])
        ->and($option)->toMatchArray(['slideId' => $poll->id, 'position' => 1, 'label' => 'A', 'imageFileId' => $optionImage->id, 'isCorrect' => null])
        ->and($option['image'])->toMatchArray(['fileId' => $optionImage->id, 'url' => $optionImage->url, 'mime' => 'image/png'])
        ->and(json_encode($option['payload']))->toBe('{}')
        ->and($pollData['options'][1]['image'])->toBeNull();
});

it('presents summaries, pages and unknown slide types', function () {
    $owner = DeckFactory::newOwner();
    $deck = Deck::factory()->ownedBy($owner)->create(['settings' => ['theme' => 'dark']]);
    foreach (range(1, 3) as $_) {
        Slide::factory()->create(['deck_id' => $deck->id]);
    }
    $legacy = Slide::factory()->ofType('retired_type')->create(['deck_id' => $deck->id]);

    $page = DeckPresenter::forSummary(Deck::query()->ownedBy($owner)->quest())->paginate(10);
    $listed = DeckPresenter::page($page);

    expect($listed['meta'])->toBe(['currentPage' => 1, 'perPage' => 10, 'total' => 1, 'lastPage' => 1])
        ->and($listed['items'][0])->toMatchArray(['id' => $deck->id, 'slideCount' => 4, 'cover' => null, 'settings' => ['theme' => 'dark']])
        ->and(array_key_exists('slides', $listed['items'][0]))->toBeFalse()
        ->and(DeckPresenter::summary($deck->fresh())['slideCount'])->toBe(4);

    expect(SlidePresenter::slide($legacy))->toMatchArray(['type' => 'retired_type', 'category' => null, 'revealModel' => null, 'acceptsAnswers' => null])
        ->and(MediaPresenter::file(null))->toBeNull()
        ->and(MediaPresenter::iso(null))->toBeNull();
});

// --- meta, config, limits ---------------------------------------------------------------

it('serves the curated emoji avatars publicly with cache headers', function () {
    $response = $this->getJson('/api/v1/meta/emoji-avatars')
        ->assertOk()
        ->assertJsonPath('status', true)
        ->assertJsonPath('data.emojis', config('deck.emoji_avatars'));

    $emojis = $response->json('data.emojis');
    expect(count($emojis))->toBeGreaterThanOrEqual(36)->toBeLessThanOrEqual(48)
        ->and(array_unique($emojis))->toHaveCount(count($emojis))
        ->and(collect($emojis)->every(fn ($emoji) => mb_strlen($emoji) === 1))->toBeTrue()
        ->and(array_keys($response->json('data.labels')))->toBe($emojis)
        ->and($emojis)->toContain('🦊', '🐼', '🐙', '🦉', '🐢'); // DeckParticipantFactory's picks

    $cacheControl = $response->headers->get('Cache-Control');
    expect($cacheControl)->toContain('public')->toContain('max-age=86400')
        ->and($response->headers->has('Set-Cookie'))->toBeFalse();

    $this->getJson('/api/v1/meta/emoji-avatars', ['If-None-Match' => $response->headers->get('ETag')])->assertStatus(304);

    // A shared-cacheable response must never carry the SPA's session cookies.
    config(['sanctum.stateful' => ['spa.deck.test']]);
    $spa = ['Referer' => 'http://spa.deck.test/', 'Origin' => 'http://spa.deck.test'];
    $this->getJson('/api/v1/meta/emoji-avatars', $spa)->assertOk()->assertHeaderMissing('Set-Cookie');
    expect($this->getJson('/api/v1/deck-probe/quests/play/0/me', $spa)->headers->has('Set-Cookie'))->toBeTrue(); // control
});

it('reads option limits and join-code settings from config', function () {
    expect(OptionLimits::max('ranking'))->toBe(12)
        ->and(OptionLimits::max('scales'))->toBe(20)
        ->and(OptionLimits::max('poll_single'))->toBe(30)
        ->and(OptionLimits::max('rating'))->toBe(30)
        ->and(OptionLimits::min('poll_single'))->toBe(2)
        ->and(OptionLimits::min('poll_multi'))->toBe(2)
        ->and(OptionLimits::min('ranking'))->toBe(2)
        ->and(OptionLimits::min('scales'))->toBe(1)
        ->and(OptionLimits::min('word_cloud'))->toBe(0)
        ->and(config('deck.join_code_alphabet'))->toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789')
        ->and(config('deck.join_code_length'))->toBe(6)
        ->and(config('deck.max_answer_body_kb'))->toBe(32);
});

it('registers the deck rate limiters', function () {
    $tokenRequest = Request::create('/x', 'GET', server: ['REMOTE_ADDR' => '10.0.0.1', 'HTTP_X_PARTICIPANT_TOKEN' => 'abc']);
    $anonymous = Request::create('/x', 'POST', ['display_name' => ' Ada '], server: ['REMOTE_ADDR' => '10.0.0.1']);

    $participant = RateLimiter::limiter('deck-participant')($tokenRequest);
    $join = RateLimiter::limiter('deck-join')($anonymous);
    $author = RateLimiter::limiter('deck-author')($anonymous);

    expect($participant->key)->toBe('deck-participant:pt:' . hash('sha256', 'abc'))
        ->and($participant->maxAttempts)->toBe(240)
        ->and($join[0]->key)->toBe('deck-join:10.0.0.1|ada')
        ->and($join[1]->key)->toBe('deck-join-ip:10.0.0.1')
        ->and($author->key)->toBe('deck-author:10.0.0.1')
        ->and(RateLimiter::limiter('deck-join')(Request::create('/x', 'POST', ['display_name' => ['x']]))[0]->key)->toEndWith('|');
});

it('exposes quest_v2_enabled on the profile, off by default', function () {
    $user = DeckFactory::newOwner(null)->refresh();
    expect($user->quest_v2_enabled)->toBeFalse();

    Sanctum::actingAs($user);
    $this->getJson('/api/v1/profile/show')->assertOk()->assertJsonPath('data.profile.quest_v2_enabled', false);

    $user->update(['quest_v2_enabled' => true]);
    $this->getJson('/api/v1/profile/show')->assertOk()->assertJsonPath('data.profile.quest_v2_enabled', true);
});
