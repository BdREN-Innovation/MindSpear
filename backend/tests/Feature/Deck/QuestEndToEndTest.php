<?php

use App\Deck\Slides\SlideTypeRegistry;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\User;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Cache\RateLimiter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter as RateLimiterFacade;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

/*
 * Quest end to end (plan §3.7, first bullet, plus the Q&A and token
 * revocation bullets), through the real HTTP API only: authoring, My Files
 * upload + media attach, session start, join by code, host transitions,
 * answers, aggregates, reconnect, end. No service or model shortcuts: every
 * id the test uses comes out of an API response, the way a client gets it.
 *
 * Host requests run as the Sanctum user; participant requests run with no
 * user at all (guards forgotten) and only X-Participant-Token, so the
 * controllers that serve both callers see exactly what a browser would send.
 */

uses(DatabaseTransactions::class);

beforeEach(function () {
    Storage::fake('local');
    config([
        'broadcasting.default' => 'null',
        'cache.default' => 'array',
        'queue.default' => 'sync',
        'deck.aggregate_debounce_ms' => 0,
        'app.frontend_url' => 'https://play.example.test',
        'file_library.disk' => 'local',
        'file_library.default_quota_mb' => 200,
        'file_library.max_image_mb' => 10,
        'file_library.max_daily_upload_mb' => 1024,
        'file_library.max_image_dimension' => 1024,
    ]);

    Event::fake([LiveBroadcastEvent::class]);
    e2eArrayRateLimiter();
});

// --- helpers (prefixed e2e: Pest helpers are global) ----------------------------------

const E2E_AUTHOR = '/api/v1/quests';
const E2E_SESSIONS = '/api/v1/quest-sessions';

/** Every Quest type that accepts answers. Checked against the registry in the first test. */
const E2E_ANSWER_TYPES = [
    'poll_single', 'poll_multi', 'word_cloud', 'open_ended', 'scales', 'ranking',
    'points_allocation', 'rating', 'matrix_2x2', 'pin_on_image',
];

/**
 * The container's CACHE_STORE (redis) wins over phpunit.xml and the RateLimiter
 * singleton is built with it at boot. Swap in an array-backed copy of the
 * registered limiters so throttle counters never leak into the dev Redis.
 */
function e2eArrayRateLimiter(): void
{
    $current = app(RateLimiter::class);
    $limiters = (fn () => $this->limiters)->call($current);
    $fresh = new RateLimiter(app('cache')->store('array'));

    foreach ($limiters as $name => $callback) {
        $fresh->for($name, $callback);
    }

    RateLimiterFacade::swap($fresh);
}

function e2eAsHost(User $host): void
{
    app('auth')->forgetGuards();
    Sanctum::actingAs($host);
}

/** No signed-in user: the next request only carries what a participant's browser sends. */
function e2eAsGuest(): void
{
    app('auth')->forgetGuards();
}

/** Moves the frozen clock on so submissions and questions get distinct, ordered timestamps. */
function e2eTick(): void
{
    test()->travel(1)->seconds();
}

function e2eHeaders(string $token): array
{
    return ['X-Participant-Token' => $token, 'Accept' => 'application/json'];
}

/** A real PNG drawn with GD (random pixels, so the library never de-duplicates two). */
function e2ePng(int $width = 64, int $height = 48): UploadedFile
{
    $image = imagecreatetruecolor($width, $height);
    imagefilledrectangle($image, 0, 0, $width - 1, $height - 1, imagecolorallocate($image, random_int(0, 255), random_int(0, 255), random_int(0, 255)));
    for ($i = 0; $i < 16; $i++) {
        imagesetpixel($image, random_int(0, $width - 1), random_int(0, $height - 1), imagecolorallocate($image, random_int(0, 255), random_int(0, 255), random_int(0, 255)));
    }

    $path = tempnam(sys_get_temp_dir(), 'e2epng');
    imagepng($image, $path);

    return new UploadedFile($path, 'map.png', 'image/png', null, true);
}

/** Uploads a PNG to My Files and attaches it to the slide through PUT .../media. Returns the media block. */
function e2eAttachImage(User $host, int $deckId, int $slideId): array
{
    e2eAsHost($host);
    $fileId = test()->post('/api/v1/library/files', ['file' => e2ePng()], ['Accept' => 'application/json'])
        ->assertCreated()
        ->assertJsonPath('data.file.width', 64)
        ->assertJsonPath('data.file.height', 48)
        ->json('data.file.id');

    return test()->putJson(E2E_AUTHOR . "/{$deckId}/slides/{$slideId}/media", ['file_id' => $fileId])
        ->assertOk()
        ->assertJsonPath('data.slide.mediaFileId', $fileId)
        ->assertJsonPath('data.slide.media.width', 64)
        ->assertJsonPath('data.slide.media.height', 48)
        ->json('data.slide.media');
}

/** POST /quests: a new deck, which always starts with one qr_code slide. Returns the deck id. */
function e2eCreateDeck(User $host, string $title): int
{
    e2eAsHost($host);
    $response = test()->postJson(E2E_AUTHOR, ['title' => $title])
        ->assertCreated()
        ->assertJsonPath('data.deck.title', $title)
        ->assertJsonPath('data.deck.product', 'quest')
        ->assertJsonPath('data.deck.slideCount', 1)
        ->assertJsonPath('data.deck.slides.0.type', 'qr_code')
        ->assertJsonPath('data.deck.slides.0.position', 1);

    return (int) $response->json('data.deck.id');
}

/**
 * Per-type scenario: what the author sets, what the 3 participants send and
 * what the aggregate must be. $o = option ids in display order (as the
 * participants read them from their state), $e = the participants' emoji.
 *
 * @return array{config: array, labels: list<string>, answers: Closure, invalid: Closure, check: Closure}
 */
