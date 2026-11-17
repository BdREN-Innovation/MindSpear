<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\Types\Quiz\TrueFalseSlideType;

require_once __DIR__ . '/QuizTypeHelpers.php';

/** True (31, correct) and False (32). */
function tfOptions(): array
{
    return [quizOption(31, 1, 'True', [], true), quizOption(32, 2, 'False', [], false)];
}

it('is a quiz type seeded with True and False, 20 s and 50/100 points', function () {
    $type = quizType('true_false');

    expect($type)->toBeInstanceOf(TrueFalseSlideType::class)
        ->and($type->products())->toBe(['quiz'])
        ->and($type->defaultOptions())->toBe([['label' => 'True', 'payload' => []], ['label' => 'False', 'payload' => []]])
        ->and($type->validateConfig(['junk' => 1]))->toBe([])
        ->and($type->defaultSlideAttributes())->toBe(['time_limit_seconds' => 20, 'points_min' => 50, 'points_max' => 100, 'speed_bonus_enabled' => true]);
});

it('takes one pick and scores it all or nothing', function () {
    $type = quizType('true_false');

    expect($type->validateAnswer(['option_id' => '31'], [], tfOptions()))->toBe(['option_id' => 31])
        ->and($type->score(['option_id' => 31], quizScoring(50, 100, false), tfOptions(), 0))->toEqual(new ScoreResult(100, true, 1.0))
        ->and($type->score(['option_id' => 32], quizScoring(50, 100, false), tfOptions(), 0))->toEqual(new ScoreResult(0, false, 0.0));
    quizRejects(fn () => $type->validateAnswer(['option_id' => 99], [], tfOptions()));
});

it('stays a one-pick question even with both marked correct', function () {
    $both = [quizOption(31, 1, 'True', [], true), quizOption(32, 2, 'False', [], true)];
    $view = quizAssertNoLeak(quizType('true_false'), quizRun('true_false', quizScoring(), $both));

    expect($view['config']['multiple_answers'])->toBeFalse()
        ->and(quizType('true_false')->validateAnswer(['option_id' => 32], [], $both))->toBe(['option_id' => 32])
        ->and(array_column($view['options'], 'label'))->toBe(['True', 'False']);
});

it('aggregates like a pick answer', function () {
    $aggregate = quizType('true_false')->aggregate([], tfOptions(), collect([quizAnswer(['option_id' => 31], 1), quizAnswer(['option_id' => 32], 2)]));

    expect($aggregate['correct_responses'])->toBe(1)
        ->and($aggregate['options'])->toBe([
            ['option_id' => 31, 'count' => 1, 'percentage' => 50.0, 'is_correct' => true],
            ['option_id' => 32, 'count' => 1, 'percentage' => 50.0, 'is_correct' => false],
        ])
        ->and($aggregate['correct'])->toBe(['option_ids' => [31]]);
});
