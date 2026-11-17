<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quest\PollMultiSlideType;
use App\Deck\Slides\Types\Quest\PollSettings;
use App\Deck\Slides\Types\Quest\PollSingleSlideType;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Validation\ValidationException;

uses(DatabaseTransactions::class);

/** Options snapshot in contract shape; option 11 is flagged correct to prove it never leaks. */
function qpChoiceOptions(array $ids = [11, 12, 13]): array
{
    return array_map(fn (int $id, int $index) => [
        'id' => $id,
        'position' => $index + 1,
        'label' => "Option {$id}",
        'image_file_id' => 900 + $index,
        'image_url' => null,
        'is_correct' => $index === 0,
        'payload' => ['is_correct' => true, 'correct_order_index' => $index, 'colour' => 'blue'],
    ], $ids, array_keys($ids));
}

function qpChoiceAnswer(int $id, array $payload): DeckParticipantAnswer
{
    $answer = new DeckParticipantAnswer(['answer_payload' => $payload, 'submitted_at' => now()]);
    $answer->id = $id;

    return $answer;
}

function qpChoiceRun(string $type, array $config, array $options): DeckSessionSlideRun
{
    $run = new DeckSessionSlideRun([
        'deck_session_id' => 1,
        'slide_id' => 5,
        'position_snapshot' => 1,
        'type_snapshot' => $type,
        'title_snapshot' => 'Which one?',
        'body_snapshot' => null,
        'config_snapshot' => $config + ['correct_option_id' => 11, '_internal' => 'x'],
        'options_snapshot' => $options,
        'state' => DeckSessionSlideRun::STATE_VOTING,
        'state_version' => 2,
    ]);
    $run->id = 77;

    return $run;
}

/** Every key at any depth. */
function qpChoiceKeysDeep(array $data): array
{
    $keys = [];
    foreach ($data as $key => $value) {
        $keys[] = $key;
        if (is_array($value)) {
            $keys = [...$keys, ...qpChoiceKeysDeep($value)];
        }
    }

    return $keys;
}

function qpChoiceRejects(callable $callback): void
{
    expect($callback)->toThrow(ValidationException::class);
}

dataset('qp_choice_types', [
    'poll_single' => [PollSingleSlideType::KEY, PollSingleSlideType::class],
    'poll_multi' => [PollMultiSlideType::KEY, PollMultiSlideType::class],
]);

it('is discovered by the registry as a live, unscored Quest poll', function (string $key, string $class) {
    $type = app(SlideTypeRegistry::class)->for($key);

    expect($type)->toBeInstanceOf($class)
        ->and($type->key())->toBe($key)
        ->and($type->products())->toBe(['quest'])
        ->and($type->category())->toBe(SlideTypeContract::CATEGORY_POLL)
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_LIVE)
        ->and($type->acceptsAnswers())->toBeTrue()
        ->and(app(SlideTypeRegistry::class)->forProduct('quest'))->toHaveKey($key)
        ->and(app(SlideTypeRegistry::class)->forProduct('quiz'))->not->toHaveKey($key);
})->with('qp_choice_types');

it('accepts its own default config unchanged', function (string $key) {
    $type = app(SlideTypeRegistry::class)->for($key);

    expect($type->validateConfig($type->defaultConfig()))->toBe($type->defaultConfig())
        ->and($type->validateConfig([]))->toBe($type->defaultConfig());
})->with('qp_choice_types');

it('always scores zero', function (string $key) {
    $type = app(SlideTypeRegistry::class)->for($key);
    $payload = $key === PollSingleSlideType::KEY ? ['option_id' => 11] : ['option_ids' => [11]];

    $score = $type->score($payload, $type->defaultConfig(), qpChoiceOptions(), 1200);

    expect($score)->toEqual(ScoreResult::zero())
        ->and($score->pointsAwarded)->toBe(0)
        ->and($score->isCorrect)->toBeNull();
})->with('qp_choice_types');

it('never sends aggregate data or answer keys to participants', function (string $key) {
    $type = app(SlideTypeRegistry::class)->for($key);
    $run = qpChoiceRun($key, $type->defaultConfig(), qpChoiceOptions());

    $view = $type->serializeForParticipant($run);
    $keys = qpChoiceKeysDeep($view);

    expect($keys)->not->toContain('aggregate')
        ->and($keys)->not->toContain('is_correct')
        ->and($keys)->not->toContain('correct_option_id')
        ->and($keys)->not->toContain('correct_order_index')
        ->and($keys)->not->toContain('image_file_id')
        ->and($keys)->not->toContain('_internal')
        ->and($view['options'])->toHaveCount(3)
        ->and($view['options'][0])->toBe(['id' => 11, 'position' => 1, 'label' => 'Option 11', 'image_url' => null, 'payload' => ['colour' => 'blue']])
        ->and($view['config'])->toBe($type->defaultConfig())
        ->and($view['type'])->toBe($key);

    $presenter = $type->serializeForPresenter($run, ['total_votes' => 4]);
    expect($presenter['aggregate'])->toBe(['total_votes' => 4]);
})->with('qp_choice_types');

