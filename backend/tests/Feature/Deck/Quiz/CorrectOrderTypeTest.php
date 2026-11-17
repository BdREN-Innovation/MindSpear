<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\Types\Quiz\CorrectOrderSlideType;
use App\Deck\Slides\Types\Quiz\QuizOptions;

require_once __DIR__ . '/QuizTypeHelpers.php';

/** Items 51..54, correct order = position order (given shuffled here to prove position wins). */
function coOptions(): array
{
    return [
        quizOption(53, 3, 'Bronze age'),
        quizOption(51, 1, 'Stone age', ['correct_order_index' => 0]),
        quizOption(54, 4, 'Iron age'),
        quizOption(52, 2, 'Copper age'),
    ];
}

function coOrder(int ...$ids): array
{
    return ['order' => array_map('quizKey', $ids)];
}

it('is registered as a scored quiz type seeded with four empty items', function () {
    $type = quizType('correct_order');

    expect($type)->toBeInstanceOf(CorrectOrderSlideType::class)
        ->and($type->products())->toBe(['quiz'])
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_HIDDEN)
        ->and($type->defaultOptions())->toBe(array_fill(0, 4, ['label' => null, 'payload' => []]))
        ->and($type->validateConfig(['correct_order' => [1]]))->toBe([])
        ->and($type->defaultSlideAttributes()['time_limit_seconds'])->toBe(30);
});

it('accepts every item key exactly once', function () {
    expect(quizType('correct_order')->validateAnswer(coOrder(52, 51, 54, 53), [], coOptions()))->toBe(coOrder(52, 51, 54, 53));
});

it('rejects answers that are not a full order of the item keys', function (Closure $payload) {
    quizRejects(fn () => quizType('correct_order')->validateAnswer($payload(), [], coOptions()));
})->with([
    'raw option ids' => [fn () => ['order' => [51, 52, 53, 54]]],
    'missing an item' => [fn () => coOrder(51, 52, 53)],
    'duplicate' => [fn () => coOrder(51, 52, 53, 53)],
    'unknown key' => [fn () => ['order' => [quizKey(51), quizKey(52), quizKey(53), 'kffffffffffff']]],
    'too long' => [fn () => coOrder(51, 52, 53, 54, 51)],
    'empty' => [fn () => ['order' => []]],
    'object' => [fn () => ['order' => ['a' => quizKey(51)]]],
    'missing' => [fn () => []],
]);

it('scores exact order in full, else items in the correct position over total', function (Closure $payload, int $points, bool $correct, float $credit) {
    $score = quizType('correct_order')->score($payload(), quizScoring(50, 100, false), coOptions(), 0);

    expect($score)->toEqual(new ScoreResult($points, $correct, $credit));
})->with([
    'exact' => [fn () => coOrder(51, 52, 53, 54), 100, true, 1.0],
    'two swapped' => [fn () => coOrder(51, 52, 54, 53), 50, false, 0.5],
    'one in place' => [fn () => coOrder(51, 53, 54, 52), 25, false, 0.25],
    'reversed' => [fn () => coOrder(54, 53, 52, 51), 0, false, 0.0],
    'empty' => [fn () => ['order' => []], 0, false, 0.0],
    'malformed' => [fn () => ['order' => 'abcd'], 0, false, 0.0],
    'object' => [fn () => ['order' => ['x' => quizKey(51)]], 0, false, 0.0],
    'missing' => [fn () => [], 0, false, 0.0],
]);

it('shows participants opaque keys in a keyed shuffle of the run (any order, the answer included)', function () {
    $type = quizType('correct_order');
    $correct = array_map('quizKey', [51, 52, 53, 54]);

    $view = quizAssertNoLeak($type, quizRun('correct_order', quizScoring(), coOptions(), 300), ['"id":51', '"id":52', '"id":53', '"id":54']);

    expect(array_column($view['options'], 'id'))->toEqualCanonicalizing($correct)
        ->and(array_column($view['options'], 'position'))->toBe([1, 2, 3, 4])
        ->and($view['options_hidden'])->toBeFalse()
        ->and(array_unique(array_map(fn ($o) => json_encode($o['payload']), $view['options'])))->toBe(['[]']);

    $seen = [];
    foreach (range(1, 40) as $runId) {
        $order = array_column($type->serializeForParticipant(quizRun('correct_order', [], coOptions(), $runId))['options'], 'id');
        // The run-level order is QuizOptions::shuffle's, whatever order the snapshot lists the items in.
        expect($order)->toBe(array_map(fn ($o) => quizKey($o['id']), QuizOptions::shuffle(QuizOptions::sorted(coOptions()), $runId)))
            ->and(array_column($type->serializeForParticipant(quizRun('correct_order', [], array_reverse(coOptions()), $runId))['options'], 'id'))->toBe($order);
        $seen[implode(',', $order)] = true;
    }
    expect(count($seen))->toBeGreaterThan(3);
});

