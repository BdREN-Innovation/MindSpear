<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\Types\Quiz\PickAnswerMultiSlideType;

require_once __DIR__ . '/QuizTypeHelpers.php';

/** Options 21..24; 21 and 23 are correct. */
function pamOptions(): array
{
    return [
        quizOption(21, 1, 'Mercury', [], true),
        quizOption(22, 2, 'Moon', [], false),
        quizOption(23, 3, 'Venus', ['is_correct' => true], true),
        quizOption(24, 4, 'Titan', [], null),
    ];
}

it('is registered as a scored quiz type with no settings', function () {
    $type = quizType('pick_answer_multi');

    expect($type)->toBeInstanceOf(PickAnswerMultiSlideType::class)
        ->and($type->products())->toBe(['quiz'])
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_HIDDEN)
        ->and($type->defaultOptions())->toHaveCount(3)
        ->and($type->defaultConfig())->toBe([])
        ->and($type->validateConfig([]))->toBe([])
        ->and($type->defaultSlideAttributes())->toBe(['time_limit_seconds' => 30, 'points_min' => 50, 'points_max' => 100, 'speed_bonus_enabled' => true]);
});

it('accepts and drops a legacy partial_credit setting instead of rejecting the slide', function (mixed $value) {
    expect(quizType('pick_answer_multi')->validateConfig(['partial_credit' => $value, 'junk' => 1]))->toBe([]);
})->with([true, false, '0', 'sometimes', null]);

it('accepts distinct option ids and stores them in option order', function () {
    expect(quizType('pick_answer_multi')->validateAnswer(['option_ids' => [23, '21']], [], pamOptions()))->toBe(['option_ids' => [21, 23]]);
});

it('rejects answers that are not distinct options of the run', function (array $payload) {
    quizRejects(fn () => quizType('pick_answer_multi')->validateAnswer($payload, [], pamOptions()));
})->with([
    'unknown id' => [['option_ids' => [21, 99]]],
    'duplicate' => [['option_ids' => [21, 21]]],
    'empty' => [['option_ids' => []]],
    'missing' => [[]],
    'not a list' => [['option_ids' => ['a' => 21]]],
    'scalar' => [['option_ids' => 21]],
    'too many' => [['option_ids' => [21, 22, 23, 24, 21]]],
    'text ids' => [['option_ids' => ['Mercury']]],
]);

it('scores all or nothing: only exactly the correct set earns points', function (array $payload, int $points, bool $correct, float $credit) {
    $score = quizType('pick_answer_multi')->score($payload, quizScoring(50, 100, false), pamOptions(), 3000);

    expect($score)->toEqual(new ScoreResult($points, $correct, $credit));
})->with([
    'exactly the correct set' => [['option_ids' => [21, 23]], 100, true, 1.0],
    'exact set in another order' => [['option_ids' => [23, 21]], 100, true, 1.0],
    'subset' => [['option_ids' => [21]], 0, false, 0.0],
    'subset plus a wrong one' => [['option_ids' => [21, 22]], 0, false, 0.0],
    'superset' => [['option_ids' => [21, 22, 23]], 0, false, 0.0],
    'select all' => [['option_ids' => [21, 22, 23, 24]], 0, false, 0.0],
    'only wrong ones' => [['option_ids' => [22, 24]], 0, false, 0.0],
    'empty' => [['option_ids' => []], 0, false, 0.0],
    'malformed' => [['option_ids' => 'all'], 0, false, 0.0],
    'missing' => [[], 0, false, 0.0],
]);

it('ignores a legacy partial_credit setting when scoring', function () {
    $score = quizType('pick_answer_multi')->score(['option_ids' => [21]], ['partial_credit' => true] + quizScoring(50, 100, false), pamOptions(), 0);

    expect($score)->toEqual(new ScoreResult(0, false, 0.0));
});

it('applies the speed bonus to an exact answer, rounding once', function () {
    $type = quizType('pick_answer_multi');
    $config = quizScoring(50, 100, true, 20);

    // 5 s of 20 s: earnable 87.5.
    expect($type->score(['option_ids' => [21, 23]], $config, pamOptions(), 5000))->toEqual(new ScoreResult(88, true, 1.0))
        ->and($type->score(['option_ids' => [21, 23]], $config, pamOptions(), 25_000))->toEqual(new ScoreResult(50, true, 1.0))
        ->and($type->score(['option_ids' => [21]], $config, pamOptions(), 0))->toEqual(new ScoreResult(0, false, 0.0));
});

it('scores nothing when no option is marked correct', function () {
    $options = [quizOption(1, 1, 'A', [], false), quizOption(2, 2, 'B', [], null)];

    expect(quizType('pick_answer_multi')->score(['option_ids' => [1, 2]], quizScoring(), $options, 0))->toEqual(new ScoreResult(0, false, 0.0));
});

it('never shows participants which options are correct', function () {
    $view = quizAssertNoLeak(quizType('pick_answer_multi'), quizRun('pick_answer_multi', quizScoring(), pamOptions()));

    expect(array_column($view['options'], 'id'))->toBe([21, 22, 23, 24])
        ->and($view['options'][2]['payload'])->toBe([])
        ->and($view['config'])->toBe(quizScoring());
});

it('aggregates selections per option, with no partial responses, deterministically', function () {
    $type = quizType('pick_answer_multi');
    $answers = collect([
        quizAnswer(['option_ids' => [21, 23]], 1),
        quizAnswer(['option_ids' => [21]], 2),
        quizAnswer(['option_ids' => [22]], 3),
        quizAnswer(['option_ids' => 'x'], 4),
    ]);

    $aggregate = $type->aggregate([], pamOptions(), $answers);

    expect($aggregate)->toBe([
        'total_responses' => 3,
        'correct_responses' => 1,
        'partially_correct_responses' => 0,
        'incorrect_responses' => 2,
        'correct_percentage' => 33.33,
        'options' => [
            ['option_id' => 21, 'count' => 2, 'percentage' => 66.67, 'is_correct' => true],
            ['option_id' => 22, 'count' => 1, 'percentage' => 33.33, 'is_correct' => false],
            ['option_id' => 23, 'count' => 1, 'percentage' => 33.33, 'is_correct' => true],
            ['option_id' => 24, 'count' => 0, 'percentage' => 0.0, 'is_correct' => false],
        ],
        'correct' => ['option_ids' => [21, 23]],
    ])
        ->and($type->aggregate([], pamOptions(), $answers->reverse()->values()))->toBe($aggregate);
});
