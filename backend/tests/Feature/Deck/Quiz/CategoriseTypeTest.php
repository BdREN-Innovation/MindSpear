<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\Types\Quiz\CategoriseSlideType;
use App\Deck\Slides\Types\Quiz\QuizOptions;

require_once __DIR__ . '/QuizTypeHelpers.php';

function catConfig(): array
{
    return ['categories' => [['key' => 'fruit', 'label' => 'Fruit'], ['key' => 'veg', 'label' => 'Vegetable']]] + quizScoring(50, 100, false);
}

/** Items 61..64 (fruit, fruit, veg, veg); 65 names no category and is ignored. */
function catOptions(): array
{
    return [
        quizOption(61, 1, 'Apple', ['correct_category_key' => 'fruit']),
        quizOption(62, 2, 'Pear', ['correct_category_key' => 'fruit']),
        quizOption(63, 3, 'Leek', ['correct_category_key' => 'veg']),
        quizOption(64, 4, 'Kale', ['correct_category_key' => 'veg']),
        quizOption(65, 5, 'Rock', ['correct_category_key' => 'mineral']),
    ];
}

function catPlace(array $placements): array
{
    return ['placements' => array_map(fn (int $item, string $category) => ['item_id' => quizKey($item), 'category_key' => $category], array_keys($placements), $placements)];
}

it('is registered as a scored quiz type with two empty categories and four items', function () {
    $type = quizType('categorise');

    expect($type)->toBeInstanceOf(CategoriseSlideType::class)
        ->and($type->products())->toBe(['quiz'])
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_HIDDEN)
        ->and($type->defaultConfig())->toBe(['categories' => [['key' => 'c1', 'label' => null], ['key' => 'c2', 'label' => null]]])
        ->and($type->validateConfig($type->defaultConfig()))->toBe($type->defaultConfig())
        ->and($type->validateConfig([]))->toBe($type->defaultConfig())
        ->and($type->defaultOptions())->toBe([
            ['label' => null, 'payload' => ['correct_category_key' => 'c1']],
            ['label' => null, 'payload' => ['correct_category_key' => 'c1']],
            ['label' => null, 'payload' => ['correct_category_key' => 'c2']],
            ['label' => null, 'payload' => ['correct_category_key' => 'c2']],
        ])
        ->and($type->defaultSlideAttributes()['time_limit_seconds'])->toBe(45);
});

it('normalises categories', function () {
    expect(quizType('categorise')->validateConfig(['categories' => [
        ['key' => 'a', 'label' => "  Animals\u{0007} ", 'colour' => 'red'],
        ['key' => 'b', 'label' => '   '],
        ['key' => 'c'],
    ], 'junk' => 1]))->toBe(['categories' => [
        ['key' => 'a', 'label' => 'Animals'],
        ['key' => 'b', 'label' => null],
        ['key' => 'c', 'label' => null],
    ]]);
});

it('rejects bad categories', function (array $config) {
    quizRejects(fn () => quizType('categorise')->validateConfig($config));
})->with([
    'one category' => [['categories' => [['key' => 'a']]]],
    'six categories' => [['categories' => array_map(fn ($k) => ['key' => "c{$k}"], range(1, 6))]],
    'duplicate keys' => [['categories' => [['key' => 'a'], ['key' => 'a']]]],
    'numeric key' => [['categories' => [['key' => '1'], ['key' => 'b']]]],
    'missing key' => [['categories' => [['label' => 'A'], ['key' => 'b']]]],
    'long label' => [['categories' => [['key' => 'a', 'label' => str_repeat('x', 101)], ['key' => 'b']]]],
    'not a list' => [['categories' => ['a' => ['key' => 'a'], 'b' => ['key' => 'b']]]],
    'null' => [['categories' => null]],
]);

it('validates item payloads', function () {
    expect(quizType('categorise')->validateOptionPayload(['correct_category_key' => 'veg', 'x' => 1]))->toBe(['correct_category_key' => 'veg']);

    quizRejects(fn () => quizType('categorise')->validateOptionPayload([]));
    quizRejects(fn () => quizType('categorise')->validateOptionPayload(['correct_category_key' => 'no spaces']));
});

it('accepts placements of known items into known categories', function () {
    $payload = catPlace([63 => 'veg', 61 => 'veg']);

    expect(quizType('categorise')->validateAnswer($payload, catConfig(), catOptions()))->toBe($payload);
});

it('rejects placements with unknown items or categories, or an item twice', function (Closure $payload) {
    quizRejects(fn () => quizType('categorise')->validateAnswer($payload(), catConfig(), catOptions()));
})->with([
    'raw option id' => [fn () => ['placements' => [['item_id' => 61, 'category_key' => 'fruit']]]],
    'ignored item' => [fn () => catPlace([65 => 'fruit'])],
    'unknown category' => [fn () => catPlace([61 => 'mineral'])],
    'item twice' => [fn () => ['placements' => [['item_id' => quizKey(61), 'category_key' => 'fruit'], ['item_id' => quizKey(61), 'category_key' => 'veg']]]],
    'empty' => [fn () => ['placements' => []]],
    'missing' => [fn () => []],
    'too many' => [fn () => ['placements' => array_fill(0, 5, ['item_id' => quizKey(61), 'category_key' => 'fruit'])]],
    'placement not an object' => [fn () => ['placements' => ['fruit']]],
]);

