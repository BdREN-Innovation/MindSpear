<?php

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\TakesMedia;
use App\Deck\Slides\Types\Quest\PollSettings;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use App\Models\File;
use App\Services\Live\LiveAggregateService;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Event;
use Illuminate\Validation\ValidationException;

/*
 * Phase 1 exit criteria across packages: every registered type against the
 * shared contract, and one deck holding a slide of every Quest type taken
 * through snapshot -> answer -> aggregate -> broadcast.
 */

uses(DatabaseTransactions::class);

beforeEach(function () {
    config(['broadcasting.default' => 'null']);
});

const P1I_QUEST_TYPES = [
    'poll_single', 'poll_multi', 'word_cloud', 'open_ended', 'scales', 'ranking',
    'qa_audience', 'points_allocation', 'rating', 'matrix_2x2', 'pin_on_image',
];

const P1I_CONTENT_TYPES = [
    'heading', 'paragraph', 'bullets', 'numbered', 'quote', 'image', 'video', 'big_text', 'qr_code',
];

// Quiz v2 types (tests/Feature/Deck/Quiz cover them); listed so the registry check below stays exact.
const P1I_QUIZ_TYPES = [
    'pick_answer_single', 'pick_answer_multi', 'short_answer', 'match_pairs', 'correct_order', 'categorise',
    'spinner_wheel', 'leaderboard',
];

function p1iType(string $key): SlideTypeContract
{
    return app(SlideTypeRegistry::class)->for($key);
}

function p1iImageFile(int $ownerId): File
{
    return File::create([
        'name' => 'phase1.png',
        'type' => 'image',
        'category' => File::CATEGORY_IMAGE,
        'visibility' => File::VISIBILITY_PUBLIC,
        'path' => "storage/library/{$ownerId}/images/phase1.png",
        'mime_type' => 'image/png',
        'extension' => 'png',
        'size' => 10,
        'width' => 800,
        'height' => 600,
        'user_id' => $ownerId,
    ]);
}

/** A quest deck with one slide of every Quest type, seeded from the type defaults. */
function p1iDeck(): Deck
{
    $owner = DeckFactory::newOwner();
    $deck = Deck::factory()->ownedBy($owner)->create();
    $image = p1iImageFile($owner->id);

    foreach (array_keys(app(SlideTypeRegistry::class)->forProduct(Deck::PRODUCT_QUEST)) as $key) {
        $type = p1iType($key);
        $slide = Slide::factory()->for($deck)->ofType($key, $type->defaultConfig())->create([
            'media_file_id' => in_array($key, ['pin_on_image', 'image'], true) ? $image->id : null,
        ]);

        foreach ($type->defaultOptions() as $i => $option) {
            SlideOption::factory()->for($slide)->create([
                'position' => $i + 1,
                'label' => $option['label'] ?? 'Option ' . ($i + 1),
                'payload' => $option['payload'] ?? [],
            ]);
        }
    }

    return $deck;
}

/** Session start as the plan describes it: snapshot every slide, media through TakesMedia. */
function p1iStart(Deck $deck): DeckSession
{
    $session = DeckSession::factory()->live()->create(['deck_id' => $deck->id]);

    foreach ($deck->slides()->with(['options', 'mediaFile'])->orderBy('position')->get() as $slide) {
        $type = p1iType($slide->type);
        $config = $type instanceof TakesMedia
            ? $type->withMedia($slide->config ?? [], $slide->mediaFile)
            : ($slide->config ?? []);

        if (method_exists($type, 'requiresMedia') && $type->requiresMedia()) {
            $type->assertMediaPresent($config);
        }

        DeckSessionSlideRun::factory()->fromSlide($slide)->inState(DeckSessionSlideRun::STATE_VOTING)->create([
            'deck_session_id' => $session->id,
            'config_snapshot' => $config,
        ]);
    }

    return $session;
}

/** One valid participant answer per Quest answer type, built from the run's options. */
function p1iSampleAnswer(string $key, array $optionIds): array
{
    return match ($key) {
        'poll_single' => ['option_id' => $optionIds[0]],
        'poll_multi' => ['option_ids' => [$optionIds[0], $optionIds[2]]],
        'word_cloud' => ['entries' => ['Kickoff', 'momentum']],
        'open_ended' => ['text' => 'More time for questions, please.'],
        'scales' => ['ratings' => [['option_id' => $optionIds[0], 'value' => 4]]],
        'ranking' => ['order' => array_reverse($optionIds)],
        'points_allocation' => ['allocations' => [['option_id' => $optionIds[0], 'points' => 60], ['option_id' => $optionIds[1], 'points' => 40]]],
        'rating' => ['ratings' => [['option_id' => $optionIds[1], 'value' => 5]]],
        'matrix_2x2' => ['x' => 25, 'y' => 75],
        'pin_on_image' => ['x' => 10.5, 'y' => 20.25],
    };
}