function e2eScenario(string $type): array
{
    $without = fn (array $rows, string $key) => array_map(fn (array $row) => array_diff_key($row, [$key => true]), $rows);

    return match ($type) {
        'poll_single' => [
            'config' => ['submit_mode' => 'confirm'],
            // 2 seeded options + 1 added through POST .../options.
            'labels' => ['Red', 'Green', 'Blue'],
            'answers' => fn (array $o) => [[0, ['option_id' => $o[0]]], [1, ['option_id' => $o[0]]], [2, ['option_id' => $o[1]]]],
            'invalid' => fn (array $o) => [['option_id' => 999999999], 'answer_payload.option_id'],
            'check' => fn (array $agg, array $o) => expect($agg)->toEqual([
                'total_responses' => 3,
                'total_votes' => 3,
                'options' => [
                    ['option_id' => $o[0], 'count' => 2, 'percentage' => 66.67],
                    ['option_id' => $o[1], 'count' => 1, 'percentage' => 33.33],
                    ['option_id' => $o[2], 'count' => 0, 'percentage' => 0],
                ],
            ]),
        ],
        'poll_multi' => [
            'config' => ['min_selections' => 1, 'max_selections' => 2],
            'labels' => ['Docs', 'Tests', 'Types'],
            'answers' => fn (array $o) => [[0, ['option_ids' => [$o[0], $o[1]]]], [1, ['option_ids' => [$o[2], $o[0]]]], [2, ['option_ids' => [$o[1]]]]],
            'invalid' => fn (array $o) => [['option_ids' => $o], 'answer_payload.option_ids'],
            'check' => fn (array $agg, array $o) => expect($agg)->toEqual([
                'total_responses' => 3,
                'total_votes' => 5,
                'average_selections_per_participant' => 1.67,
                'options' => [
                    ['option_id' => $o[0], 'count' => 2, 'percentage' => 66.67],
                    ['option_id' => $o[1], 'count' => 2, 'percentage' => 66.67],
                    ['option_id' => $o[2], 'count' => 1, 'percentage' => 33.33],
                ],
            ]),
        ],
        'word_cloud' => [
            'config' => ['max_entries_per_participant' => 2],
            'labels' => [],
            // Participant 0 changes their mind: without allow_multiple_submissions the second answer replaces the first.
            'answers' => fn () => [
                [0, ['entries' => ['Chaos']]],
                [0, ['entries' => ['Energy', 'focus']]],
                [1, ['entries' => ['energy']]],
                [2, ['entries' => ['  Focus ', 'Team   spirit']]],
            ],
            'invalid' => fn () => [['entries' => ['a', 'b', 'c']], 'answer_payload.entries'],
            'check' => function (array $agg) use ($without) {
                expect($agg['total_responses'])->toBe(3)
                    ->and($agg['total_entries'])->toBe(5)
                    ->and($agg['distinct_words'])->toBe(3)
                    ->and($agg['truncated'])->toBeFalse()
                    ->and($without($agg['words'], 'first_seen_at'))->toBe([
                        ['word' => 'energy', 'count' => 2],
                        ['word' => 'focus', 'count' => 2],
                        ['word' => 'team spirit', 'count' => 1],
                    ]);
            },
        ],
        'open_ended' => [
            'config' => ['max_submissions_per_participant' => 2],
            'labels' => [],
            // Participant 0 answers twice: appended (max_submissions_per_participant 2).
            'answers' => fn () => [
                [0, ['text' => 'Alpha idea']],
                [1, ['text' => 'Beta idea']],
                [2, ['text' => 'Gamma idea']],
                [0, ['text' => 'Delta idea']],
            ],
            'invalid' => fn () => [['text' => str_repeat('x', 501)], 'answer_payload.text'],
            'check' => function (array $agg, array $o, array $e) {
                expect($agg['total_responses'])->toBe(3)
                    ->and($agg['total_entries'])->toBe(4)
                    ->and(array_column($agg['items'], 'body'))->toBe(['Delta idea', 'Gamma idea', 'Beta idea', 'Alpha idea'])
                    ->and(array_column($agg['items'], 'participant_emoji'))->toBe([$e[0], $e[2], $e[1], $e[0]]);
            },
        ],
        'scales' => [
            'config' => ['scale_points' => 5, 'require_all_statements' => false],
            'labels' => ['Pace', 'Clarity', 'Slides'],
            'answers' => fn (array $o) => [
                [0, ['ratings' => [['option_id' => $o[0], 'value' => 5], ['option_id' => $o[1], 'value' => 4]]]],
                [1, ['ratings' => [['option_id' => $o[0], 'value' => 3]]]],
                [2, ['ratings' => [['option_id' => $o[2], 'value' => 1], ['option_id' => $o[0], 'value' => 4], ['option_id' => $o[1], 'value' => 2]]]],
            ],
            'invalid' => fn (array $o) => [['ratings' => [['option_id' => $o[0], 'value' => 6]]], 'answer_payload.ratings.0.value'],
            'check' => fn (array $agg, array $o) => expect($agg)->toEqual([
                'total_responses' => 3,
                'scale_points' => 5,
                'statements' => [
                    ['option_id' => $o[0], 'count' => 3, 'mean' => 4.0, 'distribution' => e2eDistribution([0, 0, 1, 1, 1])],
                    ['option_id' => $o[1], 'count' => 2, 'mean' => 3.0, 'distribution' => e2eDistribution([0, 1, 0, 1, 0])],
                    ['option_id' => $o[2], 'count' => 1, 'mean' => 1.0, 'distribution' => e2eDistribution([1, 0, 0, 0, 0])],
                ],
            ]),
        ],
        'ranking' => [
            'config' => ['require_full_ranking' => true],
            'labels' => ['Speed', 'Price', 'Design', 'Support'],
            'answers' => fn (array $o) => [
                [0, ['order' => [$o[0], $o[1], $o[2], $o[3]]]],
                [1, ['order' => [$o[1], $o[0], $o[2], $o[3]]]],
                [2, ['order' => [$o[0], $o[2], $o[1], $o[3]]]],
            ],
            'invalid' => fn (array $o) => [['order' => [$o[0], $o[1]]], 'answer_payload.order'],
            'check' => function (array $agg, array $o) {
                expect($agg['total_responses'])->toBe(3)
                    ->and($agg['item_count'])->toBe(4)
                    ->and(array_map(fn ($i) => [$i['option_id'], $i['rank'], $i['average_position'], $i['count']], $agg['items']))->toEqual([
                        [$o[0], 1, 1.33, 3],
                        [$o[1], 2, 2.0, 3],
                        [$o[2], 3, 2.67, 3],
                        [$o[3], 4, 4.0, 3],
                    ])
                    ->and($agg['items'][0]['position_counts'])->toEqual([
                        ['position' => 1, 'count' => 2], ['position' => 2, 'count' => 1],
                        ['position' => 3, 'count' => 0], ['position' => 4, 'count' => 0],
                    ]);
            },
        ],
        'points_allocation' => [
            'config' => ['total_points' => 100],
            'labels' => ['Hiring', 'Tooling', 'Travel'],
            'answers' => fn (array $o) => [
                [0, ['allocations' => [['option_id' => $o[0], 'points' => 60], ['option_id' => $o[1], 'points' => 40]]]],
                [1, ['allocations' => [['option_id' => $o[0], 'points' => 50], ['option_id' => $o[1], 'points' => 25], ['option_id' => $o[2], 'points' => 25]]]],
                [2, ['allocations' => [['option_id' => $o[0], 'points' => 100]]]],
            ],
            // §3.7: a sum other than 100 is refused.
            'invalid' => fn (array $o) => [['allocations' => [['option_id' => $o[0], 'points' => 90]]], 'answer_payload.allocations'],
            'check' => fn (array $agg, array $o) => expect($agg)->toEqual([
                'total_responses' => 3,
                'total_points' => 100,
                'total_points_distributed' => 300,
                'options' => [
                    ['option_id' => $o[0], 'points' => 210, 'percentage' => 70.0, 'average_points' => 70.0],
                    ['option_id' => $o[1], 'points' => 65, 'percentage' => 21.67, 'average_points' => 21.67],
                    ['option_id' => $o[2], 'points' => 25, 'percentage' => 8.33, 'average_points' => 8.33],
                ],
            ]),
        ],
        'rating' => [
            'config' => ['scale' => 5],
            'labels' => ['Venue', 'Food', 'Talks'],
            'answers' => fn (array $o) => [
                [0, ['ratings' => [['option_id' => $o[0], 'value' => 5], ['option_id' => $o[1], 'value' => 3]]]],
                [1, ['ratings' => [['option_id' => $o[0], 'value' => 4]]]],
                [2, ['ratings' => [['option_id' => $o[0], 'value' => 3], ['option_id' => $o[2], 'value' => 1]]]],
            ],
            'invalid' => fn (array $o) => [['ratings' => [['option_id' => $o[0], 'value' => 0]]], 'answer_payload.ratings.0.value'],
            'check' => fn (array $agg, array $o) => expect($agg)->toEqual([
                'total_responses' => 3,
                'scale' => 5,
                'items' => [
                    ['option_id' => $o[0], 'count' => 3, 'mean' => 4.0, 'distribution' => e2eDistribution([0, 0, 1, 1, 1])],
                    ['option_id' => $o[1], 'count' => 1, 'mean' => 3.0, 'distribution' => e2eDistribution([0, 0, 1, 0, 0])],
                    ['option_id' => $o[2], 'count' => 1, 'mean' => 1.0, 'distribution' => e2eDistribution([1, 0, 0, 0, 0])],
                ],
            ]),
        ],
        'matrix_2x2' => [
            'config' => ['x_axis' => ['low' => 'Cheap', 'high' => 'Costly'], 'y_axis' => ['low' => 'Slow', 'high' => 'Fast']],
            'labels' => [],
            'answers' => fn () => [[0, ['x' => 10, 'y' => 90]], [1, ['x' => 20, 'y' => 80]], [2, ['x' => 90, 'y' => 10]]],
            // §3.7: a coordinate outside [0, 100] is refused.
            'invalid' => fn () => [['x' => 101, 'y' => 50], 'answer_payload.x'],
            'check' => function (array $agg) {
                expect($agg['total_responses'])->toBe(3)
                    ->and($agg['total_points'])->toBe(3)
                    ->and($agg['points'])->toEqual([['x' => 10, 'y' => 90], ['x' => 20, 'y' => 80], ['x' => 90, 'y' => 10]])
                    ->and($agg['centroid'])->toEqual(['x' => 40, 'y' => 60])
                    ->and($agg['density']['size'])->toBe(20)
                    ->and($agg['density']['counts'][18][2])->toBe(1)
                    ->and($agg['density']['counts'][16][4])->toBe(1)
                    ->and($agg['density']['counts'][2][18])->toBe(1)
                    ->and(array_sum(array_map('array_sum', $agg['density']['counts'])))->toBe(3);
            },
        ],
        'pin_on_image' => [
            'config' => ['max_pins_per_participant' => 1],
            'labels' => [],
            // Participant 1 re-submits the same pin: still one pin (replace, duplicates dropped).
            'answers' => fn () => [
                [0, ['x' => 25, 'y' => 25]],
                [1, ['pins' => [['x' => 60, 'y' => 40]]]],
                [1, ['pins' => [['x' => 25, 'y' => 25]]]],
                [2, ['x' => 75.5, 'y' => 50]],
            ],
            // §3.7: a pin outside the image is refused.
            'invalid' => fn () => [['x' => 50, 'y' => 100.5], 'answer_payload.pins.0.y'],
            'check' => function (array $agg) {
                expect($agg['total_responses'])->toBe(3)
                    ->and($agg['total_pins'])->toBe(3)
                    ->and($agg['pins'])->toEqual([['x' => 25, 'y' => 25], ['x' => 25, 'y' => 25], ['x' => 75.5, 'y' => 50]])
                    ->and($agg['density']['counts'][5][5])->toBe(2)
                    ->and($agg['density']['counts'][10][15])->toBe(1);
            },
        ],
    };
}

