<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\Types\Quiz\MatchPairsSlideType;
use App\Deck\Slides\Types\Quiz\QuizOptions;

require_once __DIR__ . '/QuizTypeHelpers.php';

/** Pairs p1 (41-42), p2 (43-44), p3 (45-46); 47 has no partner and 48 no valid side: both ignored. */
function mpOptions(): array
{
    return [
        quizOption(41, 1, 'France', ['side' => 'left', 'pair_key' => 'p1']),
        quizOption(42, 2, 'Paris', ['side' => 'right', 'pair_key' => 'p1']),
        quizOption(43, 3, 'Japan', ['side' => 'left', 'pair_key' => 'p2']),
        quizOption(44, 4, 'Tokyo', ['side' => 'right', 'pair_key' => 'p2']),
        quizOption(45, 5, 'Peru', ['side' => 'left', 'pair_key' => 'p3']),
        quizOption(46, 6, 'Lima', ['side' => 'right', 'pair_key' => 'p3']),
        quizOption(47, 7, 'Orphan', ['side' => 'left', 'pair_key' => 'p9']),
        quizOption(48, 8, 'Sideless', ['side' => 'middle', 'pair_key' => 'p1']),
    ];
}

function mpPair(int $left, int $right): array
{
    return ['left_id' => quizKey($left), 'right_id' => quizKey($right)];
}

it('is registered as a scored quiz type seeded with three empty pairs', function () {
    $type = quizType('match_pairs');

    expect($type)->toBeInstanceOf(MatchPairsSlideType::class)
        ->and($type->products())->toBe(['quiz'])
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_HIDDEN)
        ->and($type->defaultOptions())->toBe([
            ['label' => null, 'payload' => ['side' => 'left', 'pair_key' => 'p1']],
            ['label' => null, 'payload' => ['side' => 'right', 'pair_key' => 'p1']],
            ['label' => null, 'payload' => ['side' => 'left', 'pair_key' => 'p2']],
            ['label' => null, 'payload' => ['side' => 'right', 'pair_key' => 'p2']],
            ['label' => null, 'payload' => ['side' => 'left', 'pair_key' => 'p3']],
            ['label' => null, 'payload' => ['side' => 'right', 'pair_key' => 'p3']],
        ])
        ->and($type->validateConfig(['junk' => 1]))->toBe([])
        ->and($type->defaultSlideAttributes()['time_limit_seconds'])->toBe(45);
});

it('validates option payloads', function () {
    $type = quizType('match_pairs');

    expect($type->validateOptionPayload(['side' => 'right', 'pair_key' => 'pair-7', 'junk' => 1]))->toBe(['side' => 'right', 'pair_key' => 'pair-7']);

    quizRejects(fn () => $type->validateOptionPayload(['side' => 'up', 'pair_key' => 'p1']));
    quizRejects(fn () => $type->validateOptionPayload(['side' => 'left', 'pair_key' => '12']));
    quizRejects(fn () => $type->validateOptionPayload(['side' => 'left']));
});

it('accepts known left/right keys, each once, in the participant order', function () {
    $payload = ['pairs' => [mpPair(43, 46), mpPair(41, 42)]];

    expect(quizType('match_pairs')->validateAnswer($payload, [], mpOptions()))->toBe($payload);
});

it('rejects answers with unknown, reused or misplaced keys', function (Closure $payload) {
    quizRejects(fn () => quizType('match_pairs')->validateAnswer($payload(), [], mpOptions()));
})->with([
    'raw option ids' => [fn () => ['pairs' => [['left_id' => 41, 'right_id' => 42]]]],
    'unknown key' => [fn () => ['pairs' => [['left_id' => 'kdeadbeef0000', 'right_id' => quizKey(42)]]]],
    'ignored option' => [fn () => ['pairs' => [mpPair(47, 42)]]],
    'right key on the left' => [fn () => ['pairs' => [mpPair(42, 41)]]],
    'left used twice' => [fn () => ['pairs' => [mpPair(41, 42), mpPair(41, 44)]]],
    'right used twice' => [fn () => ['pairs' => [mpPair(41, 42), mpPair(43, 42)]]],
    'empty' => [fn () => ['pairs' => []]],
    'missing' => [fn () => []],
    'pair not an object' => [fn () => ['pairs' => [quizKey(41)]]],
    'more pairs than exist' => [fn () => ['pairs' => [mpPair(41, 42), mpPair(43, 44), mpPair(45, 46), mpPair(47, 42)]]],
]);

it('scores correct pairs over total pairs', function (Closure $payload, int $points, bool $correct, float $credit) {
    $score = quizType('match_pairs')->score($payload(), quizScoring(50, 100, false), mpOptions(), 2000);

    expect($score)->toEqual(new ScoreResult($points, $correct, $credit));
})->with([
    'all three' => [fn () => ['pairs' => [mpPair(45, 46), mpPair(41, 42), mpPair(43, 44)]], 100, true, 1.0],
    'two of three' => [fn () => ['pairs' => [mpPair(41, 42), mpPair(43, 44), mpPair(45, 46 - 4)]], 67, false, 0.6667],
    'one of three, others unmatched' => [fn () => ['pairs' => [mpPair(43, 44)]], 33, false, 0.3333],
    'all wrong' => [fn () => ['pairs' => [mpPair(41, 44), mpPair(43, 46), mpPair(45, 42)]], 0, false, 0.0],
    'reused right counts once' => [fn () => ['pairs' => [mpPair(41, 42), mpPair(43, 42)]], 33, false, 0.3333],
    'empty' => [fn () => ['pairs' => []], 0, false, 0.0],
    'malformed' => [fn () => ['pairs' => 'all'], 0, false, 0.0],
    'garbage entries' => [fn () => ['pairs' => [null, 'x', ['left_id' => 1]]], 0, false, 0.0],
]);

