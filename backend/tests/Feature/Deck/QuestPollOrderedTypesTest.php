<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quest\RankingSlideType;
use App\Deck\Slides\Types\Quest\ScalesSlideType;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Validation\ValidationException;

uses(DatabaseTransactions::class);

/** Statements / items in contract shape; every one flagged correct to prove it never leaks. */
function qpOrderedOptions(array $ids = [21, 22, 23]): array
{
    return array_map(fn (int $id, int $index) => [
        'id' => $id,
        'position' => $index + 1,
        'label' => "Item {$id}",
        'image_file_id' => null,
        'image_url' => "https://cdn.example/{$id}.png",
        'is_correct' => true,
        'payload' => ['correct_order_index' => $index],
    ], $ids, array_keys($ids));
}

function qpOrderedAnswer(int $id, array $payload): DeckParticipantAnswer
{
    $answer = new DeckParticipantAnswer(['answer_payload' => $payload]);
    $answer->id = $id;

    return $answer;
}

function qpOrderedRun(string $type, array $config, array $options): DeckSessionSlideRun
{
    $run = new DeckSessionSlideRun([
        'deck_session_id' => 1,
        'position_snapshot' => 3,
        'type_snapshot' => $type,
        'title_snapshot' => 'Order these',
        'config_snapshot' => $config + ['correct_order' => [23, 22, 21]],
        'options_snapshot' => $options,
        'state' => DeckSessionSlideRun::STATE_CLOSED,
        'state_version' => 3,
    ]);
    $run->id = 99;

    return $run;
}

function qpOrderedKeysDeep(array $data): array
{
    $keys = [];
    foreach ($data as $key => $value) {
        $keys[] = $key;
        if (is_array($value)) {
            $keys = [...$keys, ...qpOrderedKeysDeep($value)];
        }
    }

    return $keys;
}

function qpOrderedRejects(callable $callback): void
{
    expect($callback)->toThrow(ValidationException::class);
}

dataset('qp_ordered_types', [
    'scales' => [ScalesSlideType::KEY, ScalesSlideType::class],
    'ranking' => [RankingSlideType::KEY, RankingSlideType::class],
]);

it('is discovered by the registry as a live, unscored Quest poll', function (string $key, string $class) {
    $type = app(SlideTypeRegistry::class)->for($key);

    expect($type)->toBeInstanceOf($class)
        ->and($type->products())->toBe(['quest'])
        ->and($type->category())->toBe(SlideTypeContract::CATEGORY_POLL)
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_LIVE)
        ->and($type->acceptsAnswers())->toBeTrue();
})->with('qp_ordered_types');

it('accepts its own default config unchanged', function (string $key) {
    $type = app(SlideTypeRegistry::class)->for($key);

    expect($type->validateConfig($type->defaultConfig()))->toBe($type->defaultConfig())
        ->and($type->validateConfig(['stray' => 1]))->toBe($type->defaultConfig());
})->with('qp_ordered_types');

it('always scores zero', function (string $key) {
    $type = app(SlideTypeRegistry::class)->for($key);

    expect($type->score(['order' => [21, 22, 23]], $type->defaultConfig(), qpOrderedOptions(), 900))->toEqual(ScoreResult::zero());
})->with('qp_ordered_types');

it('never sends aggregate data or answer keys to participants', function (string $key) {
    $type = app(SlideTypeRegistry::class)->for($key);

    $view = $type->serializeForParticipant(qpOrderedRun($key, $type->defaultConfig(), qpOrderedOptions()));
    $keys = qpOrderedKeysDeep($view);

    expect($keys)->not->toContain('aggregate')
        ->and($keys)->not->toContain('is_correct')
        ->and($keys)->not->toContain('correct_order')
        ->and($keys)->not->toContain('correct_order_index')
        ->and($view['config'])->toBe($type->defaultConfig())
        ->and($view['options'][2])->toBe(['id' => 23, 'position' => 3, 'label' => 'Item 23', 'image_url' => 'https://cdn.example/23.png', 'payload' => []]);
})->with('qp_ordered_types');

