<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quiz\PickAnswerSingleSlideType;

require_once __DIR__ . '/QuizTypeHelpers.php';

/** Options 11..13; only 12 is correct: players pick one. */
function pasOptions(): array
{
    return [
        quizOption(11, 1, 'Paris', ['colour' => 'blue'], false),
        quizOption(12, 2, 'Lyon', [], true),
        quizOption(13, 3, 'Nice', [], null),
    ];
}

/** Options 11..14; 12 is correct (column), 13 only through payload.is_correct with a null column: players select several. */
function pasTwoCorrect(): array
{
    return [
        quizOption(11, 1, 'Paris', ['colour' => 'blue'], false),
        quizOption(12, 2, 'Lyon', [], true),
        quizOption(13, 3, 'Nice', ['is_correct' => true], null),
        quizOption(14, 4, 'Metz', [], null),
    ];
}

it('is registered as a scored, hidden-until-reveal quiz type', function () {
    $type = quizType('pick_answer_single');

    expect($type)->toBeInstanceOf(PickAnswerSingleSlideType::class)
        ->and($type->products())->toBe(['quiz'])
        ->and($type->category())->toBe(SlideTypeContract::CATEGORY_POLL)
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_HIDDEN)
        ->and($type->acceptsAnswers())->toBeTrue()
        ->and(app(SlideTypeRegistry::class)->forProduct('quiz'))->toHaveKey('pick_answer_single')
        ->and(app(SlideTypeRegistry::class)->forProduct('quest'))->not->toHaveKey('pick_answer_single');
});

it('seeds two empty options, 20 s and 50/100 points with the speed bonus', function () {
    $type = quizType('pick_answer_single');

    expect($type->defaultOptions())->toBe([['label' => null, 'payload' => []], ['label' => null, 'payload' => []]])
        ->and($type->defaultConfig())->toBe([])
        ->and($type->validateConfig($type->defaultConfig()))->toBe([])
        ->and($type->validateConfig(['junk' => 1, 'scoring' => ['points_max' => 9999], 'media' => ['url' => 'x']]))->toBe([])
        ->and($type->defaultSlideAttributes())->toBe(['time_limit_seconds' => 20, 'points_min' => 50, 'points_max' => 100, 'speed_bonus_enabled' => true]);
});

it('accepts one option of the run', function () {
    expect(quizType('pick_answer_single')->validateAnswer(['option_id' => '12', 'extra' => 1], [], pasOptions()))->toBe(['option_id' => 12])
        ->and(quizType('pick_answer_single')->validateAnswer(['option_ids' => [11]], [], pasOptions()))->toBe(['option_id' => 11]);
});

it('rejects answers that are not one option of the run', function (array $payload) {
    quizRejects(fn () => quizType('pick_answer_single')->validateAnswer($payload, [], pasOptions()));
})->with([
    'unknown id' => [['option_id' => 99]],
    'missing' => [[]],
    'null' => [['option_id' => null]],
    'list' => [['option_id' => [11]]],
    'text' => [['option_id' => 'Paris']],
    'float' => [['option_id' => 11.5]],
    'two in the multi shape' => [['option_ids' => [11, 12]]],
]);

it('scores right, wrong, empty and malformed answers', function (array $payload, int $points, bool $correct, float $credit) {
    $score = quizType('pick_answer_single')->score($payload, quizScoring(50, 100, false), pasOptions(), 4000);

    expect($score)->toEqual(new ScoreResult($points, $correct, $credit));
})->with([
    'correct (column)' => [['option_id' => 12], 100, true, 1.0],
    'wrong' => [['option_id' => 11], 0, false, 0.0],
    'not marked' => [['option_id' => 13], 0, false, 0.0],
    'unknown option' => [['option_id' => 99], 0, false, 0.0],
    'empty' => [[], 0, false, 0.0],
    'malformed' => [['option_id' => ['x']], 0, false, 0.0],
]);

it('counts a payload is_correct flag when the column is null', function () {
    $options = [quizOption(11, 1, 'A', [], null), quizOption(12, 2, 'B', ['is_correct' => true], null)];

    expect(quizType('pick_answer_single')->score(['option_id' => 12], quizScoring(), $options, 0)->pointsAwarded)->toBe(100)
        ->and(quizType('pick_answer_single')->correctAnswer([], $options))->toBe(['option_ids' => [12]]);
});