it('defaults poll_single to two empty options, bars and instant submit', function () {
    $type = app(SlideTypeRegistry::class)->for('poll_single');

    expect($type->defaultOptions())->toBe([['label' => null, 'payload' => []], ['label' => null, 'payload' => []]])
        ->and($type->defaultConfig())->toBe(['result_layout' => 'bars', 'submit_mode' => 'instant', 'show_results_to_participants' => false])
        ->and($type->validateConfig(['result_layout' => 'donut', 'junk' => 1]))
        ->toBe(['result_layout' => 'donut', 'submit_mode' => 'instant', 'show_results_to_participants' => false])
        ->and($type->validateConfig(['submit_mode' => 'confirm', 'show_results_to_participants' => '1']))
        ->toBe(['result_layout' => 'bars', 'submit_mode' => 'confirm', 'show_results_to_participants' => true]);
});

it('rejects bad poll_single config', function (array $config) {
    qpChoiceRejects(fn () => app(SlideTypeRegistry::class)->for('poll_single')->validateConfig($config));
})->with([
    'unknown layout' => [['result_layout' => 'spiral']],
    'null layout' => [['result_layout' => null]],
    'numeric layout' => [['result_layout' => 3]],
    'unknown submit mode' => [['submit_mode' => 'later']],
    'null submit mode' => [['submit_mode' => null]],
]);

it('keeps the slide-level show results setting on every poll type, off by default', function (string $key) {
    $type = app(SlideTypeRegistry::class)->for($key);

    expect($type->defaultConfig())->toHaveKey(PollSettings::SHOW_RESULTS, false)
        ->and($type->validateConfig([])[PollSettings::SHOW_RESULTS])->toBeFalse()
        ->and($type->validateConfig([PollSettings::SHOW_RESULTS => true])[PollSettings::SHOW_RESULTS])->toBeTrue()
        ->and(PollSettings::showsResultsToParticipants($type->validateConfig([])))->toBeFalse()
        ->and(PollSettings::showsResultsToParticipants([]))->toBeFalse()
        ->and(PollSettings::showsResultsToParticipants($type->validateConfig([PollSettings::SHOW_RESULTS => 1])))->toBeTrue();

    // Participants may see the flag (it is not an answer key).
    $run = qpChoiceRun($key, $type->validateConfig([PollSettings::SHOW_RESULTS => true]), qpChoiceOptions());
    expect($type->serializeForParticipant($run)['config'])->toHaveKey(PollSettings::SHOW_RESULTS, true);

    qpChoiceRejects(fn () => $type->validateConfig([PollSettings::SHOW_RESULTS => 'sometimes']));
    qpChoiceRejects(fn () => $type->validateConfig([PollSettings::SHOW_RESULTS => null]));
})->with(['poll_single', 'poll_multi', 'word_cloud', 'open_ended', 'scales', 'ranking']);

it('validates poll_single answers', function () {
    $type = app(SlideTypeRegistry::class)->for('poll_single');
    $options = qpChoiceOptions();

    expect($type->validateAnswer(['option_id' => 12], [], $options))->toBe(['option_id' => 12])
        ->and($type->validateAnswer(['option_id' => '13', 'extra' => 'dropped'], [], $options))->toBe(['option_id' => 13]);

    foreach ([[], ['option_id' => 99], ['option_id' => 'abc'], ['option_id' => [11]], ['option_id' => 11.5], ['option_ids' => [11]]] as $bad) {
        qpChoiceRejects(fn () => $type->validateAnswer($bad, [], $options));
    }

    // No options in the snapshot: nothing is valid.
    qpChoiceRejects(fn () => $type->validateAnswer(['option_id' => 11], [], []));
});

it('aggregates poll_single votes per option in option order', function () {
    $type = app(SlideTypeRegistry::class)->for('poll_single');
    $options = array_reverse(qpChoiceOptions()); // snapshot order must not matter
    $answers = collect([
        qpChoiceAnswer(1, ['option_id' => 12]),
        qpChoiceAnswer(2, ['option_id' => 12]),
        qpChoiceAnswer(3, ['option_id' => 11]),
        qpChoiceAnswer(4, ['option_id' => 999]), // option deleted before snapshot: ignored
    ]);

    $expected = [
        'total_responses' => 4,
        'total_votes' => 3,
        'options' => [
            ['option_id' => 11, 'count' => 1, 'percentage' => 33.33],
            ['option_id' => 12, 'count' => 2, 'percentage' => 66.67],
            ['option_id' => 13, 'count' => 0, 'percentage' => 0.0],
        ],
    ];

    expect($type->aggregate([], $options, $answers))->toBe($expected)
        ->and($type->aggregate([], qpChoiceOptions(), $answers->reverse()->values()))->toBe($expected)
        ->and($type->aggregate([], $options, collect()))->toBe([
            'total_responses' => 0,
            'total_votes' => 0,
            'options' => [
                ['option_id' => 11, 'count' => 0, 'percentage' => 0.0],
                ['option_id' => 12, 'count' => 0, 'percentage' => 0.0],
                ['option_id' => 13, 'count' => 0, 'percentage' => 0.0],
            ],
        ]);
});

