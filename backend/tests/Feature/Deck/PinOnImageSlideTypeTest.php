<?php

use App\Deck\Broadcasts\Payloads\SlideAggregateUpdatedPayload;
use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quest\PinOnImageSlideType;
use App\Deck\Slides\Types\Quest\PointCloud;
use App\Deck\Slides\TakesMedia;
use App\Deck\Slides\Types\Content\ContentSlideType;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\File;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

uses(DatabaseTransactions::class);

function tiPinType(): PinOnImageSlideType
{
    return app(SlideTypeRegistry::class)->for('pin_on_image');
}

function tiPinMedia(array $overrides = []): array
{
    return array_merge(
        ['file_id' => 42, 'url' => 'https://example.test/storage/library/1/images/map.png', 'width' => 1024, 'height' => 768, 'mime' => 'image/png'],
        $overrides,
    );
}

function tiPinConfig(int $maxPins = 1): array
{
    return ['max_pins_per_participant' => $maxPins, 'media' => tiPinMedia()];
}

/** A My Files row as the library stores it (url resolved by File::url). */
function tiPinFile(array $overrides = []): File
{
    $owner = DeckFactory::newOwner();

    return File::create(array_replace([
        'name' => 'map.png',
        'type' => 'image',
        'category' => File::CATEGORY_IMAGE,
        'visibility' => File::VISIBILITY_PUBLIC,
        'path' => "storage/library/{$owner->id}/images/map.png",
        'mime_type' => 'image/png',
        'extension' => 'png',
        'size' => 10,
        'width' => 1024,
        'height' => 768,
        'user_id' => $owner->id,
    ], $overrides));
}

function tiPinAnswer(array $pins): DeckParticipantAnswer
{
    return new DeckParticipantAnswer(['answer_payload' => ['pins' => $pins]]);
}

/** Density counts of an aggregate, keyed "row:col" for the non-empty cells. */
function tiPinCells(array $aggregate): array
{
    $cells = [];
    foreach ($aggregate['density']['counts'] as $row => $cols) {
        foreach ($cols as $col => $count) {
            if ($count > 0) {
                $cells["{$row}:{$col}"] = $count;
            }
        }
    }

    return $cells;
}

/**
 * Bytes of the Pusher HTTP body Reverb receives for this aggregate as a
 * slide.aggregate.updated event (the event data is a JSON string inside the
 * JSON body), with the largest ids and a long channel key.
 */
function tiPinBroadcastBytes(array $aggregate): int
{
    $event = LiveBroadcastEvent::fromPayload(
        new SlideAggregateUpdatedPayload(2_147_483_647, 2_147_483_647, $aggregate),
        'session.quest.' . str_repeat('k', 64),
        ['module' => 'quest', 'session_id' => 2_147_483_647, 'broadcasted_at' => now()->toISOString()],
    );

    return strlen(json_encode([
        'name' => $event->broadcastAs(),
        'data' => json_encode($event->broadcastWith()),
        'channels' => [$event->broadcastOn()->name],
    ]));
}

it('is discovered by the registry as a live Quest poll that needs an image', function () {
    $registry = app(SlideTypeRegistry::class);

    expect($registry->for('pin_on_image'))->toBeInstanceOf(PinOnImageSlideType::class)
        ->and($registry->forProduct('quest'))->toHaveKey('pin_on_image');

    $type = tiPinType();
    expect($type->category())->toBe(SlideTypeContract::CATEGORY_POLL)
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_LIVE)
        ->and($type->acceptsAnswers())->toBeTrue()
        ->and($type->requiresMedia())->toBeTrue()
        ->and($type->defaultOptions())->toBe([]);
});

it('accepts its own default config without media while authoring', function () {
    $type = tiPinType();
    $defaults = ['max_pins_per_participant' => 1, 'show_results_to_participants' => false];

    expect($type->defaultConfig())->toBe($defaults)
        ->and($type->validateConfig($type->defaultConfig()))->toBe($defaults)
        ->and($type->validateConfig(['media' => null]))->toBe($defaults)
        ->and($type->validateConfig(['media' => []]))->toBe($defaults)
        ->and($type->validateConfig(['max_pins_per_participant' => '3', 'show_results_to_participants' => '1']))
        ->toBe(['max_pins_per_participant' => 3, 'show_results_to_participants' => true])
        ->and($type->hasMedia($type->defaultConfig()))->toBeFalse();
});

