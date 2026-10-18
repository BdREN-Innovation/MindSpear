<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\Types\Quiz\ShortAnswerSlideType;

require_once __DIR__ . '/QuizTypeHelpers.php';

/** Accepted answers: "New  York" (double space), "NYC"; option 33 is empty and ignored. */
function saOptions(): array
{
    return [
        quizOption(31, 1, 'New  York'),
        quizOption(32, 2, 'NYC'),
        array_replace(quizOption(33, 3), ['label' => null]),
    ];
}

function saConfig(array $config = []): array
{
    return array_replace(['case_sensitive' => false, 'max_length' => 100, 'profanity_filter_enabled' => true], $config) + quizScoring(50, 100, false);
}

it('is registered as a scored quiz type with one empty accepted answer', function () {
    $type = quizType('short_answer');

    expect($type)->toBeInstanceOf(ShortAnswerSlideType::class)
        ->and($type->products())->toBe(['quiz'])
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_HIDDEN)
        ->and($type->defaultOptions())->toBe([['label' => null, 'payload' => []]])
        ->and($type->defaultConfig())->toBe(['case_sensitive' => false, 'max_length' => 100, 'profanity_filter_enabled' => true])
        ->and($type->validateConfig($type->defaultConfig()))->toBe($type->defaultConfig())
        ->and($type->validateConfig(['case_sensitive' => true, 'max_length' => '40', 'junk' => 1]))
        ->toBe(['case_sensitive' => true, 'max_length' => 40, 'profanity_filter_enabled' => true])
        ->and($type->defaultSlideAttributes()['time_limit_seconds'])->toBe(30);
});

it('rejects bad config', function (array $config) {
    quizRejects(fn () => quizType('short_answer')->validateConfig($config));
})->with([
    'zero length' => [['max_length' => 0]],
    'too long' => [['max_length' => 201]],
    'case flag text' => [['case_sensitive' => 'maybe']],
]);

it('cleans the answer: trim, collapsed whitespace, no control or invisible characters', function () {
    $type = quizType('short_answer');

    expect($type->validateAnswer(['text' => "  New \t\n York\u{200B}\x07 "], saConfig(), saOptions()))->toBe(['text' => 'New York']);
});

it('rejects answers that are not short text', function (array $payload, array $config = []) {
    quizRejects(fn () => quizType('short_answer')->validateAnswer($payload, saConfig($config), saOptions()));
})->with([
    'missing' => [[]],
    'blank' => [['text' => "  \u{200B} \n"]],
    'number' => [['text' => 42]],
    'list' => [['text' => ['NYC']]],
    'over max_length' => [['text' => 'abcdef'], ['max_length' => 5]],
]);

it('scores exact matches after normalising, all or nothing', function (array $payload, bool $correct, array $config = []) {
    $score = quizType('short_answer')->score($payload, saConfig($config), saOptions(), 1000);

    expect($score)->toEqual($correct ? new ScoreResult(100, true, 1.0) : new ScoreResult(0, false, 0.0));
})->with([
    'exact' => [['text' => 'NYC'], true],
    'case-insensitive' => [['text' => 'nyc'], true],
    'whitespace collapsed on both sides' => [['text' => '  new   york '], true],
    'case-folded unicode' => [['text' => 'NEW YORK'], true],
    'near miss (no fuzzy match)' => [['text' => 'New Yrok'], false],
    'substring' => [['text' => 'New'], false],
    'case-sensitive mismatch' => [['text' => 'nyc'], false, ['case_sensitive' => true]],
    'case-sensitive match' => [['text' => 'NYC'], true, ['case_sensitive' => true]],
    'empty' => [['text' => ''], false],
    'malformed' => [['text' => ['NYC']], false],
    'missing' => [[], false],
]);

it('matches composed and decomposed accents alike', function () {
    $options = [quizOption(1, 1, "Caf\u{00E9}")];

    expect(quizType('short_answer')->score(['text' => "cafe\u{0301}"], saConfig(), $options, 0)->isCorrect)->toBeTrue();
});