/** @param list<int> $counts counts for values 1..N */
function e2eDistribution(array $counts): array
{
    return array_map(fn (int $count, int $i) => ['value' => $i + 1, 'count' => $count], $counts, array_keys($counts));
}

/**
 * Authors a deck through the API: qr_code (seeded) + one slide of $type,
 * labelled, configured, and (pin_on_image) with a real PNG from My Files.
 *
 * @return array{deck: int, slide: int}
 */
function e2eAuthorSingle(User $host, string $type, bool $showResults): array
{
    $scenario = e2eScenario($type);
    $deckId = e2eCreateDeck($host, "E2E {$type}");

    $slide = test()->postJson(E2E_AUTHOR . "/{$deckId}/slides", ['type' => $type])
        ->assertCreated()
        ->assertJsonPath('data.slide.type', $type)
        ->assertJsonPath('data.slide.position', 2)
        ->assertJsonPath('data.slide.acceptsAnswers', true)
        ->json('data.slide');
    $slideId = (int) $slide['id'];

    // Labels: edit the seeded options, add any missing ones.
    $options = $slide['options'];
    foreach ($scenario['labels'] as $i => $label) {
        if (isset($options[$i])) {
            test()->patchJson(E2E_AUTHOR . "/{$deckId}/slides/{$slideId}/options/{$options[$i]['id']}", ['label' => $label])
                ->assertOk()
                ->assertJsonPath('data.option.label', $label);
        } else {
            test()->postJson(E2E_AUTHOR . "/{$deckId}/slides/{$slideId}/options", ['label' => $label])
                ->assertCreated()
                ->assertJsonPath('data.option.label', $label)
                ->assertJsonPath('data.option.position', $i + 1);
        }
    }

    $config = $scenario['config'] + ['show_results_to_participants' => $showResults];
    $updated = test()->patchJson(E2E_AUTHOR . "/{$deckId}/slides/{$slideId}", ['title' => "Question: {$type}", 'config' => $config])
        ->assertOk()
        ->assertJsonPath('data.slide.title', "Question: {$type}")
        ->assertJsonPath('data.slide.config.show_results_to_participants', $showResults)
        ->json('data.slide');
    expect(array_column($updated['options'], 'label'))->toBe($scenario['labels']);

    if ($type === 'pin_on_image') {
        e2eAttachImage($host, $deckId, $slideId);
    }

    test()->getJson(E2E_AUTHOR . "/{$deckId}")->assertOk()
        ->assertJsonPath('data.deck.slideCount', 2)
        ->assertJsonPath('data.deck.slides.1.id', $slideId);

    return ['deck' => $deckId, 'slide' => $slideId];
}