it('has the planned scales defaults', function () {
    $type = app(SlideTypeRegistry::class)->for('scales');

    expect($type->defaultOptions())->toHaveCount(3)
        ->and($type->defaultConfig())->toBe([
            'scale_points' => 5,
            'scale_labels' => ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'],
            'require_all_statements' => false,
            'show_results_to_participants' => false,
        ]);
});

it('normalises scales config and resizes labels when only the point count changes', function () {
    $type = app(SlideTypeRegistry::class)->for('scales');

    expect($type->validateConfig(['scale_points' => 3]))->toBe([
        'scale_points' => 3,
        'scale_labels' => ['Strongly Disagree', null, 'Strongly Agree'],
        'require_all_statements' => false,
        'show_results_to_participants' => false,
    ])->and($type->validateConfig(['scale_points' => '2', 'scale_labels' => [' Low ', ''], 'require_all_statements' => '1']))->toBe([
        'scale_points' => 2,
        'scale_labels' => ['Low', null],
        'require_all_statements' => true,
        'show_results_to_participants' => false,
    ]);
});

it('rejects bad scales config', function (array $config) {
    qpOrderedRejects(fn () => app(SlideTypeRegistry::class)->for('scales')->validateConfig($config));
})->with([
    'one point' => [['scale_points' => 1]],
    'eleven points' => [['scale_points' => 11]],
    'points not int' => [['scale_points' => 'five']],
    'labels count mismatch' => [['scale_points' => 4, 'scale_labels' => ['a', 'b']]],
    'labels not a list' => [['scale_labels' => 'agree']],
    'label too long' => [['scale_points' => 2, 'scale_labels' => [str_repeat('x', 61), null]]],
    'label not a string' => [['scale_points' => 2, 'scale_labels' => [['x'], null]]],
    'require not bool' => [['require_all_statements' => 'always']],
]);

it('validates scales answers', function () {
    $type = app(SlideTypeRegistry::class)->for('scales');
    $options = qpOrderedOptions();
    $config = $type->defaultConfig();

    expect($type->validateAnswer(['ratings' => [['option_id' => 23, 'value' => 5], ['option_id' => '21', 'value' => '1']]], $config, $options))
        ->toBe(['ratings' => [['option_id' => 21, 'value' => 1], ['option_id' => 23, 'value' => 5]]]);

    foreach ([
        [],
        ['ratings' => []],
        ['ratings' => [['option_id' => 21]]],
        ['ratings' => [['option_id' => 21, 'value' => 0]]],                                   // below range
        ['ratings' => [['option_id' => 21, 'value' => 6]]],                                   // above range
        ['ratings' => [['option_id' => 21, 'value' => 2.5]]],
        ['ratings' => [['option_id' => 99, 'value' => 3]]],                                   // unknown statement
        ['ratings' => [['option_id' => 21, 'value' => 3], ['option_id' => 21, 'value' => 4]]], // duplicate
        ['ratings' => ['21' => 3]],
    ] as $bad) {
        qpOrderedRejects(fn () => $type->validateAnswer($bad, $config, $options));
    }

    qpOrderedRejects(fn () => $type->validateAnswer(
        ['ratings' => [['option_id' => 21, 'value' => 3]]],
        ['require_all_statements' => true] + $config,
        $options,
    ));
    // A smaller scale tightens the range.
    qpOrderedRejects(fn () => $type->validateAnswer(['ratings' => [['option_id' => 21, 'value' => 4]]], ['scale_points' => 3] + $config, $options));
});

it('aggregates scales per statement with mean and distribution', function () {
    $type = app(SlideTypeRegistry::class)->for('scales');
    $options = qpOrderedOptions([21, 22]);
    $config = ['scale_points' => 3] + $type->defaultConfig();
    $answers = collect([
        qpOrderedAnswer(1, ['ratings' => [['option_id' => 21, 'value' => 1], ['option_id' => 22, 'value' => 3]]]),
        qpOrderedAnswer(2, ['ratings' => [['option_id' => 21, 'value' => 2]]]),
        qpOrderedAnswer(3, ['ratings' => [['option_id' => 21, 'value' => 2], ['option_id' => 22, 'value' => 9]]]), // 9 out of range: ignored
    ]);

    $expected = [
        'total_responses' => 3,
        'scale_points' => 3,
        'statements' => [
            [
                'option_id' => 21,
                'count' => 3,
                'mean' => 1.67,
                'distribution' => [['value' => 1, 'count' => 1], ['value' => 2, 'count' => 2], ['value' => 3, 'count' => 0]],
            ],
            [
                'option_id' => 22,
                'count' => 1,
                'mean' => 3.0,
                'distribution' => [['value' => 1, 'count' => 0], ['value' => 2, 'count' => 0], ['value' => 3, 'count' => 1]],
            ],
        ],
    ];

    expect($type->aggregate($config, $options, $answers))->toBe($expected)
        ->and($type->aggregate($config, array_reverse($options), $answers->reverse()->values()))->toBe($expected)
        ->and($type->aggregate($config, $options, collect())['statements'][0]['mean'])->toBeNull();
});