it('scores nothing when no accepted answer is set', function () {
    $options = [array_replace(quizOption(1, 1), ['label' => null])];

    expect(quizType('short_answer')->score(['text' => 'anything'], saConfig(), $options, 0)->pointsAwarded)->toBe(0);
});

it('never shows participants the accepted answers', function () {
    $view = quizAssertNoLeak(quizType('short_answer'), quizRun('short_answer', saConfig(), saOptions()), ['NYC', 'New  York', 'New York']);

    expect($view['options'])->toBe([])
        ->and($view['config']['max_length'])->toBe(100);
});

it('gives the presenter the accepted answers', function () {
    $view = quizType('short_answer')->serializeForPresenter(quizRun('short_answer', saConfig(), saOptions()), []);

    expect($view['answer_key'])->toBe(['accepted_answers' => ['New York', 'NYC'], 'case_sensitive' => false])
        ->and($view['options'])->toBe([]);
});

it('aggregates the most common answers, grouped by normalised text, masked and capped', function () {
    $type = quizType('short_answer');
    $answers = collect([
        quizAnswer(['text' => 'nyc'], 1),
        quizAnswer(['text' => 'NYC'], 2),
        quizAnswer(['text' => 'NYC'], 3),
        quizAnswer(['text' => 'Boston'], 4),
        quizAnswer(['text' => 'shit city'], 5),
        quizAnswer(['text' => 123], 6),
    ]);

    $aggregate = $type->aggregate(saConfig(), saOptions(), $answers);

    expect($aggregate)->toBe([
        'total_responses' => 5,
        'correct_responses' => 3,
        'partially_correct_responses' => 0,
        'incorrect_responses' => 2,
        'correct_percentage' => 60.0,
        'distinct_answers' => 3,
        'answers' => [
            ['text' => 'NYC', 'count' => 3, 'percentage' => 60.0, 'is_correct' => true],
            ['text' => 'Boston', 'count' => 1, 'percentage' => 20.0, 'is_correct' => false],
            ['text' => '**** city', 'count' => 1, 'percentage' => 20.0, 'is_correct' => false],
        ],
        'answers_truncated' => false,
        'correct' => ['accepted_answers' => ['New York', 'NYC'], 'case_sensitive' => false],
    ])
        ->and($type->aggregate(saConfig(), saOptions(), $answers->reverse()->values()))->toBe($aggregate)
        ->and($type->aggregate(saConfig(['profanity_filter_enabled' => false]), saOptions(), $answers)['answers'][2]['text'])->toBe('shit city');

    $many = collect(range(1, 15))->map(fn (int $i) => quizAnswer(['text' => "answer {$i}"], $i));
    $capped = $type->aggregate(saConfig(), saOptions(), $many);

    expect($capped['answers'])->toHaveCount(ShortAnswerSlideType::TOP_ANSWERS)
        ->and($capped['distinct_answers'])->toBe(15)
        ->and($capped['answers'][0]['text'])->toBe('answer 1');
});

it('keeps the answers list within its broadcast budget', function () {
    $type = quizType('short_answer');
    $long = collect(range(1, 10))->map(fn (int $i) => quizAnswer(['text' => str_repeat('অ', 190) . " {$i}"], $i));

    $aggregate = $type->aggregate(saConfig(['max_length' => 200]), saOptions(), $long);

    expect($aggregate['answers_truncated'])->toBeTrue()
        ->and($aggregate['distinct_answers'])->toBe(10)
        ->and(count($aggregate['answers']))->toBeLessThan(10)
        ->and(mb_strlen($aggregate['answers'][0]['text']))->toBeLessThanOrEqual(ShortAnswerSlideType::PREVIEW_LENGTH)
        ->and(strlen(json_encode(json_encode($aggregate['answers']))))->toBeLessThanOrEqual(ShortAnswerSlideType::ANSWERS_BUDGET_BYTES);
});