/** POST /quests/{deck}/sessions. Returns the host state body (data). */
function e2eStart(User $host, int $deckId): array
{
    e2eAsHost($host);

    return test()->postJson(E2E_AUTHOR . "/{$deckId}/sessions")
        ->assertCreated()
        ->assertJsonPath('data.session.status', 'live')
        ->assertJsonPath('data.session.product', 'quest')
        ->json('data');
}

/**
 * Three participants find the session by its code (typed in lower case with a
 * dash, like people do) and join with an emoji.
 *
 * @return list<array{id: int, token: string, emoji: string, name: string}>
 */
function e2eJoinThree(array $host): array
{
    e2eAsGuest();
    $code = $host['join_code'];
    $sessionId = $host['session_id'];

    test()->getJson(E2E_SESSIONS . '/by-code/' . strtolower(substr($code, 0, 3) . '-' . substr($code, 3)))
        ->assertOk()
        ->assertJsonPath('data.session_id', $sessionId)
        ->assertJsonPath('data.status', 'live')
        ->assertJsonPath('data.public_channel_key', $host['public_channel_key']);

    $emoji = array_slice(config('deck.emoji_avatars'), 0, 3);
    $people = [];
    foreach (['Ada', 'Grace', 'Linus'] as $i => $name) {
        $joined = test()->postJson(E2E_SESSIONS . "/{$sessionId}/participants/join", [
            'join_code' => $code,
            'display_name' => $name,
            'emoji_avatar' => $emoji[$i],
        ])->assertCreated()
            ->assertJsonPath('data.session_id', $sessionId)
            ->assertJsonPath('data.public_channel_key', $host['public_channel_key'])
            ->assertJsonPath('data.emoji_avatar', $emoji[$i])
            ->json('data');

        expect($joined['participant_token'])->toHaveLength(64);
        $people[] = ['id' => $joined['participant_id'], 'token' => $joined['participant_token'], 'emoji' => $emoji[$i], 'name' => $name];
    }

    return $people;
}

function e2eAdvance(User $host, int $sessionId, array $body): TestResponse
{
    e2eAsHost($host);

    return test()->postJson(E2E_SESSIONS . "/{$sessionId}/advance", $body);
}

function e2eParticipantState(int $sessionId, string $token): TestResponse
{
    e2eAsGuest();

    return test()->getJson(E2E_SESSIONS . "/{$sessionId}/state", e2eHeaders($token));
}

function e2eSubmit(int $sessionId, int $runId, string $token, array $payload): TestResponse
{
    e2eAsGuest();

    return test()->postJson(E2E_SESSIONS . "/{$sessionId}/slide-runs/{$runId}/answers", ['answer_payload' => $payload], e2eHeaders($token));
}

function e2eHostAggregate(User $host, int $sessionId, int $runId): TestResponse
{
    e2eAsHost($host);

    return test()->getJson(E2E_SESSIONS . "/{$sessionId}/slide-runs/{$runId}/aggregate");
}

function e2eParticipantAggregate(int $sessionId, int $runId, string $token): TestResponse
{
    e2eAsGuest();

    return test()->getJson(E2E_SESSIONS . "/{$sessionId}/slide-runs/{$runId}/aggregate", e2eHeaders($token));
}

/** @return Collection<int, LiveBroadcastEvent> */
function e2eEvents(string $name): Collection
{
    return Event::dispatched(LiveBroadcastEvent::class)
        ->map(fn ($call) => $call[0])
        ->filter(fn (LiveBroadcastEvent $event) => $event->broadcastAs() === $name)
        ->values();
}

// --- tests ------------------------------------------------------------------------------

it('covers every answer-taking Quest type the registry knows', function () {
    $answerTypes = collect(app(SlideTypeRegistry::class)->forProduct('quest'))
        ->filter(fn ($type) => $type->acceptsAnswers())
        ->map(fn ($type) => $type->key())
        ->sort()->values()->all();

    expect($answerTypes)->toBe(collect(E2E_ANSWER_TYPES)->sort()->values()->all());
});

it('registers every plan §2.1 and §3.1 endpoint, plus bulk, media, cover, review and emoji meta', function () {
    $routes = app('router')->getRoutes();
    $missing = [];
    foreach ([
        ['POST', 'api/v1/quests'], ['GET', 'api/v1/quests'], ['GET', 'api/v1/quests/1'],
        ['PATCH', 'api/v1/quests/1'], ['DELETE', 'api/v1/quests/1'], ['POST', 'api/v1/quests/1/duplicate'],
        ['POST', 'api/v1/quests/1/slides'], ['GET', 'api/v1/quests/1/slides/2'], ['PATCH', 'api/v1/quests/1/slides/2'],
        ['DELETE', 'api/v1/quests/1/slides/2'], ['POST', 'api/v1/quests/1/slides/2/duplicate'],
        ['POST', 'api/v1/quests/1/slides/reorder'], ['POST', 'api/v1/quests/1/slides/bulk'],
        ['POST', 'api/v1/quests/1/slides/2/options'], ['POST', 'api/v1/quests/1/slides/2/options/reorder'], ['PATCH', 'api/v1/quests/1/slides/2/options/3'],
        ['DELETE', 'api/v1/quests/1/slides/2/options/3'], ['PUT', 'api/v1/quests/1/slides/2/options/3/image'],
        ['PUT', 'api/v1/quests/1/slides/2/media'], ['PUT', 'api/v1/quests/1/cover'],
        ['POST', 'api/v1/quests/1/sessions'], ['GET', 'api/v1/quest-sessions/by-code/ABC234'],
        ['GET', 'api/v1/quest-sessions/1/state'], ['GET', 'api/v1/quest-sessions/1/participant-state'],
        ['POST', 'api/v1/quest-sessions/1/advance'], ['POST', 'api/v1/quest-sessions/1/end'],
        ['POST', 'api/v1/quest-sessions/1/participants/join'], ['POST', 'api/v1/quest-sessions/1/slide-runs/2/answers'],
        ['POST', 'api/v1/quest-sessions/1/slide-runs/2/qa/questions'], ['GET', 'api/v1/quest-sessions/1/slide-runs/2/qa/questions'],
        ['POST', 'api/v1/quest-sessions/1/qa/questions/3/upvote'], ['DELETE', 'api/v1/quest-sessions/1/qa/questions/3/upvote'],
        ['PATCH', 'api/v1/quest-sessions/1/qa/questions/3'], ['GET', 'api/v1/quest-sessions/1/slide-runs/2/my-answer'],
        ['GET', 'api/v1/quest-sessions/1/slide-runs/2/aggregate'], ['GET', 'api/v1/quest-sessions/1/review'],
        ['GET', 'api/v1/meta/emoji-avatars'],
    ] as [$method, $uri]) {
        try {
            $routes->match(Illuminate\Http\Request::create('/' . $uri, $method));
        } catch (Symfony\Component\HttpKernel\Exception\HttpException) {
            $missing[] = "{$method} {$uri}";
        }
    }

    expect($missing)->toBe([])
        ->and(route('deck.quest.sessions.review', ['session' => 5], false))->toBe('/api/v1/quest-sessions/5/review');
});