it('registers exactly the 11 Quest types and 9 content types, shared with Quiz where the plan says', function () {
    $registry = app(SlideTypeRegistry::class);
    $all = array_merge(P1I_QUEST_TYPES, P1I_CONTENT_TYPES);
    sort($all);

    expect($registry->keys())->toBe(collect([...$all, ...P1I_QUIZ_TYPES])->sort()->values()->all())
        ->and(array_keys($registry->forProduct('quest')))->toBe($all)
        ->and(array_keys($registry->forProduct('quiz')))->toBe(collect([...P1I_CONTENT_TYPES, ...P1I_QUIZ_TYPES])->sort()->values()->all());

    foreach (P1I_QUEST_TYPES as $key) {
        expect(p1iType($key)->products())->toBe(['quest']);
    }
});

it('implements the shared contract the same way for every type', function (string $key) {
    $type = p1iType($key);
    $content = in_array($key, P1I_CONTENT_TYPES, true);

    // Defaults are valid, stable, and unknown or server-owned keys never survive validateConfig.
    expect($type->key())->toBe($key)
        ->and($type->validateConfig($type->defaultConfig()))->toBe($type->defaultConfig())
        ->and($type->validateConfig(['__unknown__' => 1]))->not->toHaveKey('__unknown__')
        ->and($type->validateConfig(['media' => ['file_id' => 1, 'url' => 'https://evil.example/x.png', 'width' => 1, 'height' => 1, 'mime' => 'image/png']]))
        ->not->toHaveKey('media')
        ->and($type->score([], $type->defaultConfig(), [], 1000))->toEqual(ScoreResult::zero());

    foreach ($type->defaultOptions() as $option) {
        expect(array_keys($option))->toBe(['label', 'payload'])
            ->and($option['payload'])->toBeArray();
    }

    if ($content) {
        expect($type->category())->toBe(SlideTypeContract::CATEGORY_CONTENT)
            ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_NONE)
            ->and($type->acceptsAnswers())->toBeFalse()
            ->and($type->products())->toBe(['quest', 'quiz'])
            ->and($type)->toBeInstanceOf(TakesMedia::class);
    } elseif ($key === 'qa_audience') {
        expect($type->category())->toBe(SlideTypeContract::CATEGORY_INTERACTIVE)
            ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_MODERATED)
            ->and($type->acceptsAnswers())->toBeFalse();
    } else {
        // Every Quest answer type is a live poll whose results stay on the presenter by default (§5.6).
        expect($type->category())->toBe(SlideTypeContract::CATEGORY_POLL)
            ->and($type->revealModel())->toBe(SlideTypeContract::REVEAL_LIVE)
            ->and($type->acceptsAnswers())->toBeTrue()
            ->and($type->defaultConfig())->toHaveKey(PollSettings::SHOW_RESULTS, false)
            ->and($type->validateConfig([PollSettings::SHOW_RESULTS => true])[PollSettings::SHOW_RESULTS])->toBeTrue();
    }

    if (! $type->acceptsAnswers()) {
        expect(fn () => $type->validateAnswer(['option_id' => 1], $type->defaultConfig(), []))->toThrow(ValidationException::class);
    }
})->with(array_merge(P1I_QUEST_TYPES, P1I_CONTENT_TYPES));

it('snapshots a deck with every Quest type and never shows participants results or answer keys', function () {
    $session = p1iStart(p1iDeck());
    $runs = $session->runs()->orderBy('position_snapshot')->get();

    expect($runs)->toHaveCount(20)
        ->and($runs->pluck('type_snapshot')->sort()->values()->all())->toBe(collect(array_merge(P1I_QUEST_TYPES, P1I_CONTENT_TYPES))->sort()->values()->all());

    // Media came from My Files through withMedia, with File::url.
    $pin = $runs->firstWhere('type_snapshot', 'pin_on_image');
    $file = File::findOrFail($pin->slide->media_file_id);
    expect($pin->config_snapshot['media'])->toMatchArray(['file_id' => $file->id, 'url' => $file->url, 'width' => 800, 'height' => 600])
        ->and($runs->firstWhere('type_snapshot', 'image')->config_snapshot['media']['url'])->toBe($file->url)
        ->and($runs->firstWhere('type_snapshot', 'video')->config_snapshot['media'])->toBeNull();

    // Snapshots are queryable jsonb: every live poll starts with results hidden from participants.
    $hidden = DeckSessionSlideRun::where('deck_session_id', $session->id)
        ->whereRaw('config_snapshot @> ?::jsonb', [json_encode([PollSettings::SHOW_RESULTS => false])])
        ->pluck('type_snapshot')->sort()->values()->all();
    expect($hidden)->toBe(collect(P1I_QUEST_TYPES)->reject(fn ($k) => $k === 'qa_audience')->sort()->values()->all());

    foreach ($runs as $run) {
        // Mark an option as correct to prove the participant view strips answer keys.
        $options = $run->options_snapshot;
        if ($options !== []) {
            $options[0]['is_correct'] = true;
            $run->options_snapshot = $options;
        }

        $type = p1iType($run->type_snapshot);
        $aggregate = app(SlideTypeRegistry::class)->aggregate($run);
        $participant = $type->serializeForParticipant($run);

        expect($participant)->not->toHaveKey('aggregate')
            ->and(json_encode($participant))->not->toContain('is_correct')
            ->and(json_encode($aggregate, JSON_THROW_ON_ERROR))->toBeString()
            ->and($type->serializeForPresenter($run, $aggregate)['aggregate'])->toBe($aggregate);
    }
});

