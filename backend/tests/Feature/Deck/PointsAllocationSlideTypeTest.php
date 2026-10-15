<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quest\PointsAllocationSlideType;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Validation\ValidationException;

uses(DatabaseTransactions::class);

function tiPaType(): PointsAllocationSlideType
{
    return app(SlideTypeRegistry::class)->for('points_allocation');
}

/** Options snapshot with answer-key noise that must never reach participants. */
function tiPaOptions(): array
{
    return [
        ['id' => 11, 'position' => 1, 'label' => 'Speed', 'image_file_id' => 5, 'image_url' => null, 'is_correct' => true, 'payload' => ['correct_order_index' => 2]],
        ['id' => 12, 'position' => 2, 'label' => 'Quality', 'image_file_id' => null, 'image_url' => null, 'is_correct' => false, 'payload' => []],
        ['id' => 13, 'position' => 3, 'label' => 'Cost', 'image_file_id' => null, 'image_url' => null, 'is_correct' => null, 'payload' => []],
    ];
}

function tiPaAnswer(array $allocations): DeckParticipantAnswer
{
    return new DeckParticipantAnswer(['answer_payload' => ['allocations' => $allocations]]);
}

function tiPaAlloc(int $speed, int $quality, int $cost): array
{
    return [
        ['option_id' => 11, 'points' => $speed],
        ['option_id' => 12, 'points' => $quality],
        ['option_id' => 13, 'points' => $cost],
    ];
}

it('is discovered by the registry as a live Quest poll', function () {
    $registry = app(SlideTypeRegistry::class);

    expect($registry->for('points_allocation'))->toBeInstanceOf(PointsAllocationSlideType::class)
        ->and($registry->forProduct('quest'))->toHaveKey('points_allocation');

    $type = tiPaType();
    expect($type->category())->toBe(SlideTypeContract::CATEGORY_POLL)
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_LIVE)
        ->and($type->acceptsAnswers())->toBeTrue()
        ->and($type->defaultOptions())->toHaveCount(3)
        ->and($type->defaultOptions()[0])->toBe(['label' => null, 'payload' => []]);
});

it('accepts its own default config', function () {
    $type = tiPaType();

    expect($type->validateConfig($type->defaultConfig()))->toBe(['total_points' => 100, 'show_results_to_participants' => false])
        ->and($type->validateConfig([]))->toBe(['total_points' => 100, 'show_results_to_participants' => false])
        ->and($type->validateConfig(['total_points' => '200', 'extra' => true]))->toBe(['total_points' => 200, 'show_results_to_participants' => false])
        ->and($type->validateConfig(['show_results_to_participants' => true])['show_results_to_participants'])->toBeTrue();
});

it('rejects bad config', function (array $config) {
    expect(fn () => tiPaType()->validateConfig($config))->toThrow(ValidationException::class);
})->with([
    'zero total' => [['total_points' => 0]],
    'negative total' => [['total_points' => -10]],
    'huge total' => [['total_points' => 100000]],
    'fractional total' => [['total_points' => 12.5]],
    'string total' => [['total_points' => 'lots']],
    'null total' => [['total_points' => null]],
]);

it('accepts allocations that add up exactly and normalises them to every option', function () {
    $type = tiPaType();
    $config = ['total_points' => 100];

    expect($type->validateAnswer(['allocations' => tiPaAlloc(50, 30, 20)], $config, tiPaOptions()))
        ->toBe(['allocations' => tiPaAlloc(50, 30, 20)]);

    // Omitted options count as 0; output follows option order; extra keys dropped.
    expect($type->validateAnswer([
        'allocations' => [['option_id' => 13, 'points' => '40'], ['option_id' => 11, 'points' => 60]],
        'junk' => 'x',
    ], $config, tiPaOptions()))->toBe(['allocations' => tiPaAlloc(60, 0, 40)]);

    // All points on one option is allowed.
    expect($type->validateAnswer(['allocations' => [['option_id' => 12, 'points' => 50]]], ['total_points' => 50], tiPaOptions()))
        ->toBe(['allocations' => tiPaAlloc(0, 50, 0)]);
});

it('rejects malformed or invalid allocations', function (array $payload) {
    expect(fn () => tiPaType()->validateAnswer($payload, ['total_points' => 100], tiPaOptions()))
        ->toThrow(ValidationException::class);
})->with([
    'empty payload' => [[]],
    'allocations not a list' => [['allocations' => ['11' => 100]]],
    'allocations scalar' => [['allocations' => 100]],
    'empty allocations' => [['allocations' => []]],
    'sum below total' => [['allocations' => tiPaAlloc(50, 30, 10)]],
    'sum above total' => [['allocations' => tiPaAlloc(50, 30, 30)]],
    'negative points' => [['allocations' => tiPaAlloc(120, -20, 0)]],
    'fractional points' => [['allocations' => [['option_id' => 11, 'points' => 50.5], ['option_id' => 12, 'points' => 49.5]]]],
    'unknown option id' => [['allocations' => [['option_id' => 999, 'points' => 100]]]],
    'duplicate option id' => [['allocations' => [['option_id' => 11, 'points' => 50], ['option_id' => 11, 'points' => 50]]]],
    'missing points' => [['allocations' => [['option_id' => 11]]]],
    'missing option id' => [['allocations' => [['points' => 100]]]],
    'entry not an object' => [['allocations' => [100]]],
]);

