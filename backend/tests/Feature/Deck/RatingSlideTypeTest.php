<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quest\RatingSlideType;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Validation\ValidationException;

uses(DatabaseTransactions::class);

function tiRtType(): RatingSlideType
{
    return app(SlideTypeRegistry::class)->for('rating');
}

function tiRtOptions(): array
{
    return [
        ['id' => 21, 'position' => 1, 'label' => 'Venue', 'image_file_id' => 8, 'image_url' => 'https://example.test/v.png', 'is_correct' => true, 'payload' => ['correct_order_index' => 1]],
        ['id' => 22, 'position' => 2, 'label' => 'Food', 'image_file_id' => null, 'image_url' => null, 'is_correct' => null, 'payload' => []],
        ['id' => 23, 'position' => 3, 'label' => 'Talks', 'image_file_id' => null, 'image_url' => null, 'is_correct' => null, 'payload' => []],
    ];
}

function tiRtAnswer(array $valuesByOption): DeckParticipantAnswer
{
    $ratings = [];
    foreach ($valuesByOption as $id => $value) {
        $ratings[] = ['option_id' => $id, 'value' => $value];
    }

    return new DeckParticipantAnswer(['answer_payload' => ['ratings' => $ratings]]);
}

it('is discovered by the registry as a live Quest poll', function () {
    $registry = app(SlideTypeRegistry::class);

    expect($registry->for('rating'))->toBeInstanceOf(RatingSlideType::class)
        ->and($registry->forProduct('quest'))->toHaveKey('rating');

    $type = tiRtType();
    expect($type->category())->toBe(SlideTypeContract::CATEGORY_POLL)
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_LIVE)
        ->and($type->acceptsAnswers())->toBeTrue()
        ->and($type->defaultOptions())->toHaveCount(3);
});

it('accepts its own default config', function () {
    $type = tiRtType();

    expect($type->validateConfig($type->defaultConfig()))->toBe(['scale' => 5, 'require_all_items' => false, 'show_results_to_participants' => false])
        ->and($type->validateConfig(['scale' => '10', 'require_all_items' => 1, 'x' => 1]))->toBe(['scale' => 10, 'require_all_items' => true, 'show_results_to_participants' => false])
        ->and($type->validateConfig(['show_results_to_participants' => '1'])['show_results_to_participants'])->toBeTrue();
});

it('rejects bad config', function (array $config) {
    expect(fn () => tiRtType()->validateConfig($config))->toThrow(ValidationException::class);
})->with([
    'scale not offered' => [['scale' => 4]],
    'scale too big' => [['scale' => 100]],
    'scale zero' => [['scale' => 0]],
    'scale string' => [['scale' => 'five']],
    'require_all_items not boolean' => [['require_all_items' => 'sometimes']],
]);

it('accepts ratings and normalises them to option order', function () {
    $type = tiRtType();

    expect($type->validateAnswer([
        'ratings' => [['option_id' => 23, 'value' => '2'], ['option_id' => 21, 'value' => 5]],
        'extra' => true,
    ], ['scale' => 5], tiRtOptions()))->toBe([
        'ratings' => [['option_id' => 21, 'value' => 5], ['option_id' => 23, 'value' => 2]],
    ]);

    expect($type->validateAnswer(['ratings' => [['option_id' => 22, 'value' => 10]]], ['scale' => 10], tiRtOptions()))
        ->toBe(['ratings' => [['option_id' => 22, 'value' => 10]]]);
});

it('requires every item when require_all_items is on', function () {
    $type = tiRtType();
    $config = ['scale' => 5, 'require_all_items' => true];

    expect(fn () => $type->validateAnswer(['ratings' => [['option_id' => 21, 'value' => 3]]], $config, tiRtOptions()))
        ->toThrow(ValidationException::class);

    expect($type->validateAnswer(['ratings' => [
        ['option_id' => 21, 'value' => 1], ['option_id' => 22, 'value' => 2], ['option_id' => 23, 'value' => 3],
    ]], $config, tiRtOptions())['ratings'])->toHaveCount(3);
});

it('rejects malformed or out-of-range ratings', function (array $payload) {
    expect(fn () => tiRtType()->validateAnswer($payload, ['scale' => 5], tiRtOptions()))
        ->toThrow(ValidationException::class);
})->with([
    'empty payload' => [[]],
    'empty ratings' => [['ratings' => []]],
    'ratings not a list' => [['ratings' => ['21' => 3]]],
    'value zero' => [['ratings' => [['option_id' => 21, 'value' => 0]]]],
    'value above scale' => [['ratings' => [['option_id' => 21, 'value' => 6]]]],
    'fractional value' => [['ratings' => [['option_id' => 21, 'value' => 3.5]]]],
    'string value' => [['ratings' => [['option_id' => 21, 'value' => 'great']]]],
    'unknown option id' => [['ratings' => [['option_id' => 99, 'value' => 3]]]],
    'duplicate option id' => [['ratings' => [['option_id' => 21, 'value' => 3], ['option_id' => 21, 'value' => 4]]]],
    'missing value' => [['ratings' => [['option_id' => 21]]]],
    'entry not an object' => [['ratings' => [3]]],
]);

