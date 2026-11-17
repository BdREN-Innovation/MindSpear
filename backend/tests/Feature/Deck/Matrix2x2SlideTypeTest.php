<?php

use App\Deck\Broadcasts\Payloads\SlideAggregateUpdatedPayload;
use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quest\Matrix2x2SlideType;
use App\Deck\Slides\Types\Quest\PointCloud;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Validation\ValidationException;

uses(DatabaseTransactions::class);

function tiMxType(): Matrix2x2SlideType
{
    return app(SlideTypeRegistry::class)->for('matrix_2x2');
}

function tiMxConfig(): array
{
    return [
        'x_axis' => ['low' => 'Low effort', 'high' => 'High effort'],
        'y_axis' => ['low' => 'Low impact', 'high' => 'High impact'],
    ];
}

function tiMxAnswer(float|int $x, float|int $y): DeckParticipantAnswer
{
    return new DeckParticipantAnswer(['answer_payload' => ['x' => $x, 'y' => $y]]);
}

/** Density counts of an aggregate, keyed "row:col" for the non-empty cells. */
function tiMxCells(array $aggregate): array
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
function tiMxBroadcastBytes(array $aggregate): int
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

it('is discovered by the registry as a live Quest poll', function () {
    $registry = app(SlideTypeRegistry::class);

    expect($registry->for('matrix_2x2'))->toBeInstanceOf(Matrix2x2SlideType::class)
        ->and($registry->forProduct('quest'))->toHaveKey('matrix_2x2');

    $type = tiMxType();
    expect($type->category())->toBe(SlideTypeContract::CATEGORY_POLL)
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_LIVE)
        ->and($type->acceptsAnswers())->toBeTrue()
        ->and($type->defaultOptions())->toBe([]);
});

it('accepts its own default config', function () {
    $type = tiMxType();

    expect($type->validateConfig($type->defaultConfig()))->toBe($type->defaultConfig())
        ->and($type->validateConfig([]))->toBe([
            'x_axis' => ['low' => '', 'high' => ''],
            'y_axis' => ['low' => '', 'high' => ''],
            'show_results_to_participants' => false,
        ]);
});

it('normalises partial axes and null labels', function () {
    expect(tiMxType()->validateConfig([
        'x_axis' => ['low' => 'Cheap'],
        'y_axis' => ['low' => null, 'high' => 'Important', 'extra' => 'x'],
        'unknown' => true,
    ]))->toBe([
        'x_axis' => ['low' => 'Cheap', 'high' => ''],
        'y_axis' => ['low' => '', 'high' => 'Important'],
        'show_results_to_participants' => false,
    ]);
});

it('rejects bad config', function (array $config) {
    expect(fn () => tiMxType()->validateConfig($config))->toThrow(ValidationException::class);
})->with([
    'axis not an object' => [['x_axis' => 'horizontal']],
    'axis null' => [['y_axis' => null]],
    'label not a string' => [['x_axis' => ['low' => ['a'], 'high' => '']]],
    'label too long' => [['y_axis' => ['low' => str_repeat('a', 81), 'high' => '']]],
]);

it('accepts coordinates within the plane', function () {
    // Coordinates are percentages 0..100 (plan §3.7), the same unit as pin_on_image.
    $type = tiMxType();

    expect($type->validateAnswer(['x' => 0, 'y' => 100], tiMxConfig(), []))->toBe(['x' => 0.0, 'y' => 100.0])
        ->and($type->validateAnswer(['x' => '12.3456', 'y' => 50, 'z' => 1], tiMxConfig(), []))->toBe(['x' => 12.35, 'y' => 50.0]);
});

it('rejects malformed or out-of-range coordinates', function (array $payload) {
    expect(fn () => tiMxType()->validateAnswer($payload, tiMxConfig(), []))->toThrow(ValidationException::class);
})->with([
    'empty payload' => [[]],
    'missing y' => [['x' => 10]],
    'x negative' => [['x' => -0.01, 'y' => 10]],
    'y negative' => [['x' => 10, 'y' => -1]],
    'x above 100' => [['x' => 100.01, 'y' => 10]],
    'y above 100' => [['x' => 10, 'y' => 101]],
    'string coordinate' => [['x' => 'left', 'y' => 10]],
    'boolean coordinate' => [['x' => true, 'y' => 10]],
    'nested coordinate' => [['x' => [1], 'y' => 10]],
]);

it('scores zero', function () {
    expect(tiMxType()->score(['x' => 1, 'y' => 1], tiMxConfig(), [], 100))->toEqual(ScoreResult::zero());
});

it('aggregates raw points, a density grid and the centroid', function () {
    $answers = collect([tiMxAnswer(10, 20), tiMxAnswer(30.5, 40), tiMxAnswer(50, 60.25), tiMxAnswer(100, 100)]);

    $aggregate = tiMxType()->aggregate(tiMxConfig(), [], $answers);

    expect(array_keys($aggregate))->toBe(['total_responses', 'total_points', 'points', 'density', 'centroid'])
        ->and($aggregate['total_responses'])->toBe(4)
        ->and($aggregate['total_points'])->toBe(4)
        ->and($aggregate['points'])->toBe([['x' => 10.0, 'y' => 20.0], ['x' => 30.5, 'y' => 40.0], ['x' => 50.0, 'y' => 60.25], ['x' => 100.0, 'y' => 100.0]])
        ->and($aggregate['centroid'])->toBe(['x' => 47.63, 'y' => 55.06])
        ->and($aggregate['density']['size'])->toBe(PointCloud::GRID_SIZE)
        ->and($aggregate['density']['counts'])->toHaveCount(20)
        ->and($aggregate['density']['counts'][19])->toHaveCount(20)
        // counts[row by y][col by x], 5% cells; 100 falls in the last cell.
        ->and(tiMxCells($aggregate))->toBe(['4:2' => 1, '8:6' => 1, '12:10' => 1, '19:19' => 1]);
});