it('runs a full live round through the HTTP API', function (string $type, bool $public) {
    $scenario = e2eScenario($type);
    $host = DeckFactory::newOwner();

    // 1. Author.
    ['deck' => $deckId, 'slide' => $slideId] = e2eAuthorSingle($host, $type, $public);

    // 2. Start: the qr_code run is current and waiting; the question run snapshots the slide.
    $state = e2eStart($host, $deckId);
    $sessionId = $state['session_id'];
    expect($state['join_code'])->toMatch('/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/')
        ->and($state['join']['join_url'])->toBe('https://play.example.test/play/' . $state['join_code'])
        ->and($state['session']['total_slides'])->toBe(2)
        ->and(array_column($state['runs'], 'type'))->toBe(['qr_code', $type])
        ->and($state['current_run']['type'])->toBe('qr_code')
        ->and($state['participant_count'])->toBe(0);
    $runId = $state['runs'][1]['id'];
    expect($state['runs'][1]['slide_id'])->toBe($slideId)
        ->and($state['runs'][1]['state'])->toBe('waiting')
        ->and($state['runs'][1]['title'])->toBe("Question: {$type}");
    if ($type === 'pin_on_image') {
        expect($state['runs'][1]['config']['media'])->toMatchArray(['width' => 64, 'height' => 48, 'mime' => 'image/png']);
    }

    // 3. Three participants join with emoji.
    $people = e2eJoinThree($state);
    expect(e2eEvents('participant.joined'))->toHaveCount(3);

    // 4. Host moves to the question and opens voting.
    e2eAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk()
        ->assertJsonPath('data.participant_count', 3)
        ->assertJsonPath('data.current_run.id', $runId)
        ->assertJsonPath('data.current_run.state', 'waiting');
    // Not voting yet: answers are refused.
    e2eSubmit($sessionId, $runId, $people[0]['token'], ($scenario['answers'])([1, 2, 3, 4])[0][1])
        ->assertStatus(409)->assertJsonPath('data.reason', 'not_voting');

    e2eAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk()
        ->assertJsonPath('data.current_run.state', 'voting')
        ->assertJsonPath('data.current_run.state_version', 1)
        ->assertJsonPath('data.results_visibility', $public ? 'public' : 'host');

    // 5. Participants read the slide from their state (option ids included, no aggregate inside).
    $view = e2eParticipantState($sessionId, $people[0]['token'])->assertOk()
        ->assertJsonPath('data.current_run.id', $runId)
        ->assertJsonPath('data.current_slide_run.id', $runId)
        ->assertJsonPath('data.current_run.state', 'voting')
        ->assertJsonPath('data.has_answered', false)
        ->assertJsonPath('data.participant.emoji_avatar', $people[0]['emoji'])
        ->json('data');
    expect($view['current_run'])->not->toHaveKey('aggregate');
    $optionIds = array_column($view['current_run']['options'], 'id');
    expect(array_column($view['current_run']['options'], 'label'))->toBe($scenario['labels']);

    // An invalid answer is a 422 keyed under answer_payload and stores nothing.
    [$badPayload, $badKey] = ($scenario['invalid'])($optionIds);
    e2eSubmit($sessionId, $runId, $people[0]['token'], $badPayload)
        ->assertStatus(422)
        ->assertJsonValidationErrors([$badKey], 'data.validation_errors');

    // 6. Everyone answers.
    foreach (($scenario['answers'])($optionIds) as [$who, $payload]) {
        e2eTick();
        e2eSubmit($sessionId, $runId, $people[$who]['token'], $payload)->assertNoContent();
    }
    expect(e2eEvents('answer.submitted')->every(fn ($event) => str_starts_with($event->broadcastOn()->name, 'private-host.quest.')))->toBeTrue();

    // 7. The host's live aggregate is right.
    $live = e2eHostAggregate($host, $sessionId, $runId)->assertOk()
        ->assertJsonPath('data.slide_run_id', $runId)
        ->assertJsonPath('data.type', $type)
        ->assertJsonPath('data.state', 'voting')
        ->assertJsonPath('data.final', false)
        ->assertJsonPath('data.visibility', $public ? 'public' : 'host')
        ->assertJsonPath('data.total_responses', 3)
        ->json('data');
    ($scenario['check'])($live['aggregate'], $optionIds, array_column($people, 'emoji'));

    // The host state carries the same live aggregate on the presenter view of the current run.
    e2eAsHost($host);
    expect(test()->getJson(E2E_SESSIONS . "/{$sessionId}/state")->assertOk()->json('data.current_run.aggregate'))->toEqual($live['aggregate']);

    // Participants only see it when the slide shows results to them.
    $during = e2eParticipantAggregate($sessionId, $runId, $people[1]['token']);
    $public
        ? $during->assertOk()->assertJsonPath('data.visibility', 'public')
        : $during->assertForbidden()->assertJsonPath('data.code', 'results_hidden');

    // 8. Close voting: later answers are refused and the aggregate is frozen.
    e2eAdvance($host, $sessionId, ['action' => 'close_voting'])->assertOk()
        ->assertJsonPath('data.current_run.state', 'closed');
    expect(e2eEvents('slide.closed'))->toHaveCount(1);
    e2eTick();
    e2eSubmit($sessionId, $runId, $people[2]['token'], ($scenario['answers'])($optionIds)[0][1])
        ->assertStatus(409)
        ->assertJsonPath('data.code', 'invalid_state')
        ->assertJsonPath('data.reason', 'not_voting')
        ->assertJsonPath('data.state', 'closed');

    $final = e2eHostAggregate($host, $sessionId, $runId)->assertOk()
        ->assertJsonPath('data.state', 'closed')
        ->assertJsonPath('data.final', true)
        ->json('data');
    expect($final['aggregate'])->toEqual($live['aggregate'])
        ->and($final['closed_at'])->not->toBeNull();

    // 9. A participant reconnects: state says closed, remembers their answer, and shows the result per visibility.
    $reconnect = e2eParticipantState($sessionId, $people[1]['token'])->assertOk()
        ->assertJsonPath('data.current_run.id', $runId)
        ->assertJsonPath('data.current_run.state', 'closed')
        ->assertJsonPath('data.has_answered', true)
        ->assertJsonPath('data.my_submission_for_current_slide.slide_run_id', $runId)
        ->assertJsonPath('data.results_visibility', $public ? 'public' : 'host')
        ->json('data');
    expect($reconnect['aggregate'])->toEqual($public ? $final['aggregate'] : null);

    e2eAsGuest();
    test()->getJson(E2E_SESSIONS . "/{$sessionId}/slide-runs/{$runId}/my-answer", e2eHeaders($people[1]['token']))
        ->assertOk()
        ->assertJsonPath('data.slide_run_id', $runId);

    $after = e2eParticipantAggregate($sessionId, $runId, $people[1]['token']);
    if ($public) {
        expect($after->assertOk()->assertJsonPath('data.final', true)->json('data.aggregate'))->toEqual($final['aggregate']);
    } else {
        $after->assertForbidden()->assertJsonPath('data.code', 'results_hidden');
    }

    // The review only opens once the session has ended.
    e2eAsGuest();
    test()->getJson(E2E_SESSIONS . "/{$sessionId}/review", e2eHeaders($people[1]['token']))
        ->assertStatus(409)
        ->assertJsonPath('data.reason', 'session_not_ended');

    // 10. End: tokens are revoked for writes and live state; the review reads keep working.
    e2eAsHost($host);
    test()->postJson(E2E_SESSIONS . "/{$sessionId}/end")->assertOk()
        ->assertJsonPath('data.session.status', 'ended');
    expect(e2eEvents('session.ended'))->toHaveCount(1);

    e2eSubmit($sessionId, $runId, $people[0]['token'], ($scenario['answers'])($optionIds)[0][1])
        ->assertUnauthorized()->assertJsonPath('data.code', 'unauthorized');
    e2eParticipantState($sessionId, $people[0]['token'])->assertUnauthorized();
    e2eAsGuest();
    test()->getJson(E2E_SESSIONS . "/{$sessionId}/slide-runs/{$runId}/my-answer", e2eHeaders($people[0]['token']))->assertOk();
    $review = e2eParticipantAggregate($sessionId, $runId, $people[0]['token']);
    $public ? $review->assertOk() : $review->assertForbidden();

    // Review screen (§7.5): every run, the participant's own answer and the result when it is public.
    e2eAsGuest();
    $screen = test()->getJson(E2E_SESSIONS . "/{$sessionId}/review", e2eHeaders($people[2]['token']))->assertOk()
        ->assertJsonPath('data.session.status', 'ended')
        ->assertJsonPath('data.participant.id', $people[2]['id'])
        ->json('data');
    expect(array_column($screen['runs'], 'type'))->toBe(['qr_code', $type])
        ->and($screen['runs'][0]['my_answer'])->toBeNull()
        ->and($screen['runs'][1]['my_answer']['slide_run_id'])->toBe($runId)
        ->and($screen['runs'][1]['state'])->toBe('closed')
        ->and($screen['runs'][1]['results_visibility'])->toBe($public ? 'public' : 'host')
        ->and($screen['runs'][1]['aggregate'])->toEqual($public ? $final['aggregate'] : null)
        ->and($screen['runs'][1])->not->toHaveKey('options_snapshot');
    test()->getJson(E2E_SESSIONS . "/{$sessionId}/review", e2eHeaders('not-a-real-token'))->assertUnauthorized();

    // The code no longer finds the session; joining it again is refused.
    test()->getJson(E2E_SESSIONS . '/by-code/' . $state['join_code'])->assertNotFound();
    test()->postJson(E2E_SESSIONS . "/{$sessionId}/participants/join", [
        'join_code' => $state['join_code'], 'display_name' => 'Late', 'emoji_avatar' => $people[0]['emoji'],
    ])->assertForbidden()->assertJsonPath('data.session_status', 'ended');
})->with(E2E_ANSWER_TYPES)->with(['results public' => true, 'results hidden' => false]);