it('drops author-sent media: the image only enters config through withMedia', function (mixed $media) {
    // Same rule as the image/video content slides (TakesMedia): a config PUT
    // can never point the slide at an arbitrary URL or someone else's file id.
    $config = tiPinType()->validateConfig(['max_pins_per_participant' => 2, 'media' => $media]);

    expect($config)->toBe(['max_pins_per_participant' => 2, 'show_results_to_participants' => false])
        ->and(tiPinType()->hasMedia($config))->toBeFalse();
})->with([
    'a well-formed snapshot' => [tiPinMedia()],
    'a tracker url' => [tiPinMedia(['url' => 'https://tracker.example/pixel.png'])],
    'a javascript url' => [tiPinMedia(['url' => 'javascript:alert(1)'])],
    'not an object' => ['map.png'],
]);

it('snapshots the attached My Files image through withMedia', function () {
    $type = tiPinType();
    $file = tiPinFile();

    $config = $type->withMedia($type->validateConfig(['max_pins_per_participant' => 3]), $file);

    expect($type)->toBeInstanceOf(TakesMedia::class)
        ->and($config)->toBe([
            'max_pins_per_participant' => 3,
            'show_results_to_participants' => false,
            'media' => ContentSlideType::mediaSnapshot($file),
        ])
        ->and($config['media'])->toMatchArray(['file_id' => $file->id, 'url' => $file->url, 'width' => 1024, 'height' => 768, 'mime' => 'image/png'])
        ->and($type->hasMedia($config))->toBeTrue();
    $type->assertMediaPresent($config);

    // Re-attaching replaces the old block; detaching leaves media null.
    $other = tiPinFile(['name' => 'b.webp', 'mime_type' => 'IMAGE/WEBP', 'extension' => 'webp']);
    expect($type->withMedia($config, $other)['media']['file_id'])->toBe($other->id)
        ->and($type->withMedia($config, $other)['media']['mime'])->toBe('image/webp')
        ->and($type->withMedia($config, null)['media'])->toBeNull()
        ->and($type->hasMedia($type->withMedia($config, null)))->toBeFalse();

    foreach (PinOnImageSlideType::IMAGE_MIMES as $mime) {
        expect($type->withMedia([], tiPinFile(['mime_type' => $mime]))['media']['mime'])->toBe($mime);
    }
});

it('refuses non-image files in withMedia and images of unknown size at session start', function () {
    $type = tiPinType();

    foreach (['video/mp4', 'image/svg+xml', 'application/pdf'] as $mime) {
        try {
            $type->withMedia([], tiPinFile(['mime_type' => $mime]));
            $this->fail("Expected {$mime} to be refused.");
        } catch (ValidationException $e) {
            expect(array_keys($e->errors()))->toBe(['media']);
        }
    }

    // An older library image without recorded dimensions can be attached, but
    // a session cannot start on it until its width/height are known.
    $config = $type->withMedia([], tiPinFile(['width' => null, 'height' => null]));
    try {
        $type->assertMediaPresent($config);
        $this->fail('Expected a ValidationException.');
    } catch (ValidationException $e) {
        expect($e->errors())->toHaveKeys(['media', 'media.width', 'media.height']);
    }
});

it('rejects bad config', function (array $config) {
    expect(fn () => tiPinType()->validateConfig($config))->toThrow(ValidationException::class);
})->with([
    'zero pins' => [['max_pins_per_participant' => 0]],
    'too many pins' => [['max_pins_per_participant' => 11]],
    'pins not int' => [['max_pins_per_participant' => 'many']],
    'show results not a boolean' => [['show_results_to_participants' => 'sometimes']],
]);