it('hides pair keys and real ids from participants and shuffles the right column by run', function () {
    $type = quizType('match_pairs');
    $run = quizRun('match_pairs', quizScoring(), mpOptions(), 101);

    $view = quizAssertNoLeak($type, $run, ['p1', 'p2', 'p3', '"id":41', '"id":42', '"id":46', 'Orphan', 'Sideless']);
    $left = array_values(array_filter($view['options'], fn ($o) => $o['payload']['side'] === 'left'));
    $right = array_values(array_filter($view['options'], fn ($o) => $o['payload']['side'] === 'right'));

    expect($view['options'])->toHaveCount(6)
        ->and(array_column($view['options'], 'position'))->toBe([1, 2, 3, 4, 5, 6])
        ->and(array_column($left, 'id'))->toBe([quizKey(41), quizKey(43), quizKey(45)])
        ->and(array_column($left, 'label'))->toBe(['France', 'Japan', 'Peru'])
        // Keyed shuffle of the run (QuizOptions::shuffle); aligned with the left column is as likely as any order.
        ->and(array_column($right, 'id'))->toBe(array_map(
            fn (array $o) => quizKey($o['id']),
            QuizOptions::shuffle(array_values(array_filter(QuizOptions::sorted(mpOptions()), fn ($o) => in_array($o['id'], [42, 44, 46], true))), 101),
        ))
        ->and(array_column($right, 'id'))->toEqualCanonicalizing([quizKey(42), quizKey(44), quizKey(46)])
        ->and($view['options'][0])->toBe(['id' => quizKey(41), 'position' => 1, 'label' => 'France', 'image_url' => 'https://cdn.example.test/41.png', 'payload' => ['side' => 'left']]);

    // Same run, same order; the order depends on the run id only.
    $again = $type->serializeForParticipant(quizRun('match_pairs', quizScoring(), array_reverse(mpOptions()), 101));
    expect(array_column($again['options'], 'id'))->toBe(array_column($view['options'], 'id'));

    $orders = collect(range(1, 12))->map(fn (int $id) => implode(',', array_column($type->serializeForParticipant(quizRun('match_pairs', [], mpOptions(), $id))['options'], 'id')))->unique();
    expect($orders->count())->toBeGreaterThan(1);
});

it('gives the presenter real ids, pair keys and the answer key', function () {
    $view = quizType('match_pairs')->serializeForPresenter(quizRun('match_pairs', quizScoring(), mpOptions()), ['x' => 1]);

    expect($view['answer_key'])->toBe(['pairs' => [mpPair(41, 42), mpPair(43, 44), mpPair(45, 46)]])
        ->and($view['options'][0])->toMatchArray(['id' => quizKey(41), 'option_id' => 41, 'payload' => ['side' => 'left', 'pair_key' => 'p1']])
        ->and($view['aggregate'])->toBe(['x' => 1]);
});

it('aggregates per-pair correctness and a connection matrix, deterministically', function () {
    $type = quizType('match_pairs');
    $answers = collect([
        quizAnswer(['pairs' => [mpPair(41, 42), mpPair(43, 44), mpPair(45, 46)]], 1),
        quizAnswer(['pairs' => [mpPair(41, 44), mpPair(43, 42)]], 2),
        quizAnswer(['pairs' => [mpPair(41, 42)]], 3),
        quizAnswer(['nope' => 1], 4),
    ]);

    $aggregate = $type->aggregate([], mpOptions(), $answers);

    expect($aggregate)->toBe([
        'total_responses' => 3,
        'correct_responses' => 1,
        'partially_correct_responses' => 1,
        'incorrect_responses' => 1,
        'correct_percentage' => 33.33,
        'pairs' => [
            ['left_id' => quizKey(41), 'right_id' => quizKey(42), 'correct_count' => 2, 'correct_percentage' => 66.67],
            ['left_id' => quizKey(43), 'right_id' => quizKey(44), 'correct_count' => 1, 'correct_percentage' => 33.33],
            ['left_id' => quizKey(45), 'right_id' => quizKey(46), 'correct_count' => 1, 'correct_percentage' => 33.33],
        ],
        // Rows: lefts 41, 43, 45; columns: rights 42, 44, 46 (pairs order).
        'connection_counts' => [
            [2, 1, 0],
            [1, 1, 0],
            [0, 0, 1],
        ],
        'correct' => ['pairs' => [mpPair(41, 42), mpPair(43, 44), mpPair(45, 46)]],
    ])
        ->and($type->aggregate([], mpOptions(), $answers->reverse()->values()))->toBe($aggregate)
        ->and($type->aggregate([], array_reverse(mpOptions()), $answers))->toBe($aggregate);
});
