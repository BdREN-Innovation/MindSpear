<?php

use App\Deck\Scoring\QuizScoring;
use App\Deck\Scoring\ScoringService;
use App\Deck\Slides\ScoreResult;
use App\Models\Deck\DeckSessionSlideRun;

require_once __DIR__ . '/QuizTypeHelpers.php';

/** A pick_answer_single run (option 2 correct) with $scoring as its config_snapshot.scoring. */
function ssRun(?array $scoring, ?int $runLimit = 20, string $type = 'pick_answer_single', array $config = []): DeckSessionSlideRun
{
    $options = [quizOption(1, 1, 'A', [], false), quizOption(2, 2, 'B', [], true), quizOption(3, 3, 'C', [], true)];
    $run = quizRun($type, $config + ($scoring === null ? [] : ['scoring' => $scoring]), $options);
    $run->time_limit_seconds = $runLimit;

    return $run;
}

function ssScore(DeckSessionSlideRun $run, int $ms, array $payload = ['option_id' => 2]): ScoreResult
{
    return app(ScoringService::class)->score($run, $payload, $ms);
}

it('interpolates between points_max at 0 ms and points_min at the time limit', function (int $ms, int $points) {
    $run = ssRun(['points_min' => 50, 'points_max' => 100, 'speed_bonus_enabled' => true, 'time_limit_seconds' => 20]);

    expect(ssScore($run, $ms))->toEqual(new ScoreResult($points, true, 1.0));
})->with([
    '0 ms' => [0, 100],
    'negative time counts as 0' => [-500, 100],
    '1 ms' => [1, 100],
    'quarter' => [5_000, 88],          // 87.5, half up
    'half' => [10_000, 75],
    'three quarters' => [15_000, 63],  // 62.5, half up
    'just before the limit' => [19_999, 50],
    'at the limit' => [20_000, 50],
    'over the limit (grace)' => [20_900, 50],
    'far over the limit' => [600_000, 50],
]);

it('gives points_max whenever the speed bonus is off', function (int $ms) {
    $run = ssRun(['points_min' => 10, 'points_max' => 80, 'speed_bonus_enabled' => false, 'time_limit_seconds' => 20]);

    expect(ssScore($run, $ms)->pointsAwarded)->toBe(80);
})->with([0, 10_000, 20_000, 99_000]);

it('gives points_max when the run has no time limit', function () {
    $run = ssRun(['points_min' => 50, 'points_max' => 100, 'speed_bonus_enabled' => true, 'time_limit_seconds' => null], runLimit: null);

    expect(ssScore($run, 0)->pointsAwarded)->toBe(100)
        ->and(ssScore($run, 3_600_000)->pointsAwarded)->toBe(100);
});

it('falls back to the run time limit, then to the default scoring', function () {
    // Snapshot without a limit: the run's 10 s timer drives the bonus.
    expect(ssScore(ssRun(['points_min' => 0, 'points_max' => 1000, 'speed_bonus_enabled' => true], runLimit: 10), 2_500)->pointsAwarded)->toBe(750)
        // No scoring block at all: 50 / 100 / speed bonus on.
        ->and(ssScore(ssRun(null, runLimit: 20), 10_000)->pointsAwarded)->toBe(75)
        // Nulls in the block are defaults too.
        ->and(ssScore(ssRun(['points_min' => null, 'points_max' => null, 'speed_bonus_enabled' => null, 'time_limit_seconds' => null], runLimit: null), 9_000)->pointsAwarded)->toBe(100)
        // The snapshot's own limit wins over the run's.
        ->and(ssScore(ssRun(['speed_bonus_enabled' => true, 'time_limit_seconds' => 40], runLimit: 10), 20_000)->pointsAwarded)->toBe(75);
});

it('keeps points_min within 0..points_max', function () {
    expect(ssScore(ssRun(['points_min' => 200, 'points_max' => 100, 'speed_bonus_enabled' => true, 'time_limit_seconds' => 20]), 20_000)->pointsAwarded)->toBe(100)
        ->and(ssScore(ssRun(['points_min' => -40, 'points_max' => 100, 'speed_bonus_enabled' => true, 'time_limit_seconds' => 20]), 20_000)->pointsAwarded)->toBe(0)
        ->and(QuizScoring::settings(['scoring' => ['points_min' => '30', 'points_max' => 'lots', 'speed_bonus_enabled' => 0, 'time_limit_seconds' => -5]]))
        ->toBe(['points_min' => 30, 'points_max' => 100, 'speed_bonus_enabled' => false, 'time_limit_seconds' => null]);
});

it('scores wrong answers 0 at any speed', function () {
    $run = ssRun(['points_min' => 50, 'points_max' => 100, 'speed_bonus_enabled' => true, 'time_limit_seconds' => 20]);

    expect(ssScore($run, 0, ['option_id' => 1]))->toEqual(new ScoreResult(0, false, 0.0))
        ->and(ssScore($run, 0, ['garbage' => true]))->toEqual(new ScoreResult(0, false, 0.0));
});

it('scores multi-select all or nothing on the time-weighted points', function () {
    $run = ssRun(['points_min' => 50, 'points_max' => 100, 'speed_bonus_enabled' => true, 'time_limit_seconds' => 20], type: 'pick_answer_multi', config: ['partial_credit' => true]);

    expect(ssScore($run, 10_000, ['option_ids' => [2, 3]]))->toEqual(new ScoreResult(75, true, 1.0))
        ->and(ssScore($run, 10_000, ['option_ids' => [2]]))->toEqual(new ScoreResult(0, false, 0.0))
        ->and(ssScore($run, 10_000, ['option_ids' => [1, 2, 3]]))->toEqual(new ScoreResult(0, false, 0.0));
});

it('applies partial credit to the time-weighted points where the type gives it', function () {
    $options = [quizOption(1, 1, 'A'), quizOption(2, 2, 'B'), quizOption(3, 3, 'C'), quizOption(4, 4, 'D')];
    $run = quizRun('correct_order', ['scoring' => ['points_min' => 50, 'points_max' => 100, 'speed_bonus_enabled' => true, 'time_limit_seconds' => 20]], $options);
    $order = fn (int ...$ids) => ['order' => array_map('quizKey', $ids)];

    // 75 * 0.5 = 37.5, rounded once.
    expect(ssScore($run, 10_000, $order(1, 2, 4, 3)))->toEqual(new ScoreResult(38, false, 0.5));
});

it('scores types that are not scored quiz types zero', function (string $type, array $payload) {
    $run = ssRun(['points_min' => 50, 'points_max' => 100, 'speed_bonus_enabled' => false, 'time_limit_seconds' => 20], type: $type);

    expect(ssScore($run, 0, $payload))->toEqual(ScoreResult::zero());
})->with([
    'quest poll' => ['poll_single', ['option_id' => 2]],
    'content' => ['heading', []],
    'leaderboard' => ['leaderboard', []],
    'spinner' => ['spinner_wheel', ['option_id' => 2]],
    'unknown type' => ['no_such_type', ['option_id' => 2]],
]);

it('reports the points a correct answer can still earn', function () {
    $run = ssRun(['points_min' => 50, 'points_max' => 100, 'speed_bonus_enabled' => true, 'time_limit_seconds' => 20]);
    $scoring = app(ScoringService::class);

    expect($scoring->earnable($run, 0))->toBe(100)
        ->and($scoring->earnable($run, 10_000))->toBe(75)
        ->and($scoring->earnable($run, 30_000))->toBe(50);
});