it('defaults ranking to four items and a full ranking', function () {
    $type = app(SlideTypeRegistry::class)->for('ranking');

    expect($type->defaultOptions())->toHaveCount(4)
        ->and($type->defaultConfig())->toBe(['require_full_ranking' => true, 'show_results_to_participants' => false])
        ->and($type->validateConfig(['require_full_ranking' => 0]))->toBe(['require_full_ranking' => false, 'show_results_to_participants' => false]);
});

it('rejects bad ranking config', function (mixed $value) {
    qpOrderedRejects(fn () => app(SlideTypeRegistry::class)->for('ranking')->validateConfig(['require_full_ranking' => $value]));
})->with([['sometimes'], [null], [[true]]]);

it('validates ranking answers', function () {
    $type = app(SlideTypeRegistry::class)->for('ranking');
    $options = qpOrderedOptions();
    $config = $type->defaultConfig();

    expect($type->validateAnswer(['order' => [23, '21', 22]], $config, $options))->toBe(['order' => [23, 21, 22]]);

    foreach ([
        [],
        ['order' => []],
        ['order' => 21],
        ['order' => [21, 22]],         // not every item
        ['order' => [21, 22, 22]],     // duplicate
        ['order' => [21, 22, 99]],     // unknown item
        ['order' => [21, 22, 23, 24]], // too many
        ['order' => ['x' => 21, 'y' => 22, 'z' => 23]],
    ] as $bad) {
        qpOrderedRejects(fn () => $type->validateAnswer($bad, $config, $options));
    }

    // Partial (top-k) rankings when the author allows them.
    expect($type->validateAnswer(['order' => [22]], ['require_full_ranking' => false], $options))->toBe(['order' => [22]]);
});

it('aggregates ranking as weighted average position, best first', function () {
    $type = app(SlideTypeRegistry::class)->for('ranking');
    $options = qpOrderedOptions([21, 22, 23, 24]);
    $answers = collect([
        qpOrderedAnswer(1, ['order' => [22, 21, 23, 24]]),
        qpOrderedAnswer(2, ['order' => [21, 22, 23, 24]]),
        qpOrderedAnswer(3, ['order' => [22, 23, 21]]), // partial ranking: 24 unranked here
        qpOrderedAnswer(4, ['bad' => true]),
    ]);

    $aggregate = $type->aggregate(['require_full_ranking' => false], $options, $answers);

    expect($aggregate['total_responses'])->toBe(3)
        ->and($aggregate['item_count'])->toBe(4)
        ->and(array_map(fn ($item) => [$item['option_id'], $item['rank'], $item['average_position'], $item['count']], $aggregate['items']))
        ->toBe([
            [22, 1, 1.33, 3], // (1 + 2 + 1) / 3
            [21, 2, 2.0, 3],  // (2 + 1 + 3) / 3
            [23, 3, 2.67, 3], // (3 + 3 + 2) / 3
            [24, 4, 4.0, 2],  // (4 + 4 + 4) / 3: left out of answer 3, so it takes the one open slot (4)
        ])
        ->and($aggregate['items'][0]['position_counts'])->toBe([
            ['position' => 1, 'count' => 2],
            ['position' => 2, 'count' => 1],
            ['position' => 3, 'count' => 0],
            ['position' => 4, 'count' => 0],
        ])
        ->and($type->aggregate(['require_full_ranking' => false], array_reverse($options), $answers->shuffle()->values()))->toBe($aggregate);
});