it('rejects an allocation list longer than the option list up front', function (int $entries) {
    // Through the wildcard rules (`*` expansion + distinct, both quadratic)
    // 10,000 entries took ~15s; the length check is O(1).
    $payload = ['allocations' => array_fill(0, $entries, ['option_id' => 11, 'points' => 0])];

    $started = microtime(true);
    try {
        tiPaType()->validateAnswer($payload, ['total_points' => 100], tiPaOptions());
        $this->fail('Expected a ValidationException.');
    } catch (ValidationException $e) {
        expect($e->errors())->toBe(['allocations' => ['The allocations field must not have more than 3 items.']]);
    }

    expect(microtime(true) - $started)->toBeLessThan(1.0);
})->with([
    'one more than the options' => [4],
    'twenty thousand' => [20_000],
]);

it('rejects every submission when the run has no options', function () {
    expect(fn () => tiPaType()->validateAnswer(['allocations' => [['option_id' => 11, 'points' => 100]]], ['total_points' => 100], []))
        ->toThrow(ValidationException::class);
});

it('scores zero', function () {
    expect(tiPaType()->score(['allocations' => tiPaAlloc(50, 30, 20)], ['total_points' => 100], tiPaOptions(), 900))
        ->toEqual(ScoreResult::zero());
});

it('aggregates sums and percentages of points distributed', function () {
    $answers = collect([
        tiPaAnswer(tiPaAlloc(50, 30, 20)),
        tiPaAnswer(tiPaAlloc(100, 0, 0)),
        tiPaAnswer(tiPaAlloc(0, 0, 100)),
        // Stale option id (not in snapshot) is ignored.
        tiPaAnswer([['option_id' => 999, 'points' => 100]]),
    ]);

    $aggregate = tiPaType()->aggregate(['total_points' => 100], tiPaOptions(), $answers);

    expect($aggregate)->toBe([
        'total_responses' => 4,
        'total_points' => 100,
        'total_points_distributed' => 300,
        'options' => [
            ['option_id' => 11, 'points' => 150, 'percentage' => 50.0, 'average_points' => 37.5],
            ['option_id' => 12, 'points' => 30, 'percentage' => 10.0, 'average_points' => 7.5],
            ['option_id' => 13, 'points' => 120, 'percentage' => 40.0, 'average_points' => 30.0],
        ],
    ]);
});

it('aggregates deterministically regardless of answer order', function () {
    $answers = collect([
        tiPaAnswer(tiPaAlloc(33, 33, 34)),
        tiPaAnswer(tiPaAlloc(10, 70, 20)),
        tiPaAnswer(tiPaAlloc(1, 1, 98)),
    ]);
    $type = tiPaType();

    $first = $type->aggregate(['total_points' => 100], tiPaOptions(), $answers);

    expect($type->aggregate(['total_points' => 100], tiPaOptions(), $answers))->toBe($first)
        ->and($type->aggregate(['total_points' => 100], tiPaOptions(), $answers->reverse()->values()))->toBe($first)
        ->and($first['options'][0]['percentage'])->toBe(14.67)
        ->and($first['options'][0]['average_points'])->toBe(14.67);
});

it('aggregates an empty run to zeros', function () {
    expect(tiPaType()->aggregate([], tiPaOptions(), collect()))->toBe([
        'total_responses' => 0,
        'total_points' => 100,
        'total_points_distributed' => 0,
        'options' => [
            ['option_id' => 11, 'points' => 0, 'percentage' => 0.0, 'average_points' => 0.0],
            ['option_id' => 12, 'points' => 0, 'percentage' => 0.0, 'average_points' => 0.0],
            ['option_id' => 13, 'points' => 0, 'percentage' => 0.0, 'average_points' => 0.0],
        ],
    ]);
});

it('aggregates stored answers through the registry', function () {
    $run = DeckSessionSlideRun::factory()->inState(DeckSessionSlideRun::STATE_VOTING)->create([
        'type_snapshot' => 'points_allocation',
        'config_snapshot' => ['total_points' => 100],
        'options_snapshot' => tiPaOptions(),
    ]);
    $type = tiPaType();

    foreach ([tiPaAlloc(60, 40, 0), tiPaAlloc(0, 40, 60)] as $allocations) {
        DeckParticipantAnswer::factory()->create([
            'slide_run_id' => $run->id,
            'answer_payload' => $type->validateAnswer(['allocations' => $allocations], $run->config_snapshot, $run->options_snapshot),
        ]);
    }

    $aggregate = app(SlideTypeRegistry::class)->aggregate($run->fresh());

    expect($aggregate['total_responses'])->toBe(2)
        ->and($aggregate['total_points_distributed'])->toBe(200)
        ->and(array_column($aggregate['options'], 'percentage'))->toBe([30.0, 40.0, 30.0]);
});

it('serialises for participants without aggregate or answer-key data', function () {
    $run = DeckSessionSlideRun::factory()->inState(DeckSessionSlideRun::STATE_VOTING)->make([
        'deck_session_id' => 1,
        'type_snapshot' => 'points_allocation',
        'config_snapshot' => ['total_points' => 100, 'correct_answer' => 11, '_secret' => 1],
        'options_snapshot' => tiPaOptions(),
    ]);
    $type = tiPaType();

    $view = $type->serializeForParticipant($run);
    $json = json_encode($view);

    expect($view)->not->toHaveKey('aggregate')
        ->and($view['config'])->toBe(['total_points' => 100])
        ->and($view['options'])->toHaveCount(3)
        ->and($view['options'][0])->toBe(['id' => 11, 'position' => 1, 'label' => 'Speed', 'image_url' => null, 'payload' => []])
        ->and($json)->not->toContain('is_correct')
        ->and($json)->not->toContain('correct_order_index')
        ->and($json)->not->toContain('image_file_id')
        ->and($json)->not->toContain('"points"');

    $presenter = $type->serializeForPresenter($run, $type->aggregate($run->config_snapshot, $run->options_snapshot, collect()));
    expect($presenter)->toHaveKey('aggregate')
        ->and($presenter['aggregate']['total_points_distributed'])->toBe(0);
});