it('scores items in the correct category over total items', function (Closure $payload, int $points, bool $correct, float $credit) {
    $score = quizType('categorise')->score($payload(), catConfig(), catOptions(), 0);

    expect($score)->toEqual(new ScoreResult($points, $correct, $credit));
})->with([
    'all right' => [fn () => catPlace([64 => 'veg', 61 => 'fruit', 63 => 'veg', 62 => 'fruit']), 100, true, 1.0],
    'three of four' => [fn () => catPlace([61 => 'fruit', 62 => 'veg', 63 => 'veg', 64 => 'veg']), 75, false, 0.75],
    'one placed, rest unplaced' => [fn () => catPlace([61 => 'fruit']), 25, false, 0.25],
    'all wrong' => [fn () => catPlace([61 => 'veg', 62 => 'veg', 63 => 'fruit', 64 => 'fruit']), 0, false, 0.0],
    'repeat placement: first wins' => [fn () => ['placements' => [['item_id' => quizKey(61), 'category_key' => 'veg'], ['item_id' => quizKey(61), 'category_key' => 'fruit']]], 0, false, 0.0],
    'empty' => [fn () => ['placements' => []], 0, false, 0.0],
    'malformed' => [fn () => ['placements' => 'fruit'], 0, false, 0.0],
    'missing' => [fn () => [], 0, false, 0.0],
]);

it('hides each item category and real ids from participants, items shuffled by run', function () {
    $type = quizType('categorise');

    $view = quizAssertNoLeak($type, quizRun('categorise', catConfig(), catOptions(), 55), ['"id":61', '"id":64', 'mineral', 'Rock']);

    expect(array_column($view['options'], 'id'))->toEqualCanonicalizing(array_map('quizKey', [61, 62, 63, 64]))
        // Keyed shuffle of the run (QuizOptions::shuffle); author order is as likely as any other.
        ->and(array_column($view['options'], 'id'))->toBe(array_map(fn (array $o) => quizKey($o['id']), QuizOptions::shuffle(array_slice(QuizOptions::sorted(catOptions()), 0, 4), 55)))
        ->and(array_column($view['options'], 'payload'))->toBe([[], [], [], []])
        ->and($view['config']['categories'])->toBe(catConfig()['categories']);

    $again = $type->serializeForParticipant(quizRun('categorise', catConfig(), array_reverse(catOptions()), 55));
    expect(array_column($again['options'], 'id'))->toBe(array_column($view['options'], 'id'));
});

it('gives the presenter the categories of every item', function () {
    $view = quizType('categorise')->serializeForPresenter(quizRun('categorise', catConfig(), catOptions()), []);

    expect($view['answer_key'])->toBe(['categories' => [
        ['key' => 'fruit', 'item_ids' => [quizKey(61), quizKey(62)]],
        ['key' => 'veg', 'item_ids' => [quizKey(63), quizKey(64)]],
    ]])
        ->and(collect($view['options'])->firstWhere('option_id', 63)['payload'])->toBe(['correct_category_key' => 'veg']);
});

it('aggregates per-item placements aligned with the categories, deterministically', function () {
    $type = quizType('categorise');
    $answers = collect([
        quizAnswer(catPlace([61 => 'fruit', 62 => 'fruit', 63 => 'veg', 64 => 'veg']), 1),
        quizAnswer(catPlace([61 => 'veg', 62 => 'fruit']), 2),
        quizAnswer(catPlace([61 => 'veg', 63 => 'fruit', 64 => 'fruit', 62 => 'veg']), 3),
        quizAnswer(['placements' => null], 4),
    ]);

    $aggregate = $type->aggregate(catConfig(), catOptions(), $answers);

    expect($aggregate)->toBe([
        'total_responses' => 3,
        'correct_responses' => 1,
        'partially_correct_responses' => 1,
        'incorrect_responses' => 1,
        'correct_percentage' => 33.33,
        'category_keys' => ['fruit', 'veg'],
        'items' => [
            ['id' => quizKey(61), 'correct_category_key' => 'fruit', 'correct_count' => 1, 'correct_percentage' => 33.33, 'category_counts' => [1, 2]],
            ['id' => quizKey(62), 'correct_category_key' => 'fruit', 'correct_count' => 2, 'correct_percentage' => 66.67, 'category_counts' => [2, 1]],
            ['id' => quizKey(63), 'correct_category_key' => 'veg', 'correct_count' => 1, 'correct_percentage' => 33.33, 'category_counts' => [1, 1]],
            ['id' => quizKey(64), 'correct_category_key' => 'veg', 'correct_count' => 1, 'correct_percentage' => 33.33, 'category_counts' => [1, 1]],
        ],
        'correct' => ['categories' => [
            ['key' => 'fruit', 'item_ids' => [quizKey(61), quizKey(62)]],
            ['key' => 'veg', 'item_ids' => [quizKey(63), quizKey(64)]],
        ]],
    ])
        ->and($type->aggregate(catConfig(), catOptions(), $answers->reverse()->values()))->toBe($aggregate);
});