it('refuses a media snapshot that is not an attached My Files image at session start', function (array $media, string $errorKey) {
    $type = tiPinType();

    try {
        $type->assertMediaPresent(['media' => $media]);
        $this->fail('Expected a ValidationException.');
    } catch (ValidationException $e) {
        expect($e->errors())->toHaveKeys(['media', $errorKey]);
    }

    expect($type->hasMedia(['media' => $media]))->toBeFalse();
})->with([
    'no file id' => [Arr::except(tiPinMedia(), 'file_id'), 'media.file_id'],
    'null file id' => [tiPinMedia(['file_id' => null]), 'media.file_id'],
    'zero file id' => [tiPinMedia(['file_id' => 0]), 'media.file_id'],
    'negative file id' => [tiPinMedia(['file_id' => -5]), 'media.file_id'],
    'non-numeric file id' => [tiPinMedia(['file_id' => 'abc']), 'media.file_id'],
    'video mime' => [tiPinMedia(['mime' => 'video/mp4']), 'media.mime'],
    'html mime' => [tiPinMedia(['mime' => 'text/html']), 'media.mime'],
    'svg mime' => [tiPinMedia(['mime' => 'image/svg+xml']), 'media.mime'],
    'no mime' => [Arr::except(tiPinMedia(), 'mime'), 'media.mime'],
    'no url' => [Arr::except(tiPinMedia(), 'url'), 'media.url'],
    'empty url' => [tiPinMedia(['url' => '  ']), 'media.url'],
    'javascript url' => [tiPinMedia(['url' => 'javascript:alert(1)']), 'media.url'],
    'css breakout url' => [tiPinMedia(['url' => 'x") ; background:url(http://evil']), 'media.url'],
    'relative url' => [tiPinMedia(['url' => '/storage/library/1/images/map.png']), 'media.url'],
    'url without host' => [tiPinMedia(['url' => 'https:///map.png']), 'media.url'],
    'url with a control character' => [tiPinMedia(['url' => "https://example.test/a\x07.png"]), 'media.url'],
    'url too long' => [tiPinMedia(['url' => 'https://example.test/' . str_repeat('a', 2048)]), 'media.url'],
    'no width' => [Arr::except(tiPinMedia(), 'width'), 'media.width'],
    'zero height' => [tiPinMedia(['height' => 0]), 'media.height'],
    'non-numeric width' => [tiPinMedia(['width' => 'wide']), 'media.width'],
]);

it('asserts media is present when a session snapshots the slide', function () {
    $type = tiPinType();

    try {
        $type->assertMediaPresent(['max_pins_per_participant' => 1]);
        $this->fail('Expected a ValidationException.');
    } catch (ValidationException $e) {
        expect(array_keys($e->errors()))->toBe(['media']);
    }

    expect(fn () => $type->assertMediaPresent(['media' => []]))->toThrow(ValidationException::class)
        ->and(fn () => $type->assertMediaPresent(['media' => 'map.png']))->toThrow(ValidationException::class);

    $type->assertMediaPresent(tiPinConfig());
});

it('accepts pins on the image, the single-pin shorthand, and deduplicates exact repeats', function () {
    $type = tiPinType();

    expect($type->validateAnswer(['x' => 0, 'y' => 100], tiPinConfig(), []))->toBe(['pins' => [['x' => 0.0, 'y' => 100.0]]])
        ->and($type->validateAnswer(['pins' => [['x' => '33.333', 'y' => 66.666]]], tiPinConfig(), []))->toBe(['pins' => [['x' => 33.33, 'y' => 66.67]]])
        ->and($type->validateAnswer(['pins' => [['x' => 10, 'y' => 10], ['x' => 90, 'y' => 90], ['x' => 10.001, 'y' => 10]]], tiPinConfig(3), []))
        ->toBe(['pins' => [['x' => 10.0, 'y' => 10.0], ['x' => 90.0, 'y' => 90.0]]]);
});

it('rejects malformed pins, pins outside the image and too many pins', function (array $payload) {
    expect(fn () => tiPinType()->validateAnswer($payload, tiPinConfig(2), []))->toThrow(ValidationException::class);
})->with([
    'empty payload' => [[]],
    'empty pins' => [['pins' => []]],
    'pins not a list' => [['pins' => ['a' => ['x' => 1, 'y' => 1]]]],
    'left of the image' => [['pins' => [['x' => -1, 'y' => 50]]]],
    'right of the image' => [['pins' => [['x' => 100.5, 'y' => 50]]]],
    'below the image' => [['pins' => [['x' => 50, 'y' => 101]]]],
    'shorthand outside' => [['x' => 50, 'y' => -3]],
    'shorthand missing y' => [['x' => 50]],
    'string coordinate' => [['pins' => [['x' => 'middle', 'y' => 50]]]],
    'pin not an object' => [['pins' => [50]]],
    'more than max pins' => [['pins' => [['x' => 1, 'y' => 1], ['x' => 2, 'y' => 2], ['x' => 3, 'y' => 3]]]],
]);