it('runs the audience Q&A: questions, cross-upvotes, moderation, feed order and close', function () {
    $host = DeckFactory::newOwner();
    $deckId = e2eCreateDeck($host, 'E2E Q&A');
    $slide = test()->postJson(E2E_AUTHOR . "/{$deckId}/slides", ['type' => 'qa_audience'])
        ->assertCreated()
        ->assertJsonPath('data.slide.acceptsAnswers', false)
        ->assertJsonPath('data.slide.revealModel', 'moderated_feed')
        ->json('data.slide');
    test()->patchJson(E2E_AUTHOR . "/{$deckId}/slides/{$slide['id']}", ['title' => 'Ask me anything', 'config' => ['sort' => 'top', 'max_question_length' => 120]])
        ->assertOk()
        ->assertJsonPath('data.slide.config.max_question_length', 120);

    $state = e2eStart($host, $deckId);
    $sessionId = $state['session_id'];
    $runId = $state['runs'][1]['id'];
    $people = e2eJoinThree($state);

    $ask = function (int $who, string $body) use ($sessionId, $runId, $people) {
        e2eAsGuest();
        e2eTick();

        return test()->postJson(E2E_SESSIONS . "/{$sessionId}/slide-runs/{$runId}/qa/questions", ['body' => $body], e2eHeaders($people[$who]['token']));
    };
    $vote = function (int $who, int $questionId, string $method = 'postJson') use ($sessionId, $people) {
        e2eAsGuest();

        return test()->{$method}(E2E_SESSIONS . "/{$sessionId}/qa/questions/{$questionId}/upvote", [], e2eHeaders($people[$who]['token']));
    };
    $feed = function (?int $who, array $query = []) use ($sessionId, $runId, $people, $host) {
        $url = E2E_SESSIONS . "/{$sessionId}/slide-runs/{$runId}/qa/questions" . ($query ? '?' . http_build_query($query) : '');
        if ($who === null) {
            e2eAsHost($host);

            return test()->getJson($url);
        }
        e2eAsGuest();

        return test()->getJson($url, e2eHeaders($people[$who]['token']));
    };
    $moderate = function (int $questionId, array $flags) use ($sessionId, $host) {
        e2eAsHost($host);

        return test()->patchJson(E2E_SESSIONS . "/{$sessionId}/qa/questions/{$questionId}", $flags);
    };

    // Not open yet: questions are refused.
    e2eAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk()->assertJsonPath('data.current_run.state', 'waiting');
    $ask(0, 'Too early?')->assertStatus(409)->assertJsonPath('data.reason', 'not_open');

    // start_voting opens a Q&A slide (no get_ready, no timer).
    e2eAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk()
        ->assertJsonPath('data.current_run.state', 'open')
        ->assertJsonPath('data.seconds_remaining', null);

    // Q&A slides take questions, not answers.
    e2eSubmit($sessionId, $runId, $people[0]['token'], ['text' => 'hi'])->assertStatus(409)->assertJsonPath('data.reason', 'no_answers');

    $q1 = $ask(0, 'How do we ship faster?')->assertCreated()
        ->assertJsonPath('data.question.is_mine', true)
        ->assertJsonPath('data.question.participant_emoji', $people[0]['emoji'])
        ->assertJsonPath('data.question.upvote_count', 0)
        ->json('data.question.question_id');
    $q2 = $ask(1, 'What is the roadmap?')->assertCreated()->json('data.question.question_id');
    $q3 = $ask(2, 'Can we get pizza?')->assertCreated()->json('data.question.question_id');
    $ask(0, str_repeat('x', 121))->assertStatus(422)->assertJsonValidationErrors(['body'], 'data.validation_errors');

    // Cross-upvotes: q3 ×3 (own included), q1 ×2, q2 ×1. A repeat upvote changes nothing.
    foreach ([[0, $q3], [1, $q3], [2, $q3], [1, $q1], [2, $q1], [0, $q2]] as [$who, $question]) {
        $vote($who, $question)->assertOk()->assertJsonPath('data.has_upvoted', true);
    }
    $vote(1, $q1)->assertOk()->assertJsonPath('data.upvote_count', 2);
    // Upvote and take it back.
    $vote(2, $q2)->assertOk()->assertJsonPath('data.upvote_count', 2);
    $vote(2, $q2, 'deleteJson')->assertOk()->assertJsonPath('data.upvote_count', 1)->assertJsonPath('data.has_upvoted', false);

    expect(array_column($feed(0)->assertOk()->json('data.questions'), 'question_id'))->toBe([$q3, $q1, $q2]);
    expect(array_column($feed(0)->json('data.questions'), 'upvote_count'))->toBe([3, 2, 1]);

    // Host hides q3 and stars q2 (plan action names), marks q1 answered.
    $moderate($q3, ['hide' => true])->assertOk()->assertJsonPath('data.question.is_hidden', true);
    $moderate($q2, ['star' => true])->assertOk()->assertJsonPath('data.question.is_starred', true);
    $moderate($q1, ['is_answered' => true])->assertOk()->assertJsonPath('data.question.is_answered', true);
    $moderate($q1, [])->assertStatus(422)->assertJsonValidationErrors(['flags'], 'data.validation_errors');

    // Participants: hidden question gone (also for its author), top order.
    $participantFeed = $feed(2)->assertOk()
        ->assertJsonPath('data.viewer', 'participant')
        ->assertJsonPath('data.sort', 'top')
        ->assertJsonPath('data.total', 2)
        ->json('data.questions');
    expect(array_column($participantFeed, 'question_id'))->toBe([$q1, $q2])
        ->and($participantFeed[0])->not->toHaveKey('participant_id')
        ->and($participantFeed[0]['is_answered'])->toBeTrue()
        ->and($participantFeed[0]['has_upvoted'])->toBeTrue();
    expect(array_column($feed(0, ['sort' => 'newest'])->json('data.questions'), 'question_id'))->toBe([$q2, $q1]);
    $vote(0, $q3)->assertNotFound();

    // Host: hidden included, starred first, then by upvotes.
    $hostFeed = $feed(null)->assertOk()
        ->assertJsonPath('data.viewer', 'host')
        ->assertJsonPath('data.total', 3)
        ->json('data.questions');
    expect(array_column($hostFeed, 'question_id'))->toBe([$q2, $q3, $q1])
        ->and(array_column($hostFeed, 'is_hidden'))->toBe([false, true, false]);

    // The hidden question goes out redacted on the public channel, in full to the host.
    $moderated = e2eEvents('qa.question.moderated')->filter(fn ($event) => $event->broadcastWith()['question_id'] === $q3);
    expect($moderated->map(fn ($event) => $event->broadcastOn()->name)->sort()->values()->all())
        ->toBe(['private-host.quest.' . $sessionId, 'session.quest.' . $state['public_channel_key']]);

    // Close: no new questions or upvotes, the feed is still readable for a reconnecting client.
    e2eAdvance($host, $sessionId, ['action' => 'close_voting'])->assertOk()->assertJsonPath('data.current_run.state', 'closed');
    $ask(1, 'One more?')->assertStatus(409)->assertJsonPath('data.reason', 'not_open');
    $vote(0, $q1)->assertStatus(409);
    e2eParticipantState($sessionId, $people[1]['token'])->assertOk()->assertJsonPath('data.current_run.state', 'closed');
    expect(array_column($feed(1)->assertOk()->json('data.questions'), 'question_id'))->toBe([$q1, $q2]);

    // End: participant tokens stop working for writes; the feed stays readable for the review screen.
    e2eAsHost($host);
    test()->postJson(E2E_SESSIONS . "/{$sessionId}/end")->assertOk();
    $ask(0, 'After the end?')->assertUnauthorized();
    $vote(0, $q2)->assertUnauthorized();
    e2eParticipantState($sessionId, $people[0]['token'])->assertUnauthorized();
    expect(array_column($feed(0)->assertOk()->json('data.questions'), 'question_id'))->toBe([$q1, $q2]);
    $feed(null)->assertOk()->assertJsonPath('data.total', 3);
    e2eAsGuest();
    test()->getJson(E2E_SESSIONS . "/{$sessionId}/review", e2eHeaders($people[0]['token']))->assertOk()
        ->assertJsonPath('data.runs.1.id', $runId)
        ->assertJsonPath('data.runs.1.type', 'qa_audience')
        ->assertJsonPath('data.runs.1.aggregate', null);
});

