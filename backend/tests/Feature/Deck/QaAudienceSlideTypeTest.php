<?php

use App\Deck\Qa\LiveQaService;
use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quest\QaAudienceSlideType;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Validation\ValidationException;

uses(DatabaseTransactions::class);

function tiQaType(): QaAudienceSlideType
{
    return app(SlideTypeRegistry::class)->for('qa_audience');
}

function tiQaRun(array $config = [], string $state = DeckSessionSlideRun::STATE_OPEN): DeckSessionSlideRun
{
    $run = new DeckSessionSlideRun();
    $run->forceFill([
        'id' => 9101,
        'deck_session_id' => 1,
        'slide_id' => 77,
        'position_snapshot' => 1,
        'type_snapshot' => 'qa_audience',
        'title_snapshot' => 'Ask me anything',
        'body_snapshot' => null,
        'config_snapshot' => $config,
        'options_snapshot' => [],
        'state' => $state,
        'state_version' => 3,
    ]);

    return $run;
}

it('is discovered by the registry as an interactive moderated-feed Quest type', function () {
    $registry = app(SlideTypeRegistry::class);

    expect($registry->for('qa_audience'))->toBeInstanceOf(QaAudienceSlideType::class)
        ->and($registry->forProduct('quest'))->toHaveKey('qa_audience')
        ->and($registry->forProduct('quiz'))->not->toHaveKey('qa_audience');

    $type = tiQaType();
    expect($type->category())->toBe(SlideTypeContract::CATEGORY_INTERACTIVE)
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_MODERATED)
        ->and($type->acceptsAnswers())->toBeFalse()
        ->and($type->defaultOptions())->toBe([]);
});

it('accepts its own default config', function () {
    $type = tiQaType();

    expect($type->validateConfig($type->defaultConfig()))->toBe($type->defaultConfig())
        ->and($type->validateConfig([]))->toBe([
            'allow_anonymous' => true,
            'show_feed_to_participants' => true,
            'sort' => 'top',
            'profanity_filter_enabled' => true,
            'max_question_length' => 280,
        ]);
});

it('normalises config values and drops unknown keys', function () {
    $config = tiQaType()->validateConfig([
        'allow_anonymous' => 0,
        'show_feed_to_participants' => '1',
        'sort' => 'new',
        'something_else' => 'x',
    ]);

    expect($config)->toBe([
        'allow_anonymous' => false,
        'show_feed_to_participants' => true,
        'sort' => 'newest',
        'profanity_filter_enabled' => true,
        'max_question_length' => 280,
    ]);
});

it('keeps a per-slide question length that LiveQaService enforces and participants can see', function () {
    // LiveQaService::submitQuestion reads max_question_length from the snapshot
    // (QaServiceTest covers the enforcement); the participant UI needs it for its counter.
    $config = tiQaType()->validateConfig(['max_question_length' => '50']);

    expect($config['max_question_length'])->toBe(50)
        ->and(tiQaType()->defaultConfig()['max_question_length'])->toBe(LiveQaService::MAX_BODY_LENGTH)
        ->and(tiQaType()->validateConfig(['max_question_length' => 10])['max_question_length'])->toBe(10)
        ->and(tiQaType()->validateConfig(['max_question_length' => 1000])['max_question_length'])->toBe(LiveQaService::MAX_BODY_LENGTH_CEILING)
        ->and(tiQaType()->serializeForParticipant(tiQaRun($config))['config'])->toHaveKey('max_question_length', 50);
});

it('rejects bad config', function (array $config) {
    expect(fn () => tiQaType()->validateConfig($config))->toThrow(ValidationException::class);
})->with([
    'unknown sort' => [['sort' => 'random']],
    'non-boolean anonymous' => [['allow_anonymous' => 'yes please']],
    'non-boolean feed flag' => [['show_feed_to_participants' => []]],
    'non-boolean profanity flag' => [['profanity_filter_enabled' => 'sometimes']],
    'question length below 10' => [['max_question_length' => 9]],
    'question length above the service ceiling' => [['max_question_length' => 1001]],
    'question length not an integer' => [['max_question_length' => 'long']],
    'question length null' => [['max_question_length' => null]],
]);

it('never accepts answers through the answer pipeline', function (array $payload) {
    expect(fn () => tiQaType()->validateAnswer($payload, tiQaType()->defaultConfig(), []))
        ->toThrow(ValidationException::class);
})->with([
    'a question body' => [['body' => 'What is next?']],
    'empty payload' => [[]],
]);

it('scores zero', function () {
    $result = tiQaType()->score(['body' => 'x'], [], [], 1000);

    expect($result)->toEqual(ScoreResult::zero())
        ->and($result->pointsAwarded)->toBe(0)
        ->and($result->isCorrect)->toBeNull();
});

it('aggregates to a deterministic description of the feed', function () {
    $type = tiQaType();
    $config = $type->validateConfig(['sort' => 'newest', 'allow_anonymous' => false]);
    $answers = collect([new DeckParticipantAnswer(['answer_payload' => ['body' => 'ignored']])]);

    $first = $type->aggregate($config, [], $answers);

    expect($first)->toBe([
        'total_responses' => 0,
        'feed_source' => 'live_qa',
        'sort' => 'newest',
        'show_feed_to_participants' => true,
        'allow_anonymous' => false,
    ])->and($type->aggregate($config, [], $answers))->toBe($first)
        ->and($type->aggregate([], [], collect())['sort'])->toBe('top');
});

it('serialises for participants without aggregate or answer-key data', function () {
    $type = tiQaType();
    $run = tiQaRun(array_merge($type->defaultConfig(), ['_internal' => 'x', 'correct_answer' => 'y']));

    $view = $type->serializeForParticipant($run);
    $json = json_encode($view);

    expect($view)->not->toHaveKey('aggregate')
        ->and($view['type'])->toBe('qa_audience')
        ->and($view['accepts_answers'])->toBeFalse()
        ->and($view['reveal_model'])->toBe('moderated_feed')
        ->and($view['config'])->toBe($type->defaultConfig())
        ->and($json)->not->toContain('is_correct')
        ->and($json)->not->toContain('_internal')
        ->and($json)->not->toContain('correct_answer');

    $presenter = $type->serializeForPresenter($run, $type->aggregate($run->config_snapshot, [], collect()));
    expect($presenter['aggregate']['feed_source'])->toBe('live_qa');
});