it('rejects an oversized pin list up front, before the per-pin rules run', function () {
    // Through the wildcard rules 10,000 pins took ~9s; the length check is O(1).
    $payload = ['pins' => array_fill(0, 20_000, ['x' => 1, 'y' => 1])];

    $started = microtime(true);
    try {
        tiPinType()->validateAnswer($payload, tiPinConfig(1), []);
        $this->fail('Expected a ValidationException.');
    } catch (ValidationException $e) {
        expect($e->errors())->toBe(['pins' => ['The pins field must not have more than 1 items.']]);
    }

    expect(microtime(true) - $started)->toBeLessThan(1.0);
});

it('scores zero', function () {
    expect(tiPinType()->score(['pins' => [['x' => 1, 'y' => 1]]], tiPinConfig(), [], 100))->toEqual(ScoreResult::zero());
});

it('aggregates raw pins in answer order with a density grid of every pin', function () {
    $answers = collect([
        tiPinAnswer([['x' => 10, 'y' => 20]]),
        tiPinAnswer([['x' => 30.5, 'y' => 40], ['x' => 50, 'y' => 60]]),
        tiPinAnswer([['x' => 'bad'], ['x' => 101, 'y' => 5], 'junk']),
        tiPinAnswer([['x' => 100, 'y' => 100], ['x' => 0, 'y' => 0]]),
    ]);

    $aggregate = tiPinType()->aggregate(tiPinConfig(2), [], $answers);

    expect(array_keys($aggregate))->toBe(['total_responses', 'total_pins', 'pins', 'density'])
        ->and($aggregate['total_responses'])->toBe(4)
        ->and($aggregate['total_pins'])->toBe(5)
        ->and($aggregate['pins'])->toBe([
            ['x' => 10.0, 'y' => 20.0], ['x' => 30.5, 'y' => 40.0], ['x' => 50.0, 'y' => 60.0],
            ['x' => 100.0, 'y' => 100.0], ['x' => 0.0, 'y' => 0.0],
        ])
        ->and($aggregate['density']['size'])->toBe(PointCloud::GRID_SIZE)
        ->and($aggregate['density']['counts'])->toHaveCount(20)
        ->and($aggregate['density']['counts'][0])->toHaveCount(20)
        // counts[row by y][col by x], 5% cells; 100 falls in the last cell.
        ->and(tiPinCells($aggregate))->toBe(['0:0' => 1, '4:2' => 1, '8:6' => 1, '12:10' => 1, '19:19' => 1]);
});

it('aggregates deterministically and handles an empty run', function () {
    $type = tiPinType();
    $answers = collect([tiPinAnswer([['x' => 1, 'y' => 2]]), tiPinAnswer([['x' => 3, 'y' => 4]])]);

    expect($type->aggregate(tiPinConfig(), [], $answers))->toBe($type->aggregate(tiPinConfig(), [], $answers))
        ->and(tiPinCells($type->aggregate(tiPinConfig(), [], $answers->reverse()->values())))
        ->toBe(tiPinCells($type->aggregate(tiPinConfig(), [], $answers)));

    $empty = $type->aggregate(tiPinConfig(), [], collect());
    expect($empty)->toMatchArray(['total_responses' => 0, 'total_pins' => 0, 'pins' => []])
        ->and(tiPinCells($empty))->toBe([]);
});