it('walks one session through a deck holding every Quest type, content slides included', function () {
    $host = DeckFactory::newOwner();
    $deckId = e2eCreateDeck($host, 'E2E whole deck');

    $registry = app(SlideTypeRegistry::class);
    $questTypes = collect($registry->forProduct('quest'))->map(fn ($type) => $type->key())->reject(fn ($key) => $key === 'qr_code')->values()->all();
    $slides = array_map(fn (string $key) => ['type' => $key, 'title' => "Slide {$key}"], $questTypes);

    $created = test()->postJson(E2E_AUTHOR . "/{$deckId}/slides/bulk", ['slides' => $slides])
        ->assertCreated()
        ->json('data.slides');
    expect(array_column($created, 'type'))->toBe($questTypes);
    $pinSlide = collect($created)->firstWhere('type', 'pin_on_image');
    e2eAttachImage($host, $deckId, $pinSlide['id']);
    $imageSlide = collect($created)->firstWhere('type', 'image');
    e2eAttachImage($host, $deckId, $imageSlide['id']);

    // Duplicating the deck copies every slide (file refs included) and leaves the original alone.
    e2eAsHost($host);
    test()->postJson(E2E_AUTHOR . "/{$deckId}/duplicate")->assertCreated()
        ->assertJsonPath('data.deck.slideCount', count($questTypes) + 1);

    $state = e2eStart($host, $deckId);
    $sessionId = $state['session_id'];
    expect(array_column($state['runs'], 'type'))->toBe(['qr_code', ...$questTypes])
        ->and(array_column($state['runs'], 'position'))->toBe(range(1, count($questTypes) + 1));
    [$alice] = e2eJoinThree($state);

    $runs = $state['runs'];
    $reached = [];
    foreach (array_slice($runs, 1) as $run) {
        $moved = e2eAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk()->json('data.current_run');
        expect($moved['id'])->toBe($run['id']);
        $reached[] = $run['type'];
        $type = $registry->for($run['type']);

        if (! $type->acceptsAnswers() && $type->revealModel() !== 'moderated_feed') {
            // Content slides only navigate.
            e2eAdvance($host, $sessionId, ['action' => 'start_voting'])->assertStatus(409)->assertJsonPath('data.code', 'invalid_state');
            e2eSubmit($sessionId, $run['id'], $alice['token'], ['x' => 1])->assertStatus(409)->assertJsonPath('data.reason', 'no_answers');

            continue;
        }

        e2eAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk()
            ->assertJsonPath('data.current_run.state', $type->acceptsAnswers() ? 'voting' : 'open');
    }
    expect($reached)->toBe($questTypes);

    // Moving on closed every interactive run behind the host; close the last one by hand.
    $interactive = fn (string $key) => $registry->for($key)->acceptsAnswers() || $registry->for($key)->revealModel() === 'moderated_feed';
    if ($interactive(end($questTypes))) {
        e2eAdvance($host, $sessionId, ['action' => 'close_voting'])->assertOk()->assertJsonPath('data.current_run.state', 'closed');
    }
    e2eAsHost($host);
    $states = collect(test()->getJson(E2E_SESSIONS . "/{$sessionId}/state")->assertOk()->json('data.runs'))->pluck('state', 'type')->all();
    expect($states)->toBe(['qr_code' => 'waiting'] + collect($questTypes)->mapWithKeys(fn ($key) => [$key => $interactive($key) ? 'closed' : 'waiting'])->all());

    // jump_to goes anywhere; there is nothing before the first slide.
    e2eAdvance($host, $sessionId, ['action' => 'jump_to', 'target_run_id' => $runs[0]['id']])->assertOk()
        ->assertJsonPath('data.current_run.id', $runs[0]['id']);
    e2eAdvance($host, $sessionId, ['action' => 'previous_slide'])->assertStatus(409);

    test()->postJson(E2E_SESSIONS . "/{$sessionId}/end")->assertOk();
    e2eParticipantState($sessionId, $alice['token'])->assertUnauthorized();
    e2eAdvance($host, $sessionId, ['action' => 'next_slide'])->assertStatus(409)->assertJsonPath('data.code', 'invalid_state');
});