it('aggregates deterministically, skips malformed payloads and handles an empty run', function () {
    $type = tiMxType();
    $answers = collect([
        tiMxAnswer(0, 0),
        tiMxAnswer(100, 100),
        new DeckParticipantAnswer(['answer_payload' => ['x' => 'bad']]),
        tiMxAnswer(150, 50),
    ]);

    $first = $type->aggregate(tiMxConfig(), [], $answers);
    $reversed = $type->aggregate(tiMxConfig(), [], $answers->reverse()->values());

    expect($type->aggregate(tiMxConfig(), [], $answers))->toBe($first)
        ->and($first['total_responses'])->toBe(4)
        ->and($first['total_points'])->toBe(2)
        ->and($first['points'])->toHaveCount(2)
        ->and($first['centroid'])->toBe(['x' => 50.0, 'y' => 50.0])
        ->and($reversed['centroid'])->toBe($first['centroid'])
        ->and($reversed['density'])->toBe($first['density']);

    $empty = $type->aggregate(tiMxConfig(), [], collect());
    expect($empty)->toMatchArray(['total_responses' => 0, 'total_points' => 0, 'points' => [], 'centroid' => null])
        ->and(tiMxCells($empty))->toBe([]);
});

it('keeps the broadcast aggregate under the Reverb request limit for a large audience', function () {
    // 2,000 participants (4x the plan §8.2 load target), coordinates with two
    // decimals spread over every density cell.
    $answers = collect(range(0, 1_999))->map(fn (int $i) => tiMxAnswer(($i * 37 % 10_000) / 100, ($i * 53 % 10_000) / 100));

    $aggregate = tiMxType()->aggregate(tiMxConfig(), [], $answers);

    expect($aggregate['total_responses'])->toBe(2_000)
        ->and($aggregate['total_points'])->toBe(2_000)
        ->and($aggregate['points'])->toHaveCount(PointCloud::MAX_POINTS)
        // The raw list keeps the most recent points; grid and centroid use every point.
        ->and(end($aggregate['points']))->toBe(['x' => (1_999 * 37 % 10_000) / 100, 'y' => (1_999 * 53 % 10_000) / 100])
        ->and(array_sum(array_map('array_sum', $aggregate['density']['counts'])))->toBe(2_000)
        ->and($aggregate['centroid'])->toBe([
            'x' => round($answers->sum(fn ($a) => $a->answer_payload['x']) / 2_000, 2),
            'y' => round($answers->sum(fn ($a) => $a->answer_payload['y']) / 2_000, 2),
        ]);

    // REVERB_MAX_REQUEST_SIZE defaults to 10,000 bytes for the whole HTTP
    // request; leave 1,500 for the request line, auth query and headers.
    expect(tiMxBroadcastBytes($aggregate))->toBeLessThan(8_500);
});

it('aggregates stored answers through the registry', function () {
    $run = DeckSessionSlideRun::factory()->inState(DeckSessionSlideRun::STATE_VOTING)->create([
        'type_snapshot' => 'matrix_2x2',
        'config_snapshot' => tiMxConfig(),
    ]);
    $type = tiMxType();

    foreach ([[20, 80], [40, 60]] as [$x, $y]) {
        DeckParticipantAnswer::factory()->create([
            'slide_run_id' => $run->id,
            'answer_payload' => $type->validateAnswer(['x' => $x, 'y' => $y], tiMxConfig(), []),
        ]);
    }

    $aggregate = app(SlideTypeRegistry::class)->aggregate($run->fresh());

    expect($aggregate['total_responses'])->toBe(2)
        ->and($aggregate['points'])->toEqual([['x' => 20.0, 'y' => 80.0], ['x' => 40.0, 'y' => 60.0]])
        ->and($aggregate['centroid'])->toEqual(['x' => 30.0, 'y' => 70.0]);
});

it('serialises for participants without aggregate or answer-key data', function () {
    $run = DeckSessionSlideRun::factory()->inState(DeckSessionSlideRun::STATE_VOTING)->make([
        'deck_session_id' => 1,
        'type_snapshot' => 'matrix_2x2',
        'config_snapshot' => array_merge(tiMxConfig(), ['answer_key' => ['x' => 1], '_hint' => 'x']),
        'options_snapshot' => [['id' => 1, 'position' => 1, 'label' => null, 'image_file_id' => null, 'image_url' => null, 'is_correct' => true, 'payload' => []]],
    ]);
    $type = tiMxType();

    $view = $type->serializeForParticipant($run);
    $json = json_encode($view);

    expect($view)->not->toHaveKey('aggregate')
        ->and($view['config'])->toEqual(tiMxConfig())
        ->and($json)->not->toContain('is_correct')
        ->and($json)->not->toContain('answer_key')
        ->and($json)->not->toContain('_hint')
        ->and($json)->not->toContain('centroid')
        ->and($json)->not->toContain('density');

    expect($type->serializeForPresenter($run, ['centroid' => null])['aggregate'])->toBe(['centroid' => null]);
});
