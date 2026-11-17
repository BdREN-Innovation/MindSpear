<?php

use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Content\BigTextSlideType;
use App\Deck\Slides\Types\Content\BulletsSlideType;
use App\Deck\Slides\Types\Content\HeadingSlideType;
use App\Deck\Slides\Types\Content\ImageSlideType;
use App\Deck\Slides\Types\Content\NumberedSlideType;
use App\Deck\Slides\Types\Content\ParagraphSlideType;
use App\Deck\Slides\Types\Content\QrCodeSlideType;
use App\Deck\Slides\Types\Content\QuoteSlideType;
use App\Deck\Slides\Types\Content\VideoSlideType;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/*
 * Behaviour every content slide type shares: discovery, metadata, no
 * answers, empty aggregate, zero score and a participant view without any
 * aggregate or answer-key data.
 */

uses(DatabaseTransactions::class);

/** @return array<string, array{0:string, 1:class-string, 2:array}> key => [key, class, a valid non-default config] */
function deckContentTypeCases(): array
{
    return [
        'heading' => ['heading', HeadingSlideType::class, ['subtitle' => 'Q3 all-hands']],
        'paragraph' => ['paragraph', ParagraphSlideType::class, ['align' => 'center', 'text_size' => 'large']],
        'bullets' => ['bullets', BulletsSlideType::class, ['items' => ['One', 'Two']]],
        'numbered' => ['numbered', NumberedSlideType::class, ['items' => ['First', 'Second', 'Third']]],
        'quote' => ['quote', QuoteSlideType::class, ['text' => "Stay hungry.\nStay foolish.", 'attribution' => 'Steve Jobs']],
        'image' => ['image', ImageSlideType::class, ['caption' => 'Our team', 'alt' => 'Six people']],
        'video' => ['video', VideoSlideType::class, ['video_url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ']],
        'big_text' => ['big_text', BigTextSlideType::class, ['text' => 'Part two']],
        'qr_code' => ['qr_code', QrCodeSlideType::class, ['show_join_code' => false]],
    ];
}

/** A run of a content type, snapshotting $config, with hostile extra data in the snapshot. */
function deckContentRun(string $key, array $config): DeckSessionSlideRun
{
    return DeckSessionSlideRun::factory()->inState(DeckSessionSlideRun::STATE_OPEN)->create([
        'type_snapshot' => $key,
        'title_snapshot' => 'Slide title',
        'body_snapshot' => ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'Hi']]]]],
        'config_snapshot' => $config + ['correct_answer' => 'leak', '_internal' => 'leak', 'answer_key' => ['leak']],
        'options_snapshot' => [
            ['id' => 991, 'position' => 1, 'label' => 'Stray', 'image_file_id' => 5, 'image_url' => null, 'is_correct' => true, 'payload' => ['correct_order_index' => 1, 'note' => 'ok']],
        ],
    ]);
}

dataset('deck content types', fn () => deckContentTypeCases());

it('is discovered by the registry with content metadata for both products', function (string $key, string $class) {
    $registry = app(SlideTypeRegistry::class);
    $type = $registry->for($key);

    expect($type)->toBeInstanceOf($class)
        ->and($type->key())->toBe($key)
        ->and($type->products())->toBe(['quest', 'quiz'])
        ->and($type->category())->toBe(SlideTypeContract::CATEGORY_CONTENT)
        ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_NONE)
        ->and($type->acceptsAnswers())->toBeFalse()
        ->and($type->defaultOptions())->toBe([])
        ->and(array_keys($registry->forProduct('quest')))->toContain($key)
        ->and(array_keys($registry->forProduct('quiz')))->toContain($key);
})->with('deck content types');

it('accepts its own default config unchanged', function (string $key) {
    $type = app(SlideTypeRegistry::class)->for($key);

    expect($type->validateConfig($type->defaultConfig()))->toBe($type->defaultConfig())
        ->and($type->validateConfig([]))->toBe($type->defaultConfig());
})->with('deck content types');