it('rejects a rating list longer than the item list up front', function (int $entries) {
    // Through the wildcard rules (`*` expansion + distinct, both quadratic)
    // 10,000 entries took ~16s; the length check is O(1).
    $payload = ['ratings' => array_fill(0, $entries, ['option_id' => 21, 'value' => 3])];

    $started = microtime(true);
    try {
        tiRtType()->validateAnswer($payload, ['scale' => 5], tiRtOptions());
        $this->fail('Expected a ValidationException.');
    } catch (ValidationException $e) {
        expect($e->errors())->toBe(['ratings' => ['The ratings field must not have more than 3 items.']]);
    }

    expect(microtime(true) - $started)->toBeLessThan(1.0);
})->with([
    'one more than the items' => [4],
    'twenty thousand' => [20_000],
]);

it('scores zero', function () {
    expect(tiRtType()->score(['ratings' => [['option_id' => 21, 'value' => 5]]], ['scale' => 5], tiRtOptions(), 100))
        ->toEqual(ScoreResult::zero());
});

it('aggregates mean, count and histogram per item', function () {
    $answers = collect([
        tiRtAnswer([21 => 5, 22 => 3]),
        tiRtAnswer([21 => 4]),
        tiRtAnswer([21 => 4, 22 => 1, 23 => 2]),
        // Ignored: out of range (scale lowered after the fact) and unknown item.
        tiRtAnswer([22 => 9, 99 => 3]),
    ]);

    $aggregate = tiRtType()->aggregate(['scale' => 5], tiRtOptions(), $answers);

    expect($aggregate)->toBe([
        'total_responses' => 4,
        'scale' => 5,
        'items' => [
            ['option_id' => 21, 'count' => 3, 'mean' => 4.33, 'distribution' => [
                ['value' => 1, 'count' => 0], ['value' => 2, 'count' => 0], ['value' => 3, 'count' => 0], ['value' => 4, 'count' => 2], ['value' => 5, 'count' => 1],
            ]],
            ['option_id' => 22, 'count' => 2, 'mean' => 2.0, 'distribution' => [
                ['value' => 1, 'count' => 1], ['value' => 2, 'count' => 0], ['value' => 3, 'count' => 1], ['value' => 4, 'count' => 0], ['value' => 5, 'count' => 0],
            ]],
            ['option_id' => 23, 'count' => 1, 'mean' => 2.0, 'distribution' => [
                ['value' => 1, 'count' => 0], ['value' => 2, 'count' => 1], ['value' => 3, 'count' => 0], ['value' => 4, 'count' => 0], ['value' => 5, 'count' => 0],
            ]],
        ],
    ]);
});

it('aggregates deterministically and handles an empty run', function () {
    $type = tiRtType();
    $answers = collect([tiRtAnswer([21 => 1, 22 => 2]), tiRtAnswer([21 => 3]), tiRtAnswer([23 => 3])]);

    $first = $type->aggregate(['scale' => 3], tiRtOptions(), $answers);

    expect($type->aggregate(['scale' => 3], tiRtOptions(), $answers))->toBe($first)
        ->and($type->aggregate(['scale' => 3], tiRtOptions(), $answers->reverse()->values()))->toBe($first)
        ->and($first['items'][0]['distribution'])->toHaveCount(3);

    $empty = $type->aggregate([], tiRtOptions(), collect());
    expect($empty['total_responses'])->toBe(0)
        ->and($empty['scale'])->toBe(5)
        ->and(array_column($empty['items'], 'mean'))->toBe([null, null, null])
        ->and(array_column($empty['items'], 'count'))->toBe([0, 0, 0]);
});

it('aggregates stored answers through the registry', function () {
    $run = DeckSessionSlideRun::factory()->inState(DeckSessionSlideRun::STATE_VOTING)->create([
        'type_snapshot' => 'rating',
        'config_snapshot' => ['scale' => 5, 'require_all_items' => false],
        'options_snapshot' => tiRtOptions(),
    ]);

    foreach ([[21 => 5, 22 => 4], [21 => 3]] as $values) {
        DeckParticipantAnswer::factory()->create([
            'slide_run_id' => $run->id,
            'answer_payload' => tiRtAnswer($values)->answer_payload,
        ]);
    }

    $aggregate = app(SlideTypeRegistry::class)->aggregate($run->fresh());

    expect($aggregate['total_responses'])->toBe(2)
        ->and(array_column($aggregate['items'], 'mean'))->toBe([4.0, 4.0, null]);
});

it('serialises for participants without aggregate or answer-key data', function () {
    $run = DeckSessionSlideRun::factory()->inState(DeckSessionSlideRun::STATE_VOTING)->make([
        'deck_session_id' => 1,
        'type_snapshot' => 'rating',
        'config_snapshot' => ['scale' => 5, 'require_all_items' => false, 'correct_answers' => [21]],
        'options_snapshot' => tiRtOptions(),
    ]);
    $type = tiRtType();

    $view = $type->serializeForParticipant($run);
    $json = json_encode($view);

    expect($view)->not->toHaveKey('aggregate')
        ->and($view['config'])->toBe(['scale' => 5, 'require_all_items' => false])
        ->and($view['options'][0])->toBe(['id' => 21, 'position' => 1, 'label' => 'Venue', 'image_url' => 'https://example.test/v.png', 'payload' => []])
        ->and($json)->not->toContain('is_correct')
        ->and($json)->not->toContain('correct_')
        ->and($json)->not->toContain('distribution');

    expect($type->serializeForPresenter($run, $type->aggregate($run->config_snapshot, $run->options_snapshot, collect()))['aggregate']['items'])
        ->toHaveCount(3);
});