it('lets the column override a payload flag', function () {
    $options = [quizOption(11, 1, 'A', ['is_correct' => true], false), quizOption(12, 2, 'B', [], true)];

    expect(quizType('pick_answer_single')->score(['option_id' => 11], quizScoring(), $options, 0)->pointsAwarded)->toBe(0)
        ->and(quizType('pick_answer_single')->correctAnswer([], $options))->toBe(['option_ids' => [12]]);
});

it('applies the speed bonus to a correct answer', function () {
    $type = quizType('pick_answer_single');

    expect($type->score(['option_id' => 12], quizScoring(50, 100, true, 20), pasOptions(), 0)->pointsAwarded)->toBe(100)
        ->and($type->score(['option_id' => 12], quizScoring(50, 100, true, 20), pasOptions(), 10_000)->pointsAwarded)->toBe(75)
        ->and($type->score(['option_id' => 12], quizScoring(50, 100, true, 20), pasOptions(), 25_000)->pointsAwarded)->toBe(50)
        ->and($type->score(['option_id' => 11], quizScoring(50, 100, true, 20), pasOptions(), 0)->pointsAwarded)->toBe(0);
});

it('shows participants the options without correctness', function () {
    $type = quizType('pick_answer_single');
    $run = quizRun('pick_answer_single', quizScoring(), pasOptions());

    $view = quizAssertNoLeak($type, $run);

    expect($view['options'])->toBe([
        ['id' => 11, 'position' => 1, 'label' => 'Paris', 'image_url' => 'https://cdn.example.test/11.png', 'payload' => ['colour' => 'blue']],
        ['id' => 12, 'position' => 2, 'label' => 'Lyon', 'image_url' => 'https://cdn.example.test/12.png', 'payload' => []],
        ['id' => 13, 'position' => 3, 'label' => 'Nice', 'image_url' => 'https://cdn.example.test/13.png', 'payload' => []],
    ])
        ->and($view['config'])->toBe(quizScoring() + ['multiple_answers' => false])
        ->and($view['reveal_model'])->toBe(SlideTypeContract::REVEAL_HIDDEN);
});

it('gives the presenter the answer key and the aggregate', function () {
    $type = quizType('pick_answer_single');
    $run = quizRun('pick_answer_single', quizScoring(), pasTwoCorrect());

    $view = $type->serializeForPresenter($run, ['total_responses' => 2]);

    expect($view['answer_key'])->toBe(['option_ids' => [12, 13]])
        ->and($view['config']['multiple_answers'])->toBeTrue()
        ->and($view['aggregate'])->toBe(['total_responses' => 2])
        ->and($view['options'][1])->toMatchArray(['id' => 12, 'option_id' => 12, 'is_correct' => true, 'payload' => []])
        ->and($view['options'][2])->toMatchArray(['id' => 13, 'option_id' => 13, 'is_correct' => true, 'payload' => ['is_correct' => true]])
        ->and($view['options'][0]['is_correct'])->toBeFalse();
});

it('aggregates counts, correctness and the correct block deterministically', function () {
    $type = quizType('pick_answer_single');
    $answers = collect([
        quizAnswer(['option_id' => 12], 1),
        quizAnswer(['option_id' => 11], 2),
        quizAnswer(['option_id' => 12], 3),
        quizAnswer(['option_id' => 99], 4),
        quizAnswer(['nope' => true], 5),
    ]);

    $aggregate = $type->aggregate([], pasOptions(), $answers);

    expect($aggregate)->toBe([
        'total_responses' => 4,
        'correct_responses' => 2,
        'partially_correct_responses' => 0,
        'incorrect_responses' => 2,
        'correct_percentage' => 50.0,
        'options' => [
            ['option_id' => 11, 'count' => 1, 'percentage' => 25.0, 'is_correct' => false],
            ['option_id' => 12, 'count' => 2, 'percentage' => 50.0, 'is_correct' => true],
            ['option_id' => 13, 'count' => 0, 'percentage' => 0.0, 'is_correct' => false],
        ],
        'correct' => ['option_ids' => [12]],
    ])
        ->and($type->aggregate([], pasOptions(), $answers->reverse()->values()))->toBe($aggregate)
        ->and($type->aggregate([], array_reverse(pasOptions()), $answers))->toBe($aggregate)
        ->and($type->aggregate([], pasOptions(), collect())['correct_percentage'])->toBe(0.0);
});

