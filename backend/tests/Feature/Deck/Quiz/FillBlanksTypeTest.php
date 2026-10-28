<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\Types\Quiz\BlankText;
use App\Deck\Slides\Types\Quiz\FillBlanksSlideType;

require_once __DIR__ . '/QuizTypeHelpers.php';

/** "The sun rises in the [east] …": blank 0 typed (also "the east"), blank 1 a dropdown, blank 2 typed. */
function fbConfig(array $overrides = []): array
{
    return quizType('fill_blanks')->validateConfig(array_replace([
        'text' => "The sun rises in the [east] and sets in the [west].\nWater boils at [100] °C.",
        'blanks' => [
            ['mode' => 'type', 'alternatives' => ['the east']],
            ['mode' => 'dropdown', 'distractors' => ['north', 'south', 'WEST']],
        ],
    ], $overrides));
}

it('splits the sentence into text and blanks', function () {
    expect(BlankText::parse('A [b] c [ d  e ] [] [x[y]] f [g]', 2))->toBe([
        // Empty and nested brackets stay text; past the 2-blank cap [y] and [g] do too (but are counted).
        'parts' => [['text' => 'A '], ['blank' => 0], ['text' => ' c '], ['blank' => 1], ['text' => ' [] [x[y]] f [g]']],
        'answers' => ['b', 'd e'],
        'brackets' => 4,
    ]);
});

it('normalises the author config and seeds an empty sentence', function () {
    $type = quizType('fill_blanks');

    expect($type)->toBeInstanceOf(FillBlanksSlideType::class)
        ->and($type->products())->toBe(['quiz'])
        ->and($type->defaultConfig())->toBe(['text' => '', 'blanks' => [], 'case_sensitive' => false])
        ->and($type->defaultOptions())->toBe([])
        ->and($type->defaultSlideAttributes()['time_limit_seconds'])->toBe(45)
        ->and(fbConfig(['blanks' => [['alternatives' => [' The  East ', '', 'The East']]]]))->toBe([
            'text' => "The sun rises in the [east] and sets in the [west].\nWater boils at [100] °C.",
            'blanks' => [['mode' => 'type', 'alternatives' => ['The East'], 'distractors' => []]],
            'case_sensitive' => false,
        ]);
});

it('rejects sentences and blank settings past the limits', function (array $config) {
    quizRejects(fn () => quizType('fill_blanks')->validateConfig($config));
})->with([
    'too many blanks' => [['text' => str_repeat('[a] ', BlankText::MAX_BLANKS + 1)]],
    'too long' => [['text' => str_repeat('x', BlankText::MAX_TEXT + 1)]],
    'long answer' => [['text' => '[' . str_repeat('x', BlankText::MAX_ANSWER + 1) . ']']],
    'unknown mode' => [['text' => '[a]', 'blanks' => [['mode' => 'drag']]]],
    'too many alternatives' => [['text' => '[a]', 'blanks' => [['alternatives' => ['b', 'c', 'd', 'e', 'f']]]]],
    'too many wrong choices' => [['text' => '[a]', 'blanks' => [['mode' => 'dropdown', 'distractors' => ['b', 'c', 'd', 'e', 'f', 'g']]]]],
    'not text' => [['text' => ['a']]],
]);

it('shows participants the sentence and the choices, never the answers', function () {
    $config = fbConfig() + ['_key_salt' => 'salt-one'];
    $view = quizAssertNoLeak(quizType('fill_blanks'), quizRun('fill_blanks', quizScoring() + $config, []), ['east', '[100]', '[west]']);

    expect($view['config']['parts'])->toBe([
        ['text' => 'The sun rises in the '], ['blank' => 0], ['text' => ' and sets in the '], ['blank' => 1], ['text' => ".\nWater boils at "], ['blank' => 2], ['text' => ' °C.'],
    ])
        ->and($view['config']['blanks'][0])->toBe(['mode' => 'type'])
        ->and($view['config']['blanks'][2])->toBe(['mode' => 'type'])
        ->and($view['config']['blanks'][1]['mode'])->toBe('dropdown')
        // "WEST" is the answer too (case-insensitive), so it is not offered twice.
        ->and($view['config']['blanks'][1]['choices'])->toEqualCanonicalizing(['west', 'north', 'south'])
        ->and($view['config'])->not->toHaveKeys(['text'])
        ->and($view['config']['scoring'])->toBe(quizScoring()['scoring'])
        ->and($view['options'])->toBe([]);

    // The choices come in an order of the run's own.
    $orders = collect(range(1, 12))->map(fn ($i) => quizType('fill_blanks')->serializeForParticipant(quizRun('fill_blanks', fbConfig() + ['_key_salt' => "s{$i}"], []))['config']['blanks'][1]['choices']);
    expect($orders->unique(fn ($order) => implode('|', $order))->count())->toBeGreaterThan(1);
});