it('keeps the broadcast aggregate under the Reverb request limit for a large audience', function () {
    // 500 participants x 10 pins (plan §8.2 load target, max pins), coordinates
    // with two decimals spread over every density cell.
    $answers = collect(range(0, 499))->map(fn (int $p) => tiPinAnswer(array_map(fn (int $k) => [
        'x' => (($p * 10 + $k) * 37 % 10_000) / 100,
        'y' => (($p * 10 + $k) * 91 % 10_000) / 100,
    ], range(0, 9))));

    $aggregate = tiPinType()->aggregate(tiPinConfig(10), [], $answers);

    expect($aggregate['total_responses'])->toBe(500)
        ->and($aggregate['total_pins'])->toBe(5_000)
        ->and($aggregate['pins'])->toHaveCount(PointCloud::MAX_POINTS)
        // The raw list keeps the most recent pins; the grid counts every pin.
        ->and(end($aggregate['pins']))->toBe(['x' => (4_999 * 37 % 10_000) / 100, 'y' => (4_999 * 91 % 10_000) / 100])
        ->and(array_sum(array_map('array_sum', $aggregate['density']['counts'])))->toBe(5_000)
        ->and(count(tiPinCells($aggregate)))->toBe(400);

    // REVERB_MAX_REQUEST_SIZE defaults to 10,000 bytes for the whole HTTP
    // request; leave 1,500 for the request line, auth query and headers.
    expect(tiPinBroadcastBytes($aggregate))->toBeLessThan(8_500);
});

it('aggregates stored answers through the registry; the schema keeps one answer row per participant', function () {
    $run = DeckSessionSlideRun::factory()->inState(DeckSessionSlideRun::STATE_VOTING)->create([
        'type_snapshot' => 'pin_on_image',
        'config_snapshot' => tiPinConfig(2),
    ]);
    $type = tiPinType();

    $first = DeckParticipantAnswer::factory()->create([
        'slide_run_id' => $run->id,
        'answer_payload' => $type->validateAnswer(['x' => 10, 'y' => 10], $run->config_snapshot, []),
    ]);
    DeckParticipantAnswer::factory()->create([
        'slide_run_id' => $run->id,
        'answer_payload' => $type->validateAnswer(['pins' => [['x' => 70, 'y' => 30], ['x' => 20, 'y' => 80]]], $run->config_snapshot, []),
    ]);

    // Schema check only: the unique (deck_participant_id, slide_run_id) key
    // refuses a second row. That a re-submission REPLACES the earlier pins
    // (plan §3.7) belongs to the Phase 3 submit-endpoint test.
    expect(fn () => DB::transaction(fn () => DeckParticipantAnswer::factory()->create([
        'deck_participant_id' => $first->deck_participant_id,
        'slide_run_id' => $run->id,
        'answer_payload' => ['pins' => [['x' => 55.0, 'y' => 45.0]]],
    ])))->toThrow(UniqueConstraintViolationException::class);

    $aggregate = app(SlideTypeRegistry::class)->aggregate($run->fresh());

    expect($aggregate['total_responses'])->toBe(2)
        ->and($aggregate['total_pins'])->toBe(3)
        ->and($aggregate['pins'])->toEqual([['x' => 10.0, 'y' => 10.0], ['x' => 70.0, 'y' => 30.0], ['x' => 20.0, 'y' => 80.0]])
        ->and(tiPinCells($aggregate))->toBe(['2:2' => 1, '6:14' => 1, '16:4' => 1]);
});

it('serialises for participants without aggregate or answer-key data', function () {
    $run = DeckSessionSlideRun::factory()->inState(DeckSessionSlideRun::STATE_VOTING)->make([
        'deck_session_id' => 1,
        'type_snapshot' => 'pin_on_image',
        'config_snapshot' => array_merge(tiPinConfig(), ['correct_answer' => ['x' => 5, 'y' => 5], '_zone' => [1, 2]]),
        'options_snapshot' => [['id' => 1, 'position' => 1, 'label' => 'Zone', 'image_file_id' => 3, 'image_url' => null, 'is_correct' => true, 'payload' => []]],
    ]);
    $type = tiPinType();

    $view = $type->serializeForParticipant($run);
    $json = json_encode($view);

    expect($view)->not->toHaveKey('aggregate')
        ->and($view['config'])->toEqual(tiPinConfig())
        ->and($json)->not->toContain('is_correct')
        ->and($json)->not->toContain('correct_answer')
        ->and($json)->not->toContain('_zone')
        ->and($json)->not->toContain('total_pins')
        ->and($json)->not->toContain('density');

    expect($type->serializeForPresenter($run, $type->aggregate($run->config_snapshot, [], collect()))['aggregate']['pins'])->toBe([]);
});