it('runs a timed slide from the author\'s timers to the server-side close', function () {
    $host = DeckFactory::newOwner();
    $deckId = e2eCreateDeck($host, 'E2E timed');
    $slide = test()->postJson(E2E_AUTHOR . "/{$deckId}/slides", ['type' => 'poll_single'])->assertCreated()->json('data.slide');
    test()->patchJson(E2E_AUTHOR . "/{$deckId}/slides/{$slide['id']}", ['time_limit_seconds' => 10, 'get_ready_seconds' => 3])
        ->assertOk()
        ->assertJsonPath('data.slide.timeLimitSeconds', 10)
        ->assertJsonPath('data.slide.getReadySeconds', 3);

    $state = e2eStart($host, $deckId);
    $sessionId = $state['session_id'];
    $runId = $state['runs'][1]['id'];
    expect($state['runs'][1]['time_limit_seconds'])->toBe(10)->and($state['runs'][1]['get_ready_seconds'])->toBe(3);
    [$alice, $bob] = e2eJoinThree($state);

    e2eAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk();
    e2eAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk()
        ->assertJsonPath('data.current_run.state', 'get_ready')
        ->assertJsonPath('data.seconds_remaining', 3);
    $optionId = e2eParticipantState($sessionId, $alice['token'])->json('data.current_run.options.0.id');
    e2eSubmit($sessionId, $runId, $alice['token'], ['option_id' => $optionId])->assertStatus(409)->assertJsonPath('data.reason', 'not_voting');

    // The countdown ran out; the next state read applies it even if the queued job is late.
    test()->travel(4)->seconds();
    e2eParticipantState($sessionId, $alice['token'])->assertOk()
        ->assertJsonPath('data.current_run.state', 'voting')
        ->assertJsonPath('data.duration_seconds', 10);
    e2eSubmit($sessionId, $runId, $alice['token'], ['option_id' => $optionId])->assertNoContent();

    // Past the time limit (+ grace) answers are refused, and the host's next read closes the run.
    test()->travel(12)->seconds();
    e2eSubmit($sessionId, $runId, $bob['token'], ['option_id' => $optionId])->assertStatus(409)->assertJsonPath('data.reason', 'time_up');
    e2eAsHost($host);
    test()->getJson(E2E_SESSIONS . "/{$sessionId}/state")->assertOk()
        ->assertJsonPath('data.current_run.state', 'closed')
        ->assertJsonPath('data.current_run.aggregate.total_responses', 1);
    e2eHostAggregate($host, $sessionId, $runId)->assertOk()->assertJsonPath('data.final', true);
    expect(e2eEvents('slide.closed'))->toHaveCount(1);
});