it('accepts one cleaned answer per blank, empty ones allowed', function () {
    $type = quizType('fill_blanks');

    expect($type->validateAnswer(['answers' => ['  The   East ', 'west', null]], fbConfig(), []))->toBe(['answers' => ['The East', 'west', null]])
        ->and($type->validateAnswer(['answers' => ['', 'north', '100']], fbConfig(), []))->toBe(['answers' => [null, 'north', '100']]);
});

it('rejects answers that do not fit the blanks', function (array $payload) {
    quizRejects(fn () => quizType('fill_blanks')->validateAnswer($payload, fbConfig(), []));
})->with([
    'missing' => [[]],
    'too few' => [['answers' => ['east', 'west']]],
    'too many' => [['answers' => ['east', 'west', '100', 'x']]],
    'all empty' => [['answers' => [null, '', '  ']]],
    'not a choice' => [['answers' => ['east', 'up', '100']]],
    'too long' => [['answers' => [str_repeat('x', FillBlanksSlideType::MAX_TYPED + 1), 'west', '100']]],
    'not text' => [['answers' => [['east'], 'west', '100']]],
    'keyed' => [['answers' => ['a' => 'east', 'b' => 'west', 'c' => '100']]],
]);

it('refuses answers on a slide without blanks', function () {
    quizRejects(fn () => quizType('fill_blanks')->validateAnswer(['answers' => []], fbConfig(['text' => 'No blanks here']), []));
});

it('scores the share of blanks right', function (array $answers, int $points, bool $correct, float $credit) {
    $score = quizType('fill_blanks')->score(['answers' => $answers], quizScoring(50, 100, false) + fbConfig(), [], 0);

    expect($score)->toEqual(new ScoreResult($points, $correct, $credit));
})->with([
    'all right' => [['east', 'west', '100'], 100, true, 1.0],
    'alternative, any case' => [['THE EAST', 'west', '100'], 100, true, 1.0],
    'two of three' => [['east', 'north', '100'], 67, false, 0.6667],
    'one empty' => [['east', null, '100'], 67, false, 0.6667],
    'none' => [['west', 'north', '99'], 0, false, 0.0],
]);

it('compares case-sensitively when asked', function () {
    $config = fbConfig(['case_sensitive' => true]);

    expect(quizType('fill_blanks')->score(['answers' => ['East', 'west', '100']], quizScoring(50, 100, false) + $config, [], 0)->partialCreditRatio)->toBe(0.6667)
        ->and(quizType('fill_blanks')->score(['answers' => ['the east', 'west', '100']], quizScoring(50, 100, false) + $config, [], 0)->isCorrect)->toBeTrue();
});

it('aggregates per blank with the answer key', function () {
    $answers = collect([
        quizAnswer(['answers' => ['east', 'west', '100']], 1),
        quizAnswer(['answers' => ['east', 'north', null]], 2),
        quizAnswer(['answers' => ['west', 'west', '100']], 3),
        quizAnswer(['answers' => 'east'], 4),
    ]);

    expect(quizType('fill_blanks')->aggregate(fbConfig(), [], $answers))->toBe([
        'total_responses' => 3,
        'correct_responses' => 1,
        'partially_correct_responses' => 2,
        'incorrect_responses' => 0,
        'correct_percentage' => 33.33,
        'blanks' => [
            ['correct_count' => 2, 'correct_percentage' => 66.67],
            ['correct_count' => 2, 'correct_percentage' => 66.67],
            ['correct_count' => 2, 'correct_percentage' => 66.67],
        ],
        'correct' => ['blanks' => [['answers' => ['east', 'the east']], ['answers' => ['west']], ['answers' => ['100']]]],
    ]);
});