it('shows two items in either order (no "never the answer" rotation that gave it away)', function () {
    $options = [quizOption(1, 1, 'A'), quizOption(2, 2, 'B')];
    $orders = [];

    foreach (range(1, 60) as $runId) {
        $order = array_column(quizType('correct_order')->serializeForParticipant(quizRun('correct_order', [], $options, $runId))['options'], 'id');
        $orders[implode(',', $order)] = ($orders[implode(',', $order)] ?? 0) + 1;
    }

    expect($orders)->toHaveKeys([quizKey(1) . ',' . quizKey(2), quizKey(2) . ',' . quizKey(1)]);
});

it('gives the presenter the correct order and real ids', function () {
    $view = quizType('correct_order')->serializeForPresenter(quizRun('correct_order', [], coOptions()), []);

    expect($view['answer_key'])->toBe(coOrder(51, 52, 53, 54))
        ->and(collect($view['options'])->pluck('option_id', 'id')->sortKeys()->all())->toBe(collect([
            quizKey(51) => 51, quizKey(52) => 52, quizKey(53) => 53, quizKey(54) => 54,
        ])->sortKeys()->all());
});

it('aggregates per-item correctness and the most common order deterministically', function () {
    $type = quizType('correct_order');
    $answers = collect([
        quizAnswer(coOrder(51, 52, 53, 54), 1),
        quizAnswer(coOrder(51, 52, 54, 53), 2),
        quizAnswer(coOrder(51, 52, 54, 53), 3),
        quizAnswer(coOrder(54, 53, 52, 51), 4),
        quizAnswer(['order' => 'x'], 5),
    ]);

    $aggregate = $type->aggregate([], coOptions(), $answers);

    expect($aggregate)->toBe([
        'total_responses' => 4,
        'correct_responses' => 1,
        'partially_correct_responses' => 2,
        'incorrect_responses' => 1,
        'correct_percentage' => 25.0,
        'items' => [
            ['id' => quizKey(51), 'correct_position' => 1, 'correct_count' => 3, 'correct_percentage' => 75.0],
            ['id' => quizKey(52), 'correct_position' => 2, 'correct_count' => 3, 'correct_percentage' => 75.0],
            ['id' => quizKey(53), 'correct_position' => 3, 'correct_count' => 1, 'correct_percentage' => 25.0],
            ['id' => quizKey(54), 'correct_position' => 4, 'correct_count' => 1, 'correct_percentage' => 25.0],
        ],
        'most_common_order' => ['order' => coOrder(51, 52, 54, 53)['order'], 'count' => 2, 'tied' => false],
        'correct' => coOrder(51, 52, 53, 54),
    ])
        ->and($type->aggregate([], coOptions(), $answers->reverse()->values()))->toBe($aggregate)
        ->and($type->aggregate([], coOptions(), collect())['most_common_order'])->toBeNull();

    // A tie for most common resolves the same way whatever the answer order, and says it is a tie.
    $tie = collect([quizAnswer(coOrder(54, 53, 52, 51), 1), quizAnswer(coOrder(51, 52, 53, 54), 2)]);
    expect($type->aggregate([], coOptions(), $tie)['most_common_order'])
        ->toBe($type->aggregate([], coOptions(), $tie->reverse()->values())['most_common_order'])
        ->and($type->aggregate([], coOptions(), $tie)['most_common_order']['tied'])->toBeTrue()
        ->and($type->aggregate([], coOptions(), $tie)['most_common_order']['count'])->toBe(1);

    // One player: a single order, not a tie. 1-1-1 among three players: a tie.
    expect($type->aggregate([], coOptions(), collect([quizAnswer(coOrder(54, 53, 52, 51), 1)]))['most_common_order'])
        ->toBe(['order' => coOrder(54, 53, 52, 51)['order'], 'count' => 1, 'tied' => false])
        ->and($type->aggregate([], coOptions(), collect([
            quizAnswer(coOrder(54, 53, 52, 51), 1), quizAnswer(coOrder(51, 52, 53, 54), 2), quizAnswer(coOrder(52, 51, 53, 54), 3),
        ]))['most_common_order']['tied'])->toBeTrue()
        // Two of the same order beat a single other one: no tie.
        ->and($type->aggregate([], coOptions(), collect([
            quizAnswer(coOrder(54, 53, 52, 51), 1), quizAnswer(coOrder(54, 53, 52, 51), 2), quizAnswer(coOrder(52, 51, 53, 54), 3),
        ]))['most_common_order'])->toBe(['order' => coOrder(54, 53, 52, 51)['order'], 'count' => 2, 'tied' => false]);
});