/* --- several correct answers: players select them all (all or nothing) --- */

it('asks for every correct answer when more than one is marked', function () {
    $type = quizType('pick_answer_single');
    $view = quizAssertNoLeak($type, quizRun('pick_answer_single', quizScoring(), pasTwoCorrect()));

    expect($type->multipleAnswers(pasTwoCorrect()))->toBeTrue()
        ->and($type->multipleAnswers(pasOptions()))->toBeFalse()
        ->and($view['config'])->toBe(quizScoring() + ['multiple_answers' => true])
        ->and(array_column($view['options'], 'id'))->toBe([11, 12, 13, 14]);
});

it('takes a selection of distinct options, stored in option order', function () {
    $type = quizType('pick_answer_single');

    expect($type->validateAnswer(['option_ids' => [13, '12']], [], pasTwoCorrect()))->toBe(['option_ids' => [12, 13]])
        // A lone option_id (an older phone) is a one-item selection.
        ->and($type->validateAnswer(['option_id' => 14], [], pasTwoCorrect()))->toBe(['option_ids' => [14]]);
});

it('rejects selections that are not distinct options of the run', function (array $payload) {
    quizRejects(fn () => quizType('pick_answer_single')->validateAnswer($payload, [], pasTwoCorrect()));
})->with([
    'unknown id' => [['option_ids' => [12, 99]]],
    'duplicate' => [['option_ids' => [12, 12]]],
    'empty' => [['option_ids' => []]],
    'missing' => [[]],
    'not a list' => [['option_ids' => ['a' => 12]]],
    'too many' => [['option_ids' => [11, 12, 13, 14, 11]]],
    'text ids' => [['option_ids' => ['Lyon']]],
]);

it('scores a selection all or nothing', function (array $payload, int $points, bool $correct) {
    $score = quizType('pick_answer_single')->score($payload, quizScoring(50, 100, false), pasTwoCorrect(), 3000);

    expect($score)->toEqual(new ScoreResult($points, $correct, $correct ? 1.0 : 0.0));
})->with([
    'exactly the correct set' => [['option_ids' => [12, 13]], 100, true],
    'in another order' => [['option_ids' => [13, 12]], 100, true],
    'subset' => [['option_ids' => [12]], 0, false],
    'superset' => [['option_ids' => [11, 12, 13]], 0, false],
    'select all' => [['option_ids' => [11, 12, 13, 14]], 0, false],
    'only wrong ones' => [['option_ids' => [11, 14]], 0, false],
    'malformed' => [['option_ids' => 'all'], 0, false],
    // Runs from before multiple_answers stored one pick: any correct one scored.
    'a stored single pick' => [['option_id' => 13], 100, true],
]);

it('aggregates selections and single picks per option', function () {
    $answers = collect([
        quizAnswer(['option_ids' => [12, 13]], 1),
        quizAnswer(['option_ids' => [12]], 2),
        quizAnswer(['option_id' => 14], 3),
        quizAnswer(['option_ids' => 'x'], 4),
    ]);

    expect(quizType('pick_answer_single')->aggregate([], pasTwoCorrect(), $answers))->toBe([
        'total_responses' => 3,
        'correct_responses' => 1,
        'partially_correct_responses' => 0,
        'incorrect_responses' => 2,
        'correct_percentage' => 33.33,
        'options' => [
            ['option_id' => 11, 'count' => 0, 'percentage' => 0.0, 'is_correct' => false],
            ['option_id' => 12, 'count' => 2, 'percentage' => 66.67, 'is_correct' => true],
            ['option_id' => 13, 'count' => 1, 'percentage' => 33.33, 'is_correct' => true],
            ['option_id' => 14, 'count' => 1, 'percentage' => 33.33, 'is_correct' => false],
        ],
        'correct' => ['option_ids' => [12, 13]],
    ]);
});

it('stands in for the retired pick_answer_multi when authoring', function () {
    expect(quizType('pick_answer_multi')->replacedBy())->toBe('pick_answer_single')
        ->and(app(\App\Deck\Authoring\SlideInput::class)->supportedType('quiz', 'pick_answer_multi')->key())->toBe('pick_answer_single');
});
