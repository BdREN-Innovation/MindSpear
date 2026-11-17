<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\Types\Quiz\DragDropSlideType;
use App\Models\Deck\DeckSessionSlideRun;

require_once __DIR__ . '/QuizTypeHelpers.php';

/** "The [cat] sat on the [mat] by the [cat]." with extra words dog and hat ("mat" is an answer already). */
function ddConfig(array $overrides = []): array
{
    return quizType('drag_drop')->validateConfig(array_replace([
        'text' => 'The [cat] sat on the [mat] by the [cat].',
        'distractors' => ['dog', ' mat ', 'hat', 'dog'],
    ], $overrides));
}

it('normalises the author config and seeds an empty sentence', function () {
    $type = quizType('drag_drop');

    expect($type)->toBeInstanceOf(DragDropSlideType::class)
        ->and($type->products())->toBe(['quiz'])
        ->and($type->defaultConfig())->toBe(['text' => '', 'distractors' => []])
        ->and($type->defaultOptions())->toBe([])
        ->and(ddConfig())->toBe(['text' => 'The [cat] sat on the [mat] by the [cat].', 'distractors' => ['dog', 'mat', 'hat']])
        ->and($type->sentence(ddConfig())['bank'])->toBe(['cat', 'mat', 'cat', 'dog', 'hat']);

    quizRejects(fn () => $type->validateConfig(['text' => '[a]', 'distractors' => array_map(fn ($i) => "w{$i}", range(1, DragDropSlideType::MAX_DISTRACTORS + 1))]));
});

it('shows each participant the word bank in an order of their own, and no answers', function () {
    $type = quizType('drag_drop');
    $run = quizRun('drag_drop', quizScoring() + ddConfig() + ['_key_salt' => 'abc'], []);

    $view = quizAssertNoLeak($type, $run);
    expect($view['config']['parts'])->toBe([['text' => 'The '], ['blank' => 0], ['text' => ' sat on the '], ['blank' => 1], ['text' => ' by the '], ['blank' => 2], ['text' => '.']])
        ->and($view['config']['blanks'])->toBe([['mode' => 'drop'], ['mode' => 'drop'], ['mode' => 'drop']])
        ->and($view['config'])->not->toHaveKeys(['text', 'distractors'])
        ->and(array_column($view['options'], 'label'))->toEqualCanonicalizing(['cat', 'mat', 'cat', 'dog', 'hat'])
        ->and(collect($view['options'])->every(fn ($option) => is_string($option['id']) && str_starts_with($option['id'], 'k') && $option['payload'] === []))->toBeTrue();

    $orders = collect(range(1, 12))->map(fn ($participant) => implode('|', array_column($type->serializeForViewer($run, $participant)['options'], 'id')));
    expect($orders->unique()->count())->toBeGreaterThan(1);

    // Hidden until voting, like every quiz type's options.
    $run->state = DeckSessionSlideRun::STATE_GET_READY;
    expect($type->serializeForParticipant($run)['options'])->toBe([])
        ->and($type->serializeForParticipant($run)['config']['parts'])->toHaveCount(7);
});

it('takes words of the bank, each no more often than it is there', function () {
    $type = quizType('drag_drop');

    expect($type->validateAnswer(['answers' => ['cat', 'mat', 'cat']], ddConfig(), []))->toBe(['answers' => ['cat', 'mat', 'cat']])
        ->and($type->validateAnswer(['answers' => ['dog', null, ' hat ']], ddConfig(), []))->toBe(['answers' => ['dog', null, 'hat']]);
});

it('rejects words that are not in the bank or used too often', function (array $payload) {
    quizRejects(fn () => quizType('drag_drop')->validateAnswer($payload, ddConfig(), []));
})->with([
    'not in the bank' => [['answers' => ['cow', 'mat', 'cat']]],
    'other case' => [['answers' => ['Cat', 'mat', 'cat']]],
    'used twice' => [['answers' => ['mat', 'mat', null]]],
    'too few' => [['answers' => ['cat']]],
    'all empty' => [['answers' => [null, null, null]]],
]);

it('scores the share of blanks holding their own word', function (array $answers, int $points, bool $correct, float $credit) {
    $score = quizType('drag_drop')->score(['answers' => $answers], quizScoring(50, 100, false) + ddConfig(), [], 0);

    expect($score)->toEqual(new ScoreResult($points, $correct, $credit));
})->with([
    'all right' => [['cat', 'mat', 'cat'], 100, true, 1.0],
    'one wrong' => [['cat', 'hat', 'cat'], 67, false, 0.6667],
    'swapped' => [['mat', 'cat', 'dog'], 0, false, 0.0],
]);

it('aggregates per blank with the answer key', function () {
    $aggregate = quizType('drag_drop')->aggregate(ddConfig(), [], collect([
        quizAnswer(['answers' => ['cat', 'mat', 'cat']], 1),
        quizAnswer(['answers' => ['dog', 'mat', null]], 2),
    ]));

    expect($aggregate['blanks'])->toBe([
        ['correct_count' => 1, 'correct_percentage' => 50.0],
        ['correct_count' => 2, 'correct_percentage' => 100.0],
        ['correct_count' => 1, 'correct_percentage' => 50.0],
    ])
        ->and($aggregate['correct_responses'])->toBe(1)
        ->and($aggregate['partially_correct_responses'])->toBe(1)
        ->and($aggregate['correct'])->toBe(['blanks' => [['answers' => ['cat']], ['answers' => ['mat']], ['answers' => ['cat']]]]);
});
