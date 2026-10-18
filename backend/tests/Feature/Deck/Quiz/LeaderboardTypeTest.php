<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quiz\LeaderboardSlideType;

require_once __DIR__ . '/QuizTypeHelpers.php';

it('is a read-only quiz slide with top_n 10 by default', function () {
    $type = quizType('leaderboard');

    expect($type)->toBeInstanceOf(LeaderboardSlideType::class)
        ->and($type->products())->toBe(['quiz'])
        ->and(app(SlideTypeRegistry::class)->forProduct('quest'))->not->toHaveKey('leaderboard')
        ->and($type->category())->toBe(SlideTypeContract::CATEGORY_INTERACTIVE)
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_NONE)
        ->and($type->acceptsAnswers())->toBeFalse()
        ->and($type->defaultOptions())->toBe([])
        ->and($type->defaultConfig())->toBe(['top_n' => 10, 'show_all_participants' => false])
        ->and($type->validateConfig([]))->toBe(['top_n' => 10, 'show_all_participants' => false])
        ->and($type->validateConfig(['top_n' => '5', 'show_all_participants' => 1, 'junk' => 1]))->toBe(['top_n' => 5, 'show_all_participants' => true])
        ->and($type->score([], [], [], 0))->toEqual(ScoreResult::zero())
        ->and($type->aggregate([], [], collect()))->toBe([]);

    quizRejects(fn () => $type->validateAnswer([], [], []));
});

it('rejects bad config', function (array $config) {
    quizRejects(fn () => quizType('leaderboard')->validateConfig($config));
})->with([
    'zero' => [['top_n' => 0]],
    'too many' => [['top_n' => LeaderboardSlideType::MAX_TOP_N + 1]],
    'text' => [['top_n' => 'ten']],
    'flag' => [['show_all_participants' => 'all']],
]);

it('turns its config into a row limit', function () {
    expect(LeaderboardSlideType::limit(['top_n' => 3]))->toBe(3)
        ->and(LeaderboardSlideType::limit([]))->toBe(10)
        ->and(LeaderboardSlideType::limit(['top_n' => 3, 'show_all_participants' => true]))->toBe(LeaderboardSlideType::MAX_TOP_N);
});