it('takes one answer of every Quest answer type through validate, store, aggregate and broadcast', function () {
    Event::fake([LiveBroadcastEvent::class]);
    $session = p1iStart(p1iDeck());
    $registry = app(SlideTypeRegistry::class);
    $aggregates = app(LiveAggregateService::class);
    $answerTypes = $session->runs()->get()->filter(fn ($run) => p1iType($run->type_snapshot)->acceptsAnswers());

    expect($answerTypes->pluck('type_snapshot')->sort()->values()->all())
        ->toBe(collect(P1I_QUEST_TYPES)->reject(fn ($k) => $k === 'qa_audience')->sort()->values()->all());

    foreach ($answerTypes as $run) {
        $type = p1iType($run->type_snapshot);
        $optionIds = array_column($run->options_snapshot, 'id');
        $stored = $type->validateAnswer(p1iSampleAnswer($run->type_snapshot, $optionIds), $run->config_snapshot, $run->options_snapshot);

        DeckParticipantAnswer::factory()->create(['slide_run_id' => $run->id, 'answer_payload' => $stored]);
        $aggregate = $registry->aggregate($run->fresh());

        expect($aggregate['total_responses'])->toBe(1, $run->type_snapshot);

        // Default slides keep the live chart on the presenter; turning the setting on makes it public.
        $aggregates->broadcastDeckAggregateNow($run);
        $run->update(['config_snapshot' => [...$run->config_snapshot, PollSettings::SHOW_RESULTS => true]]);
        $aggregates->broadcastDeckAggregateNow($run->fresh());
    }

    $events = Event::dispatched(LiveBroadcastEvent::class)->map(fn ($call) => $call[0])
        ->filter(fn (LiveBroadcastEvent $e) => $e->broadcastAs() === 'slide.aggregate.updated')->values();

    expect($events)->toHaveCount(2 * $answerTypes->count());
    foreach ($events->chunk(2) as $pair) {
        [$hostOnly, $public] = $pair->values()->all();
        expect($hostOnly->broadcastOn()->name)->toBe("private-host.quest.v2.{$session->id}")
            ->and($public->broadcastOn()->name)->toBe("session.quest.{$session->public_channel_key}")
            ->and($public->broadcastWith()['total_responses'])->toBe(1)
            // Pusher HTTP body (event data is JSON inside JSON) stays far below Reverb's 10 KB limit.
            ->and(strlen(json_encode(['name' => 'slide.aggregate.updated', 'data' => json_encode($public->broadcastWith()), 'channels' => [$public->broadcastOn()->name]])))
            ->toBeLessThan(10_000);
    }

});

it('rejects oversized answer lists up front in every list-based answer type', function (string $key, string $field, Closure $item) {
    $type = p1iType($key);
    $options = array_map(fn (int $i) => ['id' => 500 + $i, 'position' => $i, 'label' => "O{$i}", 'image_file_id' => null, 'image_url' => null, 'is_correct' => null, 'payload' => []], range(1, 4));
    $config = $type->validateConfig($type->defaultConfig());
    $limit = match ($key) {
        'word_cloud' => $config['max_entries_per_participant'],
        'pin_on_image' => $config['max_pins_per_participant'],
        default => count($options),
    };

    // One over the limit fails with the list key; a 20,000-entry list fails just as fast.
    foreach ([$limit + 1, 20_000] as $length) {
        $payload = [$field => array_map($item, range(1, $length))];
        $started = hrtime(true);

        try {
            $type->validateAnswer($payload, $config, $options);
            $this->fail("{$key} accepted {$length} {$field}.");
        } catch (ValidationException $e) {
            expect($e->errors())->toHaveKey($field)
                ->and($e->errors()[$field][0])->toBe("The {$field} field must not have more than {$limit} items.");
        }

        expect((hrtime(true) - $started) / 1e9)->toBeLessThan(1.0);
    }
})->with([
    'poll_multi option_ids' => ['poll_multi', 'option_ids', fn (int $i) => 500 + $i],
    'ranking order' => ['ranking', 'order', fn (int $i) => 500 + $i],
    'scales ratings' => ['scales', 'ratings', fn (int $i) => ['option_id' => 500 + $i, 'value' => 1]],
    'word_cloud entries' => ['word_cloud', 'entries', fn (int $i) => "word{$i}"],
    'rating ratings' => ['rating', 'ratings', fn (int $i) => ['option_id' => 500 + $i, 'value' => 1]],
    'points_allocation allocations' => ['points_allocation', 'allocations', fn (int $i) => ['option_id' => 500 + $i, 'points' => 0]],
    'pin_on_image pins' => ['pin_on_image', 'pins', fn (int $i) => ['x' => 1, 'y' => 1]],
]);
