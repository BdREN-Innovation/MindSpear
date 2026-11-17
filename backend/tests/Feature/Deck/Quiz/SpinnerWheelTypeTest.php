<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\Types\Quiz\SpinnerWheelSlideType;
use Illuminate\Validation\ValidationException;
use Random\Engine\Mt19937;
use Random\Randomizer;

require_once __DIR__ . '/QuizTypeHelpers.php';

/** Weights 1, 3 (as text), invalid (= 1), 0 (= 1): segments of 60°, 180°, 60°, 60°. */
function swOptions(): array
{
    return [
        quizOption(71, 1, 'Alice'),
        quizOption(72, 2, 'Bob', ['weight' => '3']),
        quizOption(73, 3, 'Cara', ['weight' => 'heavy']),
        quizOption(74, 4, 'Dan', ['weight' => 0]),
    ];
}

it('is a quiz engagement slide that takes no answers and scores nothing', function () {
    $type = quizType('spinner_wheel');

    expect($type)->toBeInstanceOf(SpinnerWheelSlideType::class)
        ->and($type->products())->toBe(['quiz'])
        ->and($type->category())->toBe(SlideTypeContract::CATEGORY_INTERACTIVE)
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_NONE)
        ->and($type->acceptsAnswers())->toBeFalse()
        ->and($type->defaultOptions())->toBe(array_fill(0, 4, ['label' => null, 'payload' => []]))
        ->and($type->validateConfig(['junk' => 1]))->toBe([])
        ->and($type->defaultSlideAttributes())->toBe(['time_limit_seconds' => null, 'points_min' => null, 'points_max' => null, 'speed_bonus_enabled' => null])
        ->and($type->score(['option_id' => 71], quizScoring(), swOptions(), 0))->toEqual(ScoreResult::zero())
        ->and($type->aggregate([], swOptions(), collect([quizAnswer(['option_id' => 71])])))->toBe([]);

    quizRejects(fn () => $type->validateAnswer(['option_id' => 71], [], swOptions()));
});

it('validates entry weights', function () {
    $type = quizType('spinner_wheel');

    expect($type->validateOptionPayload(['weight' => '2.5']))->toBe(['weight' => 2.5])
        ->and($type->validateOptionPayload([]))->toBe([]);

    quizRejects(fn () => $type->validateOptionPayload(['weight' => 0]));
    quizRejects(fn () => $type->validateOptionPayload(['weight' => 101]));
    quizRejects(fn () => $type->validateOptionPayload(['weight' => 'heavy']));
});

it('lays the segments out clockwise, sized by weight', function () {
    expect(quizType('spinner_wheel')->segments(swOptions()))->toBe([
        ['option_id' => 71, 'start_angle' => 0.0, 'end_angle' => 60.0],
        ['option_id' => 72, 'start_angle' => 60.0, 'end_angle' => 240.0],
        ['option_id' => 73, 'start_angle' => 240.0, 'end_angle' => 300.0],
        ['option_id' => 74, 'start_angle' => 300.0, 'end_angle' => 360.0],
    ]);
});

it('shows participants the wheel and its segments', function () {
    $view = quizType('spinner_wheel')->serializeForParticipant(quizRun('spinner_wheel', [], swOptions()));

    expect(array_column($view['options'], 'id'))->toBe([71, 72, 73, 74])
        ->and($view['segments'])->toHaveCount(4)
        ->and($view['accepts_answers'])->toBeFalse()
        ->and($view)->not->toHaveKey('aggregate');
});

it('spins to an entry inside its segment, away from the edges', function () {
    $type = quizType('spinner_wheel');
    $run = quizRun('spinner_wheel', [], swOptions());
    $segments = collect($type->segments(swOptions()))->keyBy('option_id');
    $random = new Randomizer(new Mt19937(42));
    $wins = array_fill_keys([71, 72, 73, 74], 0);

    foreach (range(1, 2000) as $i) {
        $spin = $type->spin($run, $random);
        $segment = $segments[$spin['option_id']];
        $margin = ($segment['end_angle'] - $segment['start_angle']) * 0.1;

        expect(array_keys($spin))->toBe(['option_id', 'target_angle'])
            ->and($spin['target_angle'])->toBeGreaterThanOrEqual($segment['start_angle'] + $margin - 0.01)
            ->and($spin['target_angle'])->toBeLessThanOrEqual($segment['end_angle'] - $margin + 0.01);
        $wins[$spin['option_id']]++;
    }

    // Weight 3 of 6: about half the spins.
    expect($wins[72])->toBeGreaterThan(850)->toBeLessThan(1150)
        ->and($wins[71])->toBeGreaterThan(200)
        ->and($wins[74])->toBeGreaterThan(200);
});

it('always lands on the only entry and refuses an empty wheel', function () {
    $type = quizType('spinner_wheel');

    expect($type->spin(quizRun('spinner_wheel', [], [quizOption(9, 1, 'Solo')]))['option_id'])->toBe(9)
        ->and(fn () => $type->spin(quizRun('spinner_wheel', [], [])))->toThrow(ValidationException::class);
});