it('accepts a valid config, is idempotent and drops unknown keys', function (string $key, string $class, array $config) {
    $type = app(SlideTypeRegistry::class)->for($key);

    $normalised = $type->validateConfig($config + ['unknown_key' => 'x', '_private' => 'y']);

    expect(array_keys($normalised))->toBe(array_keys($type->defaultConfig()))
        ->and($type->validateConfig($normalised))->toBe($normalised);
})->with('deck content types');

it('rejects every answer payload', function (string $key, string $class, array $config) {
    $type = app(SlideTypeRegistry::class)->for($key);
    $options = [['id' => 1, 'position' => 1, 'label' => 'A', 'image_file_id' => null, 'image_url' => null, 'is_correct' => null, 'payload' => []]];

    foreach ([[], ['option_id' => 1], ['option_id' => 999], ['value' => -5], ['text' => 'hello']] as $payload) {
        try {
            $type->validateAnswer($payload, $config, $options);
            $this->fail('Content slide accepted an answer: ' . json_encode($payload));
        } catch (ValidationException $e) {
            expect($e->errors())->toHaveKey('answer')
                ->and($e->errors()['answer'][0])->toBe('This slide does not accept answers.');
        }
    }
})->with('deck content types');

it('scores zero', function (string $key, string $class, array $config) {
    $score = app(SlideTypeRegistry::class)->for($key)->score(['option_id' => 1], $config, [], 1200);

    expect($score->pointsAwarded)->toBe(0)
        ->and($score->isCorrect)->toBeNull()
        ->and($score->partialCreditRatio)->toBeNull();
})->with('deck content types');

it('aggregates to an empty array, deterministically, even with stray answers', function (string $key, string $class, array $config) {
    $type = app(SlideTypeRegistry::class)->for($key);
    $answers = new Collection([
        new DeckParticipantAnswer(['answer_payload' => ['option_id' => 1]]),
        new DeckParticipantAnswer(['answer_payload' => ['text' => 'stray']]),
    ]);

    expect($type->aggregate($config, [], $answers))->toBe([])
        ->and($type->aggregate($config, [], $answers->reverse()))->toBe([])
        ->and($type->aggregate($config, [], new Collection()))->toBe([]);

    // Through the registry, with real (stray) answer rows on the run.
    $run = deckContentRun($key, $type->validateConfig($config));
    DeckParticipantAnswer::factory()->create(['slide_run_id' => $run->id, 'answer_payload' => ['option_id' => 991]]);

    expect(app(SlideTypeRegistry::class)->aggregate($run))->toBe([]);
})->with('deck content types');

it('serialises for participants without aggregate or answer-key data', function (string $key, string $class, array $config) {
    $type = app(SlideTypeRegistry::class)->for($key);
    $normalised = $type->validateConfig($config);
    $run = deckContentRun($key, $normalised);

    $view = $type->serializeForParticipant($run);
    $json = json_encode($view);

    expect($view)->not->toHaveKey('aggregate')
        ->and($view['type'])->toBe($key)
        ->and($view['category'])->toBe('content')
        ->and($view['reveal_model'])->toBe('none')
        ->and($view['accepts_answers'])->toBeFalse()
        ->and($view['title'])->toBe('Slide title')
        ->and($view['body'])->toEqual($run->body_snapshot)
        ->and($view['config'])->toEqual($normalised)
        ->and($json)->not->toContain('is_correct')
        ->and($json)->not->toContain('correct_order_index')
        ->and($json)->not->toContain('image_file_id')
        ->and($json)->not->toContain('leak');

    $presenter = $type->serializeForPresenter($run, []);
    expect($presenter['aggregate'])->toBe([])
        ->and(collect($presenter)->except('aggregate')->all())->toEqual($view);
})->with('deck content types');

it('uses the slide title as the heading title, not a second config title', function () {
    $type = app(SlideTypeRegistry::class)->for('heading');
    $config = $type->validateConfig(['title' => 'Competing title', 'subtitle' => 'Q3 all-hands']);
    $view = $type->serializeForParticipant(deckContentRun('heading', $config));

    expect($config)->toBe(['subtitle' => 'Q3 all-hands'])
        ->and($view['title'])->toBe('Slide title')
        ->and($view['config'])->toBe(['subtitle' => 'Q3 all-hands']);
});