it('shares ranks on ties and puts items nobody ranked last', function () {
    $type = app(SlideTypeRegistry::class)->for('ranking');
    $options = qpOrderedOptions([21, 22, 23]);
    $answers = collect([
        qpOrderedAnswer(1, ['order' => [21, 22]]),
        qpOrderedAnswer(2, ['order' => [22, 21]]),
    ]);

    $items = $type->aggregate(['require_full_ranking' => false], $options, $answers)['items'];

    expect(array_map(fn ($item) => [$item['option_id'], $item['rank'], $item['average_position'], $item['count']], $items))->toBe([
        [21, 1, 1.5, 2],
        [22, 1, 1.5, 2],
        [23, 3, 3.0, 0], // left out by both: the only open slot each time
    ]);

    // No responses: nothing is ranked yet.
    expect(array_map(fn ($item) => [$item['option_id'], $item['rank'], $item['average_position']], $type->aggregate([], $options, collect())['items']))
        ->toBe([[21, null, null], [22, null, null], [23, null, null]]);
});

it('counts every top-k response for every item so a lone first place cannot win', function () {
    $type = app(SlideTypeRegistry::class)->for('ranking');
    $options = qpOrderedOptions([21, 22, 23]);
    $answers = collect(range(1, 9))
        ->map(fn (int $i) => qpOrderedAnswer($i, ['order' => [21, 22]]))
        ->push(qpOrderedAnswer(10, ['order' => [23]]));

    $aggregate = $type->aggregate(['require_full_ranking' => false], $options, $answers);

    expect($aggregate['total_responses'])->toBe(10)
        ->and(array_map(fn ($item) => [$item['option_id'], $item['rank'], $item['average_position'], $item['count']], $aggregate['items']))
        ->toBe([
            [21, 1, 1.15, 9], // (9 * 1 + 2.5) / 10; answer 10 left slots 2..3 open
            [22, 2, 2.05, 9], // (9 * 2 + 2.5) / 10
            [23, 3, 2.8, 1],  // (9 * 3 + 1) / 10
        ])
        ->and($aggregate['items'][2]['position_counts'])->toBe([
            ['position' => 1, 'count' => 1],
            ['position' => 2, 'count' => 0],
            ['position' => 3, 'count' => 0],
        ])
        ->and($type->aggregate(['require_full_ranking' => false], array_reverse($options), $answers->shuffle()->values()))->toBe($aggregate);
});

it('ignores unknown and repeated ids in a stored ranking and skips orders with no known item', function () {
    $type = app(SlideTypeRegistry::class)->for('ranking');
    $options = qpOrderedOptions([21, 22, 23]);
    $answers = collect([
        qpOrderedAnswer(1, ['order' => [99, 22, 22, 21, 23]]), // cleaned to 22, 21, 23
        qpOrderedAnswer(2, ['order' => [98, 97]]),             // nothing known: not a response
    ]);

    $aggregate = $type->aggregate([], $options, $answers);

    expect($aggregate['total_responses'])->toBe(1)
        ->and(array_map(fn ($item) => [$item['option_id'], $item['average_position']], $aggregate['items']))
        ->toBe([[22, 1.0], [21, 2.0], [23, 3.0]]);
});

it('aggregates a persisted ranking run through the registry', function () {
    $run = DeckSessionSlideRun::factory()->inState(DeckSessionSlideRun::STATE_VOTING)->create([
        'type_snapshot' => 'ranking',
        'config_snapshot' => ['require_full_ranking' => true],
        'options_snapshot' => qpOrderedOptions([31, 32]),
    ]);
    DeckParticipantAnswer::factory()->create(['slide_run_id' => $run->id, 'answer_payload' => ['order' => [32, 31]]]);
    DeckParticipantAnswer::factory()->create(['slide_run_id' => $run->id, 'answer_payload' => ['order' => [32, 31]]]);

    $aggregate = app(SlideTypeRegistry::class)->aggregate($run->fresh());

    expect($aggregate['total_responses'])->toBe(2)
        ->and(array_column($aggregate['items'], 'option_id'))->toBe([32, 31])
        ->and(array_column($aggregate['items'], 'average_position'))->toBe([1.0, 2.0]);
});