it('aggregates a persisted poll_single run through the registry', function () {
    $run = DeckSessionSlideRun::factory()->inState(DeckSessionSlideRun::STATE_VOTING)->create([
        'type_snapshot' => 'poll_single',
        'config_snapshot' => ['result_layout' => 'bars'],
        'options_snapshot' => qpChoiceOptions([501, 502]),
    ]);
    DeckParticipantAnswer::factory()->count(2)->create(['slide_run_id' => $run->id, 'answer_payload' => ['option_id' => 502]]);
    DeckParticipantAnswer::factory()->create(['slide_run_id' => $run->id, 'answer_payload' => ['option_id' => 501]]);

    expect(app(SlideTypeRegistry::class)->aggregate($run->fresh()))->toBe([
        'total_responses' => 3,
        'total_votes' => 3,
        'options' => [
            ['option_id' => 501, 'count' => 1, 'percentage' => 33.33],
            ['option_id' => 502, 'count' => 2, 'percentage' => 66.67],
        ],
    ]);
});

it('defaults poll_multi to three options, at least one and no maximum', function () {
    $type = app(SlideTypeRegistry::class)->for('poll_multi');

    expect($type->defaultOptions())->toHaveCount(3)
        ->and($type->defaultConfig())->toBe(['result_layout' => 'bars', 'min_selections' => 1, 'max_selections' => null, 'show_results_to_participants' => false])
        ->and($type->validateConfig(['min_selections' => '2', 'max_selections' => '3']))
        ->toBe(['result_layout' => 'bars', 'min_selections' => 2, 'max_selections' => 3, 'show_results_to_participants' => false]);
});

it('rejects bad poll_multi config', function (array $config) {
    qpChoiceRejects(fn () => app(SlideTypeRegistry::class)->for('poll_multi')->validateConfig($config));
})->with([
    'min zero' => [['min_selections' => 0]],
    'min too large' => [['min_selections' => 51]],
    'min not int' => [['min_selections' => 'two']],
    'max below min' => [['min_selections' => 3, 'max_selections' => 2]],
    'max zero' => [['max_selections' => 0]],
    'bad layout' => [['result_layout' => 'spiral']],
]);

it('validates poll_multi answers against min and max selections', function () {
    $type = app(SlideTypeRegistry::class)->for('poll_multi');
    $options = qpChoiceOptions([11, 12, 13, 14]);
    $config = ['result_layout' => 'bars', 'min_selections' => 2, 'max_selections' => 3];

    // Normalised to option order.
    expect($type->validateAnswer(['option_ids' => [13, 11]], $config, $options))->toBe(['option_ids' => [11, 13]])
        ->and($type->validateAnswer(['option_ids' => ['14', 12, 11]], $config, $options))->toBe(['option_ids' => [11, 12, 14]]);

    foreach ([
        [],
        ['option_ids' => []],
        ['option_ids' => 11],
        ['option_ids' => [11]],             // below min
        ['option_ids' => [11, 12, 13, 14]], // above max
        ['option_ids' => [11, 11]],         // duplicates
        ['option_ids' => [11, 99]],         // unknown option
        ['option_ids' => ['a' => 11, 'b' => 12]],
    ] as $bad) {
        qpChoiceRejects(fn () => $type->validateAnswer($bad, $config, $options));
    }

    // No maximum: everything may be picked. Minimum capped at the option count.
    $open = ['result_layout' => 'bars', 'min_selections' => 5, 'max_selections' => null];
    expect($type->validateAnswer(['option_ids' => [14, 13, 12, 11]], $open, $options))->toBe(['option_ids' => [11, 12, 13, 14]]);
    qpChoiceRejects(fn () => $type->validateAnswer(['option_ids' => [11, 12, 13]], $open, $options));
});

it('aggregates poll_multi selections with share of participants', function () {
    $type = app(SlideTypeRegistry::class)->for('poll_multi');
    $options = qpChoiceOptions();
    $answers = collect([
        qpChoiceAnswer(1, ['option_ids' => [11, 12]]),
        qpChoiceAnswer(2, ['option_ids' => [12]]),
        qpChoiceAnswer(3, ['option_ids' => [11, 12, 13]]),
        qpChoiceAnswer(4, ['option_ids' => [12, 12]]), // duplicate in a bad row counts once
    ]);

    $expected = [
        'total_responses' => 4,
        'total_votes' => 7,
        'average_selections_per_participant' => 1.75,
        'options' => [
            ['option_id' => 11, 'count' => 2, 'percentage' => 50.0],
            ['option_id' => 12, 'count' => 4, 'percentage' => 100.0],
            ['option_id' => 13, 'count' => 1, 'percentage' => 25.0],
        ],
    ];

    expect($type->aggregate([], $options, $answers))->toBe($expected)
        ->and($type->aggregate([], array_reverse($options), $answers->shuffle()->values()))->toBe($expected)
        ->and($type->aggregate([], $options, collect())['average_selections_per_participant'])->toBe(0.0);
});
