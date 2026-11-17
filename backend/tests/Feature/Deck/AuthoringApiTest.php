<?php

use App\Deck\Authoring\DeckSettings;
use App\Deck\Slides\AbstractSlideType;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Authoring\SlideAuthoringService;
use App\Deck\Authoring\SlideBroadcastBudget;
use App\Deck\Authoring\SlideInput;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use App\Models\File;
use App\Models\User;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

/*
 * Phase 2 authoring API (/api/v1/quests): plan §2.1, §2.2, §2.5 and the
 * §5.7 bulk endpoint. Exit criteria: create, append every Quest type, edit
 * each, reorder, duplicate, delete; Quiz-only types rejected.
 */

uses(DatabaseTransactions::class);

beforeEach(function () {
    config(['broadcasting.default' => 'null', 'cache.default' => 'array', 'queue.default' => 'sync']);
});

function authApiUrl(string $path = ''): string
{
    return '/api/v1/quests' . $path;
}

function authApiSignIn(?User $user = null): User
{
    $user ??= DeckFactory::newOwner();
    Sanctum::actingAs($user);

    return $user;
}

/** POST /quests as the signed-in user; returns data.deck. */
function authApiCreateDeck(array $body = []): array
{
    return test()->postJson(authApiUrl(), $body)->assertCreated()->json('data.deck');
}

/** Appends a slide of $type; returns data.slide. */
function authApiAppend(int $deckId, string $type, array $extra = []): array
{
    return test()->postJson(authApiUrl("/{$deckId}/slides"), ['type' => $type] + $extra)->assertCreated()->json('data.slide');
}

/** @return list<array{id:int, position:int}> live slides of the deck, from the DB */
function authApiOrder(int $deckId): array
{
    return Slide::query()->where('deck_id', $deckId)->orderBy('position')->get(['id', 'position'])
        ->map(fn (Slide $s) => ['id' => (int) $s->id, 'position' => (int) $s->position])->all();
}

function authApiFile(User $owner, string $mime = 'image/png'): File
{
    $ext = Str::after($mime, '/');

    return File::create([
        'name' => 'authapi-' . Str::random(6) . ".{$ext}",
        'type' => Str::before($mime, '/'),
        'category' => str_starts_with($mime, 'video/') ? 'video' : File::CATEGORY_IMAGE,
        'visibility' => File::VISIBILITY_PUBLIC,
        'path' => "storage/library/{$owner->id}/images/authapi.{$ext}",
        'mime_type' => $mime,
        'extension' => $ext,
        'size' => 1024,
        'width' => 640,
        'height' => 480,
        'user_id' => $owner->id,
    ]);
}

/**
 * One author edit per Quest-product type: [config sent, config expected
 * back (subset)]. Every type the registry offers Quest must be listed.
 */
function authApiEdits(): array
{
    return [
        'poll_single' => [['submit_mode' => 'confirm', 'result_layout' => 'donut'], ['submit_mode' => 'confirm', 'result_layout' => 'donut', 'show_results_to_participants' => false]],
        'poll_multi' => [['min_selections' => 2, 'max_selections' => 3, 'show_results_to_participants' => true], ['min_selections' => 2, 'max_selections' => 3, 'show_results_to_participants' => true]],
        'word_cloud' => [['max_entries_per_participant' => 5, 'allow_multiple_submissions' => true], ['max_entries_per_participant' => 5, 'allow_multiple_submissions' => true, 'max_entry_length' => 25]],
        'open_ended' => [['max_length' => 300, 'max_submissions_per_participant' => 3], ['max_length' => 300, 'max_submissions_per_participant' => 3]],
        'scales' => [['scale_points' => 3, 'scale_labels' => ['Low', null, 'High']], ['scale_points' => 3, 'scale_labels' => ['Low', null, 'High']]],
        'ranking' => [['require_full_ranking' => false], ['require_full_ranking' => false]],
        'qa_audience' => [['sort' => 'new', 'allow_anonymous' => false], ['sort' => 'newest', 'allow_anonymous' => false, 'show_feed_to_participants' => true]],
        'points_allocation' => [['total_points' => 50], ['total_points' => 50]],
        'rating' => [['scale' => 10, 'require_all_items' => true], ['scale' => 10, 'require_all_items' => true]],
        'matrix_2x2' => [['x_axis' => ['low' => 'Cheap', 'high' => 'Pricey'], 'y_axis' => ['high' => 'Fast']], ['x_axis' => ['low' => 'Cheap', 'high' => 'Pricey'], 'y_axis' => ['low' => '', 'high' => 'Fast']]],
        'pin_on_image' => [['max_pins_per_participant' => 3], ['max_pins_per_participant' => 3]],
        'heading' => [['subtitle' => 'Welcome aboard'], ['subtitle' => 'Welcome aboard']],
        'paragraph' => [['align' => 'center', 'text_size' => 'large'], ['align' => 'center', 'text_size' => 'large']],
        'bullets' => [['items' => ['One', 'Two']], ['items' => ['One', 'Two']]],
        'numbered' => [['items' => ['First', 'Second', 'Third']], ['items' => ['First', 'Second', 'Third']]],
        'quote' => [['text' => 'Stay hungry.', 'attribution' => 'S. Jobs'], ['text' => 'Stay hungry.', 'attribution' => 'S. Jobs']],
        'image' => [['caption' => 'Our team', 'alt' => 'Five people smiling'], ['caption' => 'Our team', 'alt' => 'Five people smiling']],
        // The link is set through PUT /slides/{id}/media, never through config.
        'video' => [['video_url' => 'https://youtu.be/dQw4w9WgXcQ'], ['video_url' => null, 'embed_url' => null]],
        'big_text' => [['text' => 'Coffee break'], ['text' => 'Coffee break']],
        'qr_code' => [['show_join_code' => false], ['show_join_code' => false]],
    ];
}

it('creates a quest, appends every Quest type, edits each, reorders, duplicates and deletes it (Phase 2 exit)', function () {
    $owner = authApiSignIn();
    $registry = app(SlideTypeRegistry::class);

    // Create: one qr_code slide first, full default settings.
    $created = authApiCreateDeck(['title' => 'Team retro', 'description' => 'Sprint 42']);
    expect($created)->toMatchArray(['product' => 'quest', 'title' => 'Team retro', 'description' => 'Sprint 42', 'slideCount' => 1])
        ->and($created['settings'])->toBe(DeckSettings::DEFAULTS)
        ->and($created['slides'])->toHaveCount(1)
        ->and($created['slides'][0])->toMatchArray(['type' => 'qr_code', 'position' => 1, 'category' => 'content', 'config' => ['show_join_code' => true], 'options' => []]);
    $deckId = $created['id'];
    expect(Deck::find($deckId)->owner_id)->toBe($owner->id);

    // Append every Quest type, seeded from the registry.
    $questTypes = $registry->forProduct('quest');
    expect(array_keys(authApiEdits()))->toEqualCanonicalizing(array_keys($questTypes));

    $ids = [];
    foreach (array_values($questTypes) as $index => $type) {
        $slide = authApiAppend($deckId, $type->key());

        expect($slide)->toMatchArray([
            'deckId' => $deckId,
            'type' => $type->key(),
            'position' => $index + 2,
            'category' => $type->category(),
            'revealModel' => $type->revealModel(),
            'acceptsAnswers' => $type->acceptsAnswers(),
            'title' => null,
            'mediaFileId' => null,
        ])
            ->and($slide['config'])->toEqual(json_decode(json_encode((object) $type->defaultConfig()), true))
            ->and($slide['options'])->toHaveCount(count($type->defaultOptions()))
            ->and(array_column($slide['options'], 'position'))->toBe($type->defaultOptions() === [] ? [] : range(1, count($type->defaultOptions())));

        $ids[$type->key()] = $slide['id'];
    }

    expect(authApiOrder($deckId))->toHaveCount(count($questTypes) + 1)
        ->and(array_column(authApiOrder($deckId), 'position'))->toBe(range(1, count($questTypes) + 1));

    // Edit each: title + config (+ a timer on answer types).
    foreach (authApiEdits() as $key => [$send, $expect]) {
        $type = $registry->for($key);
        $body = ['title' => "Edited {$key}", 'config' => $send];
        if ($type->acceptsAnswers()) {
            $body['time_limit_seconds'] = 45;
        }

        $slide = $this->patchJson(authApiUrl("/{$deckId}/slides/{$ids[$key]}"), $body)->assertOk()->json('data.slide');

        expect($slide['title'])->toBe("Edited {$key}")
            ->and($slide['config'])->toMatchArray($expect)
            ->and($slide['timeLimitSeconds'])->toBe($type->acceptsAnswers() ? 45 : null)
            ->and(Slide::find($ids[$key])->config)->toMatchArray($expect);
    }

    $shown = $this->getJson(authApiUrl("/{$deckId}/slides/{$ids['scales']}"))->assertOk()->json('data.slide');
    expect($shown['config']['scale_labels'])->toBe(['Low', null, 'High']);

    // Reorder: reverse everything.
    $reversed = array_reverse(array_column(authApiOrder($deckId), 'id'));
    $order = $this->postJson(authApiUrl("/{$deckId}/slides/reorder"), [
        'slides' => array_map(fn ($id, $i) => ['id' => $id, 'position' => $i + 1], $reversed, array_keys($reversed)),
    ])->assertOk()->json('data.order');

    expect(array_column($order, 'id'))->toBe($reversed)
        ->and(array_column($order, 'position'))->toBe(range(1, count($reversed)))
        ->and(array_column($this->getJson(authApiUrl("/{$deckId}"))->json('data.deck.slides'), 'id'))->toBe($reversed);

    // File references for the duplicate: cover, slide media, option image.
    $image = authApiFile($owner);
    Deck::whereKey($deckId)->update(['cover_file_id' => $image->id]);
    Slide::whereKey($ids['image'])->update(['media_file_id' => $image->id]);
    SlideOption::where('slide_id', $ids['poll_single'])->orderBy('position')->first()->update(['image_file_id' => $image->id, 'label' => 'Yes']);
    $filesBefore = File::withTrashed()->count();

    // Duplicate the whole deck.
    $original = $this->getJson(authApiUrl("/{$deckId}"))->json('data.deck');
    $copy = $this->postJson(authApiUrl("/{$deckId}/duplicate"))->assertCreated()->json('data.deck');

    expect($copy['id'])->not->toBe($deckId)
        ->and($copy['title'])->toBe('Copy of Team retro')
        ->and($copy['coverFileId'])->toBe($image->id)
        ->and($copy['publishedAt'])->toBeNull()
        ->and($copy['slides'])->toHaveCount(count($original['slides']))
        ->and(File::withTrashed()->count())->toBe($filesBefore);

    foreach ($original['slides'] as $i => $slide) {
        $dup = $copy['slides'][$i];
        expect($dup['id'])->not->toBe($slide['id'])
            ->and($dup['deckId'])->toBe($copy['id'])
            ->and(collect($dup)->only(['type', 'position', 'title', 'body', 'config', 'mediaFileId', 'timeLimitSeconds', 'getReadySeconds'])->all())
            ->toEqual(collect($slide)->only(['type', 'position', 'title', 'body', 'config', 'mediaFileId', 'timeLimitSeconds', 'getReadySeconds'])->all())
            ->and(array_map(fn ($o) => [$o['position'], $o['label'], $o['imageFileId']], $dup['options']))
            ->toBe(array_map(fn ($o) => [$o['position'], $o['label'], $o['imageFileId']], $slide['options']));
    }

    // Delete: soft, gone from the API, the copy untouched.
    $this->deleteJson(authApiUrl("/{$deckId}"))->assertOk()->assertJsonPath('status', true);

    expect(Deck::withTrashed()->find($deckId)->trashed())->toBeTrue()
        ->and(Slide::where('deck_id', $deckId)->count())->toBe(count($original['slides']));
    $this->getJson(authApiUrl("/{$deckId}"))->assertNotFound()->assertJsonPath('data.code', 'not_found');
    $this->getJson(authApiUrl("/{$copy['id']}"))->assertOk();
    expect(array_column($this->getJson(authApiUrl())->json('data.items'), 'id'))->toBe([$copy['id']]);
});

it('rejects Quiz-only and unknown slide types with 422 unsupported_type', function () {
    app(SlideTypeRegistry::class)->register(new class () extends AbstractSlideType {
        public function key(): string
        {
            return 'authapi_quiz_only';
        }

        public function products(): array
        {
            return ['quiz'];
        }

        public function category(): string
        {
            return self::CATEGORY_POLL;
        }

        public function revealModel(): string
        {
            return self::REVEAL_HIDDEN;
        }
    });

    authApiSignIn();
    $deck = authApiCreateDeck();

    foreach (['authapi_quiz_only', 'no_such_type'] as $type) {
        $this->postJson(authApiUrl("/{$deck['id']}/slides"), ['type' => $type])
            ->assertStatus(422)
            ->assertJsonPath('status', false)
            ->assertJsonPath('message', 'Unsupported slide type for this product.')
            ->assertJsonPath('data.code', 'unsupported_type')
            ->assertJsonPath('data.type', $type)
            ->assertJsonPath('data.validation_errors.type.0', 'Unsupported slide type for this product.');
    }

    $this->postJson(authApiUrl("/{$deck['id']}/slides/bulk"), ['slides' => [
        ['type' => 'poll_single', 'title' => 'Fine'],
        ['type' => 'authapi_quiz_only', 'title' => 'Not here'],
    ]])
        ->assertStatus(422)
        ->assertJsonPath('data.code', 'unsupported_type')
        ->assertJsonPath('data.validation_errors', ['slides.1.type' => ['Unsupported slide type for this product.']]);

    $this->postJson(authApiUrl("/{$deck['id']}/slides"), [])->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['type']]]);

    expect(Slide::where('deck_id', $deck['id'])->count())->toBe(1);
});

it('answers 404 for other users\' decks, slides and options, and for quiz decks on the quest routes', function () {
    $owner = DeckFactory::newOwner();
    Sanctum::actingAs($owner);
    $theirs = authApiCreateDeck(['title' => 'Private']);
    $slide = authApiAppend($theirs['id'], 'poll_single');
    $optionId = $slide['options'][0]['id'];

    authApiSignIn();
    $mine = authApiCreateDeck();

    $d = $theirs['id'];
    $s = $slide['id'];
    $calls = [
        ['getJson', "/{$d}", []],
        ['patchJson', "/{$d}", ['title' => 'Mine now']],
        ['deleteJson', "/{$d}", []],
        ['postJson', "/{$d}/duplicate", []],
        ['postJson', "/{$d}/slides", ['type' => 'heading']],
        ['postJson', "/{$d}/slides/bulk", ['slides' => [['type' => 'heading']]]],
        ['postJson', "/{$d}/slides/reorder", ['slides' => [['id' => $s, 'position' => 1]]]],
        ['getJson', "/{$d}/slides/{$s}", []],
        ['patchJson', "/{$d}/slides/{$s}", ['title' => 'x']],
        ['deleteJson', "/{$d}/slides/{$s}", []],
        ['postJson', "/{$d}/slides/{$s}/duplicate", []],
        ['postJson', "/{$d}/slides/{$s}/options", ['label' => 'x']],
        ['patchJson', "/{$d}/slides/{$s}/options/{$optionId}", ['label' => 'x']],
        ['deleteJson', "/{$d}/slides/{$s}/options/{$optionId}", []],
        // Their slide / option through my deck.
        ['getJson', "/{$mine['id']}/slides/{$s}", []],
        ['patchJson', "/{$mine['id']}/slides/{$mine['slides'][0]['id']}/options/{$optionId}", ['label' => 'x']],
    ];

    foreach ($calls as [$method, $path, $body]) {
        $this->{$method}(authApiUrl($path), $body)->assertNotFound()->assertJsonPath('data.code', 'not_found');
    }

    expect(Deck::find($d)->title)->toBe('Private')
        ->and(Slide::where('deck_id', $d)->count())->toBe(2)
        ->and(SlideOption::find($optionId)->label)->toBeNull();

    // A quiz deck of the same user is not a quest.
    $quiz = Deck::factory()->quiz()->ownedBy(auth()->user())->create();
    $this->getJson(authApiUrl("/{$quiz->id}"))->assertNotFound();
    expect(array_column($this->getJson(authApiUrl())->json('data.items'), 'id'))->toBe([$mine['id']]);
});

it('requires a signed-in user', function () {
    $this->getJson(authApiUrl())->assertUnauthorized();
    $this->postJson(authApiUrl(), ['title' => 'x'])->assertUnauthorized();
});

it('caps options per type and keeps the minimums', function () {
    authApiSignIn();
    $deck = authApiCreateDeck();
    $add = fn (array $slide, array $body = ['label' => 'Another']) => $this->postJson(authApiUrl("/{$deck['id']}/slides/{$slide['id']}/options"), $body);
    $fill = function (array $slide, int $total) {
        $count = SlideOption::where('slide_id', $slide['id'])->count();
        for ($i = $count + 1; $i <= $total; $i++) {
            SlideOption::factory()->create(['slide_id' => $slide['id'], 'position' => $i, 'label' => "Item {$i}"]);
        }
    };

    foreach (['ranking' => 12, 'scales' => 20, 'poll_multi' => 30, 'rating' => 30] as $type => $cap) {
        $slide = authApiAppend($deck['id'], $type);
        $fill($slide, $cap - 1);

        $added = $add($slide, ['label' => '  Last one  ', 'payload' => ['note' => 'x']])->assertCreated()->json('data');
        expect($added['option'])->toMatchArray(['label' => 'Last one', 'position' => $cap, 'payload' => ['note' => 'x']])
            ->and($added['slide']['options'])->toHaveCount($cap);

        $add($slide)->assertStatus(422)->assertJsonPath('data.validation_errors.options.0', "This slide can have at most {$cap} options.");
        expect(SlideOption::where('slide_id', $slide['id'])->count())->toBe($cap);
    }

    // Minimums: 2 for poll_single / poll_multi / ranking, 1 for scales.
    foreach (['poll_single' => 2, 'ranking' => 2, 'scales' => 1] as $type => $min) {
        $slide = authApiAppend($deck['id'], $type);
        $options = $slide['options'];
        for ($i = count($options) - 1; $i >= $min; $i--) {
            $this->deleteJson(authApiUrl("/{$deck['id']}/slides/{$slide['id']}/options/{$options[$i]['id']}"))->assertOk();
        }

        $this->deleteJson(authApiUrl("/{$deck['id']}/slides/{$slide['id']}/options/{$options[0]['id']}"))
            ->assertStatus(422)
            ->assertJsonPath('data.validation_errors.options.0', "This slide needs at least {$min} " . ($min === 1 ? 'option' : 'options') . '.');
        expect(SlideOption::where('slide_id', $slide['id'])->count())->toBe($min);
    }

    // Types without options refuse them.
    foreach (['heading', 'word_cloud', 'qa_audience', 'matrix_2x2'] as $type) {
        $slide = authApiAppend($deck['id'], $type);
        expect($slide['options'])->toBe([]);
        $add($slide)->assertStatus(422)->assertJsonPath('data.validation_errors.options.0', 'This slide type has no options.');
    }

    // Bulk applies the same limits.
    $this->postJson(authApiUrl("/{$deck['id']}/slides/bulk"), ['slides' => [
        ['type' => 'ranking', 'title' => 'Too many', 'options' => array_map(fn ($i) => ['label' => "R{$i}"], range(1, 13))],
        ['type' => 'poll_single', 'title' => 'Too few', 'options' => [['label' => 'Only']]],
        ['type' => 'heading', 'title' => 'No options', 'options' => [['label' => 'Nope']]],
    ]])->assertStatus(422)->assertJsonPath('data.validation_errors', [
        'slides.0.options' => ['This slide can have at most 12 options.'],
        'slides.1.options' => ['This slide needs at least 2 options.'],
        'slides.2.options' => ['This slide type has no options.'],
    ]);
});

it('edits and deletes options, keeping positions contiguous', function () {
    authApiSignIn();
    $deck = authApiCreateDeck();
    $slide = authApiAppend($deck['id'], 'poll_multi');
    [$a, $b, $c] = array_column($slide['options'], 'id');
    $url = fn (int $id) => authApiUrl("/{$deck['id']}/slides/{$slide['id']}/options/{$id}");

    $edited = $this->patchJson($url($b), ['label' => 'Blue', 'payload' => ['color' => '#00f']])->assertOk()->json('data');
    expect($edited['option'])->toMatchArray(['id' => $b, 'label' => 'Blue', 'payload' => ['color' => '#00f'], 'position' => 2])
        ->and(array_column($edited['slide']['options'], 'label'))->toBe([null, 'Blue', null]);

    $this->patchJson($url($b), ['payload' => ['a', 'b']])->assertStatus(422)->assertJsonPath('data.validation_errors.payload.0', 'The payload must be an object.');
    $this->patchJson($url($b), ['payload' => ['blob' => str_repeat('x', 3000)]])->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['payload']]]);
    $this->patchJson($url($b), ['label' => str_repeat('x', 201)])->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['label']]]);

    $after = $this->deleteJson($url($a))->assertOk()->json('data.slide.options');
    expect(array_map(fn ($o) => [$o['id'], $o['position']], $after))->toBe([[$b, 1], [$c, 2]]);

    $this->patchJson($url($a), ['label' => 'Gone'])->assertNotFound();
});

it('reorders a slide\'s options in one request (0-based positions, every option once)', function () {
    authApiSignIn();
    $deck = authApiCreateDeck();
    $slide = authApiAppend($deck['id'], 'poll_multi');
    [$a, $b, $c] = array_column($slide['options'], 'id');
    $url = authApiUrl("/{$deck['id']}/slides/{$slide['id']}/options/reorder");
    $pairs = fn (array $options) => array_map(fn ($o) => [$o['id'], $o['position']], $options);

    // Bare list; the response is the slide with its options in the new order (stored 1..n).
    $moved = $this->postJson($url, [['id' => $c, 'position' => 1], ['id' => $a, 'position' => 2], ['id' => $b, 'position' => 3]])
        ->assertOk()->assertJsonPath('message', 'Options reordered.')->json('data.slide');
    expect($moved['id'])->toBe($slide['id'])
        ->and($pairs($moved['options']))->toBe([[$c, 1], [$a, 2], [$b, 3]])
        ->and(SlideOption::where('slide_id', $slide['id'])->orderBy('position')->pluck('id')->all())->toBe([$c, $a, $b]);

    // Wrapped in {options}, listed in any order.
    $this->postJson($url, ['options' => [['id' => $a, 'position' => 3], ['id' => $b, 'position' => 1], ['id' => $c, 'position' => 2]]])
        ->assertOk();
    expect($pairs($this->getJson(authApiUrl("/{$deck['id']}/slides/{$slide['id']}"))->json('data.slide.options')))->toBe([[$b, 1], [$c, 2], [$a, 3]]);

    // Positions must be exactly 1..n.
    $this->postJson($url, [['id' => $a, 'position' => 2], ['id' => $b, 'position' => 3], ['id' => $c, 'position' => 4]])
        ->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['options.2.position']]]);
    $this->postJson($url, [['id' => $a, 'position' => 0], ['id' => $b, 'position' => 1], ['id' => $c, 'position' => 2]])
        ->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['options.0.position']]]);
    $this->postJson($url, [['id' => $a, 'position' => 1], ['id' => $b, 'position' => 1], ['id' => $c, 'position' => 2]])
        ->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['options.0.position']]]);
    $this->postJson($url, [['id' => $a, 'position' => 0], ['id' => $b, 'position' => 1], ['id' => $c, 'position' => 2]])->assertStatus(422);
    $this->postJson($url, [['id' => $a, 'position' => 1], ['id' => $a, 'position' => 2], ['id' => $c, 'position' => 3]])
        ->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['options.0.id']]]);
    $this->postJson($url, [])->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['options']]]);

    // Every option of the slide, and only its own.
    $other = authApiAppend($deck['id'], 'poll_single')['options'][0]['id'];
    $this->postJson($url, [['id' => $a, 'position' => 1], ['id' => $b, 'position' => 2], ['id' => $other, 'position' => 3]])
        ->assertStatus(422)->assertJsonPath('data.validation_errors', ['options.2.id' => ['This option is not on this slide (it may have been deleted).']]);
    $this->postJson($url, [['id' => $a, 'position' => 1], ['id' => $b, 'position' => 2]])
        ->assertStatus(409)->assertJsonPath('data.code', 'conflict');
    expect($pairs($this->getJson(authApiUrl("/{$deck['id']}/slides/{$slide['id']}"))->json('data.slide.options')))->toBe([[$b, 1], [$c, 2], [$a, 3]]);

    // Same ownership and product scoping as the other authoring routes.
    $this->postJson(authApiUrl("/{$deck['id']}/slides/999999999/options/reorder"), [['id' => $a, 'position' => 1]])->assertNotFound();
    authApiSignIn();
    $this->postJson($url, [['id' => $c, 'position' => 1], ['id' => $a, 'position' => 2], ['id' => $b, 'position' => 3]])
        ->assertNotFound()->assertJsonPath('data.code', 'not_found');

    $route = app('router')->getRoutes()->getByName('deck.quest.options.reorder');
    expect($route->uri())->toBe('api/v1/quests/{deck}/slides/{slide}/options/reorder')
        ->and($route->gatherMiddleware())->toContain('auth:sanctum', 'throttle:deck-author');
});

it('strips server-managed config keys (media, media_file_id, video_url) from author input', function () {
    $owner = authApiSignIn();
    $deck = authApiCreateDeck();
    $file = authApiFile($owner);
    $smuggled = ['media' => ['file_id' => $file->id, 'url' => 'https://evil.example/x.png', 'width' => 1, 'height' => 1, 'mime' => 'image/png'], 'media_file_id' => $file->id];

    // Video: neither a link nor media through config.
    $video = authApiAppend($deck['id'], 'video');
    $patched = $this->patchJson(authApiUrl("/{$deck['id']}/slides/{$video['id']}"), ['config' => $smuggled + [
        'video_url' => 'https://youtu.be/dQw4w9WgXcQ', 'embed_url' => 'https://evil.example/embed', 'video_provider' => 'youtube', 'video_id' => 'dQw4w9WgXcQ',
    ]])->assertOk()->json('data.slide');
    expect($patched['config'])->toBe(['video_url' => null, 'video_provider' => null, 'video_id' => null, 'embed_url' => null])
        ->and($patched['mediaFileId'])->toBeNull()
        ->and(Slide::find($video['id'])->media_file_id)->toBeNull();

    // A link set through the media endpoint survives config edits.
    Slide::whereKey($video['id'])->update(['config' => ['video_url' => 'https://vimeo.com/76979871', 'video_provider' => 'vimeo', 'video_id' => '76979871', 'embed_url' => 'https://player.vimeo.com/video/76979871']]);
    $kept = $this->patchJson(authApiUrl("/{$deck['id']}/slides/{$video['id']}"), ['title' => 'Watch', 'config' => ['video_url' => null]])->assertOk()->json('data.slide');
    expect($kept['config'])->toBe(['video_url' => 'https://vimeo.com/76979871', 'video_provider' => 'vimeo', 'video_id' => '76979871', 'embed_url' => 'https://player.vimeo.com/video/76979871']);

    // Image / pin_on_image: media_file_id is a column, untouched by config.
    foreach (['image' => ['caption' => 'Hi'], 'pin_on_image' => ['max_pins_per_participant' => 2]] as $type => $config) {
        $slide = authApiAppend($deck['id'], $type);
        Slide::whereKey($slide['id'])->update(['media_file_id' => $file->id]);

        $patched = $this->patchJson(authApiUrl("/{$deck['id']}/slides/{$slide['id']}"), ['config' => ['media' => null, 'media_file_id' => null] + $smuggled + $config])
            ->assertOk()->json('data.slide');

        expect($patched['config'])->toMatchArray($config)->not->toHaveKey('media')->not->toHaveKey('media_file_id')
            ->and($patched['mediaFileId'])->toBe($file->id)
            ->and(Slide::find($slide['id'])->config)->not->toHaveKey('media');
    }

    // Bulk input is stripped the same way.
    $bulk = $this->postJson(authApiUrl("/{$deck['id']}/slides/bulk"), ['slides' => [
        ['type' => 'video', 'title' => 'Clip', 'config' => ['video_url' => 'https://youtu.be/dQw4w9WgXcQ'] + $smuggled],
    ]])->assertCreated()->json('data.slides.0');
    expect($bulk['config']['video_url'])->toBeNull()->and($bulk['config'])->not->toHaveKey('media')->and($bulk['mediaFileId'])->toBeNull();
});

it('merges config edits onto the stored config and prefixes type errors with config.', function () {
    authApiSignIn();
    $deck = authApiCreateDeck();
    $matrix = authApiAppend($deck['id'], 'matrix_2x2');
    $url = authApiUrl("/{$deck['id']}/slides/{$matrix['id']}");

    $this->patchJson($url, ['config' => ['x_axis' => ['low' => 'Cheap', 'high' => 'Pricey'], 'show_results_to_participants' => true]])->assertOk();
    $config = $this->patchJson($url, ['config' => ['x_axis' => ['low' => 'Free']]])->assertOk()->json('data.slide.config');

    expect($config)->toBe(['x_axis' => ['low' => 'Free', 'high' => 'Pricey'], 'y_axis' => ['low' => '', 'high' => ''], 'show_results_to_participants' => true]);

    $multi = authApiAppend($deck['id'], 'poll_multi');
    $this->patchJson(authApiUrl("/{$deck['id']}/slides/{$multi['id']}"), ['title' => str_repeat('t', 281), 'config' => ['min_selections' => 0]])
        ->assertStatus(422)
        ->assertJsonStructure(['data' => ['validation_errors' => ['title']]]);

    $this->patchJson(authApiUrl("/{$deck['id']}/slides/{$multi['id']}"), ['config' => ['min_selections' => 3, 'max_selections' => 2], 'time_limit_seconds' => 30])
        ->assertStatus(422)
        ->assertJsonPath('message', 'Validation Error')
        ->assertJsonPath('data.validation_errors', ['config.max_selections' => ['The maximum selections must be at least the minimum selections.']]);

    expect(Slide::find($multi['id'])->config['min_selections'])->toBe(1)
        ->and(Slide::find($multi['id'])->time_limit_seconds)->toBeNull();
});

it('validates and size-limits the paragraph body, keeping the spaces between text runs', function () {
    authApiSignIn();
    $deck = authApiCreateDeck();
    $paragraph = authApiAppend($deck['id'], 'paragraph');
    $url = authApiUrl("/{$deck['id']}/slides/{$paragraph['id']}");

    $doc = ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [
        ['type' => 'text', 'text' => 'Hello '],
        ['type' => 'text', 'text' => 'world', 'marks' => [['type' => 'bold']]],
        ['type' => 'text', 'text' => ' and '],
        ['type' => 'text', 'text' => 'more', 'marks' => [['type' => 'link', 'attrs' => ['href' => 'https://example.com', 'target' => '_blank']]]],
    ]]]];

    $body = $this->patchJson($url, ['body' => $doc])->assertOk()->json('data.slide.body');
    expect(array_column($body['content'][0]['content'], 'text'))->toBe(['Hello ', 'world', ' and ', 'more'])
        ->and($body['content'][0]['content'][3]['marks'])->toBe([['type' => 'link', 'attrs' => ['href' => 'https://example.com']]])
        // jsonb stores keys in its own order.
        ->and(Slide::find($paragraph['id'])->body)->toEqual($body);

    $evil = $doc;
    $evil['content'][0]['content'][3]['marks'][0]['attrs']['href'] = 'javascript:alert(1)';
    $this->patchJson($url, ['body' => $evil])->assertStatus(422)->assertJsonPath('data.validation_errors.body.0', 'Links must be http(s) or mailto addresses.');

    $huge = ['type' => 'doc', 'content' => array_fill(0, 1200, ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'x']]])];
    $this->patchJson($url, ['body' => $huge])->assertStatus(422)->assertJsonPath('data.validation_errors.body.0', 'The body is too large.');

    $this->patchJson($url, ['body' => ['type' => 'script']])->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['body']]]);
    expect(Slide::find($paragraph['id'])->body)->toEqual($body);

    $this->patchJson($url, ['body' => null])->assertOk()->assertJsonPath('data.slide.body', null);

    // Only types with a rich-text body take one.
    $poll = authApiAppend($deck['id'], 'poll_single');
    $this->patchJson(authApiUrl("/{$deck['id']}/slides/{$poll['id']}"), ['body' => $doc])
        ->assertStatus(422)->assertJsonPath('data.validation_errors.body.0', 'This slide type has no rich-text body.');

    // Bulk bodies are raw too.
    $bulk = $this->postJson(authApiUrl("/{$deck['id']}/slides/bulk"), [['type' => 'paragraph', 'title' => 'Intro', 'body' => $doc]])
        ->assertCreated()->json('data.slides.0.body');
    expect(array_column($bulk['content'][0]['content'], 'text'))->toBe(['Hello ', 'world', ' and ', 'more']);
});

it('reorders in one transaction around soft-deleted slides holding old positions', function () {
    authApiSignIn();
    $deck = authApiCreateDeck();
    $deckId = $deck['id'];
    foreach (['poll_single', 'heading', 'word_cloud', 'rating'] as $type) {
        authApiAppend($deckId, $type);
    }

    // Delete position 2 through the API: later slides close the gap.
    $ids = array_column(authApiOrder($deckId), 'id');
    $order = $this->deleteJson(authApiUrl("/{$deckId}/slides/{$ids[1]}"))->assertOk()->json('data.order');
    expect($order)->toBe([
        ['id' => $ids[0], 'position' => 1], ['id' => $ids[2], 'position' => 2], ['id' => $ids[3], 'position' => 3], ['id' => $ids[4], 'position' => 4],
    ])->and(Slide::withTrashed()->find($ids[1])->position)->toBe(2);
    $this->getJson(authApiUrl("/{$deckId}/slides/{$ids[1]}"))->assertNotFound();

    // More soft-deleted rows sitting on live positions.
    $ghost = Slide::factory()->create(['deck_id' => $deckId, 'type' => 'heading', 'position' => 99]);
    $ghost->delete();
    Slide::withTrashed()->whereKey($ghost->id)->update(['position' => 3]);

    $live = [$ids[4], $ids[0], $ids[3], $ids[2]];
    $order = $this->postJson(authApiUrl("/{$deckId}/slides/reorder"), [
        // Sparse positions are fine; slides are renumbered 1..n in this order.
        ['id' => $ids[2], 'position' => 40], ['id' => $ids[4], 'position' => 5], ['id' => $ids[0], 'position' => 10], ['id' => $ids[3], 'position' => 30],
    ])->assertOk()->json('data.order');

    expect($order)->toBe(array_map(fn ($id, $i) => ['id' => $id, 'position' => $i + 1], $live, array_keys($live)))
        ->and(authApiOrder($deckId))->toBe($order)
        ->and(Slide::withTrashed()->find($ids[1])->position)->toBe(2)
        ->and(Slide::withTrashed()->find($ghost->id)->position)->toBe(3)
        ->and(Slide::withTrashed()->where('deck_id', $deckId)->where('position', '<', 1)->count())->toBe(0);

    $url = authApiUrl("/{$deckId}/slides/reorder");

    // A deleted slide is not part of the deck any more.
    $this->postJson($url, ['slides' => [...array_map(fn ($id, $i) => ['id' => $id, 'position' => $i + 1], $live, array_keys($live)), ['id' => $ghost->id, 'position' => 5]]])
        ->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['slides.4.id']]]);

    // Leaving a slide out means the client's list is stale.
    $this->postJson($url, ['slides' => [['id' => $live[0], 'position' => 1], ['id' => $live[1], 'position' => 2]]])
        ->assertStatus(409)->assertJsonPath('data.code', 'conflict');

    $this->postJson($url, ['slides' => [['id' => $live[0], 'position' => 1], ['id' => $live[0], 'position' => 2]]])->assertStatus(422);
    $this->postJson($url, ['slides' => [['id' => $live[0], 'position' => 1], ['id' => $live[1], 'position' => 1], ['id' => $live[2], 'position' => 2], ['id' => $live[3], 'position' => 3]]])->assertStatus(422);
    $this->postJson($url, ['slides' => []])->assertStatus(422);

    expect(authApiOrder($deckId))->toBe($order);
});

it('duplicates a slide to the next position and appends after a given position', function () {
    $owner = authApiSignIn();
    $deck = authApiCreateDeck(['settings' => ['default_time_limit' => 20, 'get_ready_seconds' => 5]]);
    $deckId = $deck['id'];
    $poll = authApiAppend($deckId, 'poll_single');
    $heading = authApiAppend($deckId, 'heading');

    expect($poll['timeLimitSeconds'])->toBe(20)->and($poll['getReadySeconds'])->toBe(5)
        ->and($heading['timeLimitSeconds'])->toBeNull()->and($heading['getReadySeconds'])->toBeNull();

    $file = authApiFile($owner);
    $this->patchJson(authApiUrl("/{$deckId}/slides/{$poll['id']}"), ['title' => 'Lunch?', 'config' => ['submit_mode' => 'confirm']])->assertOk();
    SlideOption::whereKey($poll['options'][0]['id'])->update(['label' => 'Pizza', 'image_file_id' => $file->id, 'payload' => ['k' => 'v']]);
    SlideOption::whereKey($poll['options'][1]['id'])->update(['label' => 'Salad']);

    $response = $this->postJson(authApiUrl("/{$deckId}/slides/{$poll['id']}/duplicate"))->assertCreated()->json('data');
    $copy = $response['slide'];

    expect($copy)->toMatchArray(['type' => 'poll_single', 'position' => 3, 'title' => 'Lunch?', 'timeLimitSeconds' => 20])
        ->and($copy['config']['submit_mode'])->toBe('confirm')
        ->and(array_map(fn ($o) => [$o['label'], $o['imageFileId'], $o['payload']], $copy['options']))->toBe([['Pizza', $file->id, ['k' => 'v']], ['Salad', null, []]])
        ->and(array_column($copy['options'], 'id'))->not->toContain($poll['options'][0]['id'])
        ->and($response['order'])->toBe([
            ['id' => $deck['slides'][0]['id'], 'position' => 1], ['id' => $poll['id'], 'position' => 2],
            ['id' => $copy['id'], 'position' => 3], ['id' => $heading['id'], 'position' => 4],
        ]);

    // Insert after position 0 = first.
    $first = authApiAppend($deckId, 'big_text', ['after_position' => 0]);
    expect($first['position'])->toBe(1)
        ->and(array_column(authApiOrder($deckId), 'id'))->toBe([$first['id'], $deck['slides'][0]['id'], $poll['id'], $copy['id'], $heading['id']]);

    // Past the end = append.
    expect(authApiAppend($deckId, 'quote', ['after_position' => 500])['position'])->toBe(6);
});

it('adds bulk slides atomically after a position (one bad slide saves nothing)', function () {
    authApiSignIn();
    $deck = authApiCreateDeck();
    $deckId = $deck['id'];
    $tail = authApiAppend($deckId, 'heading');
    $optionsBefore = SlideOption::count();

    $bad = [
        ['type' => 'poll_single', 'title' => 'Lunch?', 'options' => [['label' => 'Pizza'], ['label' => 'Salad']]],
        ['type' => 'scales', 'title' => 'Rate', 'config' => ['scale_points' => 99]],
        ['type' => 'word_cloud', 'title' => str_repeat('w', 300)],
    ];
    $this->postJson(authApiUrl("/{$deckId}/slides/bulk"), ['slides' => $bad])
        ->assertStatus(422)
        ->assertJsonStructure(['data' => ['validation_errors' => ['slides.2.title']]]);

    $bad[2]['title'] = 'Words';
    $this->postJson(authApiUrl("/{$deckId}/slides/bulk"), ['slides' => $bad])
        ->assertStatus(422)
        ->assertJsonStructure(['data' => ['validation_errors' => ['slides.1.config.scale_points']]]);

    expect(Slide::where('deck_id', $deckId)->count())->toBe(2)
        ->and(SlideOption::count())->toBe($optionsBefore);

    $this->postJson(authApiUrl("/{$deckId}/slides/bulk"), ['slides' => array_fill(0, 51, ['type' => 'heading'])])
        ->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['slides']]]);

    // Valid set: inserted after the qr_code slide, the heading moves to the end.
    $good = $bad;
    $good[1]['config'] = ['scale_points' => 3, 'scale_labels' => ['No', 'Maybe', 'Yes']];
    $good[1]['options'] = [['label' => 'Coffee'], ['label' => 'Tea', 'payload' => ['hot' => true]]];
    $good[] = ['type' => 'poll_multi', 'title' => 'Defaults'];

    $response = $this->postJson(authApiUrl("/{$deckId}/slides/bulk"), ['after_position' => 1, 'slides' => $good])->assertCreated()->json('data');

    expect(array_column($response['slides'], 'type'))->toBe(['poll_single', 'scales', 'word_cloud', 'poll_multi'])
        ->and(array_column($response['slides'], 'position'))->toBe([2, 3, 4, 5])
        ->and(array_column($response['slides'], 'title'))->toBe(['Lunch?', 'Rate', 'Words', 'Defaults'])
        ->and(array_column($response['slides'][0]['options'], 'label'))->toBe(['Pizza', 'Salad'])
        ->and(array_map(fn ($o) => [$o['position'], $o['label'], $o['payload']], $response['slides'][1]['options']))->toBe([[1, 'Coffee', []], [2, 'Tea', ['hot' => true]]])
        ->and($response['slides'][1]['config']['scale_labels'])->toBe(['No', 'Maybe', 'Yes'])
        ->and($response['slides'][2]['options'])->toBe([])
        ->and($response['slides'][3]['options'])->toHaveCount(3)
        ->and(end($response['order']))->toBe(['id' => $tail['id'], 'position' => 6])
        ->and(authApiOrder($deckId))->toBe($response['order']);

    // A bare list appends at the end.
    $appended = $this->postJson(authApiUrl("/{$deckId}/slides/bulk"), [['type' => 'big_text', 'title' => 'Bye', 'config' => ['text' => 'Thanks!']]])
        ->assertCreated()->json('data.slides.0');
    expect($appended['position'])->toBe(7)->and($appended['config'])->toBe(['text' => 'Thanks!']);
});

it('lists the user\'s quests with search, sort and pagination', function () {
    $owner = authApiSignIn();
    $alpha = authApiCreateDeck(['title' => 'Alpha retro']);
    $beta = authApiCreateDeck(['title' => 'Beta planning']);
    $gamma = authApiCreateDeck(['title' => 'Gamma 100%_retro']);
    Deck::whereKey($alpha['id'])->update(['updated_at' => now()->subDays(3)]);
    Deck::whereKey($beta['id'])->update(['updated_at' => now()->subDays(2)]);
    Deck::whereKey($gamma['id'])->update(['updated_at' => now()->subDay()]);

    $gone = authApiCreateDeck(['title' => 'Deleted retro']);
    $this->deleteJson(authApiUrl("/{$gone['id']}"))->assertOk();
    Deck::factory()->quiz()->ownedBy($owner)->create(['title' => 'Quiz retro']);
    Deck::factory()->create(['title' => 'Someone else retro']);

    $page = $this->getJson(authApiUrl())->assertOk()->json('data');
    expect(array_column($page['items'], 'id'))->toBe([$gamma['id'], $beta['id'], $alpha['id']])
        ->and($page['items'][0]['slideCount'])->toBe(1)
        ->and($page['meta'])->toBe(['currentPage' => 1, 'perPage' => 20, 'total' => 3, 'lastPage' => 1]);

    expect(array_column($this->getJson(authApiUrl() . '?search=RETRO')->json('data.items'), 'id'))->toBe([$gamma['id'], $alpha['id']])
        ->and(array_column($this->getJson(authApiUrl() . '?search=' . urlencode('100%_'))->json('data.items'), 'id'))->toBe([$gamma['id']])
        ->and(array_column($this->getJson(authApiUrl() . '?search=' . urlencode('%'))->json('data.items'), 'id'))->toBe([$gamma['id']])
        ->and(array_column($this->getJson(authApiUrl() . '?sort=title')->json('data.items'), 'title'))->toBe(['Alpha retro', 'Beta planning', 'Gamma 100%_retro'])
        ->and(array_column($this->getJson(authApiUrl() . '?sort=updated&direction=asc')->json('data.items'), 'id'))->toBe([$alpha['id'], $beta['id'], $gamma['id']]);

    $second = $this->getJson(authApiUrl() . '?per_page=2&page=2')->assertOk()->json('data');
    expect(array_column($second['items'], 'id'))->toBe([$alpha['id']])
        ->and($second['meta'])->toBe(['currentPage' => 2, 'perPage' => 2, 'total' => 3, 'lastPage' => 2]);

    $this->getJson(authApiUrl() . '?sort=owner')->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['sort']]]);
    $this->getJson(authApiUrl() . '?per_page=500')->assertStatus(422);
});

it('updates title, description and settings, validating the settings keys', function () {
    authApiSignIn();
    $deck = authApiCreateDeck();
    expect($deck['title'])->toBe('Untitled quest');
    $url = authApiUrl("/{$deck['id']}");

    $updated = $this->patchJson($url, ['title' => '  Kickoff  ', 'settings' => ['default_time_limit' => 30, 'theme' => 'ocean']])->assertOk()->json('data.deck');
    expect($updated['title'])->toBe('Kickoff')
        ->and($updated['settings'])->toBe(['default_time_limit' => 30, 'get_ready_seconds' => 0, 'theme' => 'ocean', 'show_qr_sidebar' => true, 'default_qa_sort' => 'top']);

    $updated = $this->patchJson($url, ['description' => 'All hands', 'settings' => ['show_qr_sidebar' => false, 'default_qa_sort' => 'newest', 'default_time_limit' => null]])->assertOk()->json('data.deck');
    expect($updated['description'])->toBe('All hands')
        ->and($updated['settings'])->toBe(['default_time_limit' => null, 'get_ready_seconds' => 0, 'theme' => 'ocean', 'show_qr_sidebar' => false, 'default_qa_sort' => 'newest'])
        ->and(Deck::find($deck['id'])->settings)->toEqual($updated['settings']);

    $this->patchJson($url, ['settings' => ['autoplay' => true]])->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['settings']]]);
    $this->patchJson($url, ['settings' => ['default_qa_sort' => 'random']])->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['settings.default_qa_sort']]]);
    $this->patchJson($url, ['settings' => ['default_time_limit' => 2, 'get_ready_seconds' => 31, 'theme' => 'Ocean Blue!']])
        ->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['settings.default_time_limit', 'settings.get_ready_seconds', 'settings.theme']]]);
    $this->patchJson($url, ['title' => ''])->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['title']]]);
    $this->patchJson($url, ['title' => str_repeat('t', 256)])->assertStatus(422);

    expect(Deck::find($deck['id'])->title)->toBe('Kickoff');
});

it('only puts timers on slides that take answers', function () {
    authApiSignIn();
    $deck = authApiCreateDeck();
    $heading = authApiAppend($deck['id'], 'heading');
    $qa = authApiAppend($deck['id'], 'qa_audience');
    $poll = authApiAppend($deck['id'], 'poll_single');

    foreach ([$heading, $qa] as $slide) {
        $this->patchJson(authApiUrl("/{$deck['id']}/slides/{$slide['id']}"), ['time_limit_seconds' => 30, 'get_ready_seconds' => 5])
            ->assertStatus(422)
            ->assertJsonPath('data.validation_errors', ['time_limit_seconds' => ['This slide type has no timer.'], 'get_ready_seconds' => ['This slide type has no timer.']]);
        $this->patchJson(authApiUrl("/{$deck['id']}/slides/{$slide['id']}"), ['time_limit_seconds' => null])->assertOk();
    }

    $slide = $this->patchJson(authApiUrl("/{$deck['id']}/slides/{$poll['id']}"), ['time_limit_seconds' => 60, 'get_ready_seconds' => 0])->assertOk()->json('data.slide');
    expect($slide['timeLimitSeconds'])->toBe(60)->and($slide['getReadySeconds'])->toBe(0);

    $this->patchJson(authApiUrl("/{$deck['id']}/slides/{$poll['id']}"), ['time_limit_seconds' => 4])->assertStatus(422);
    $this->patchJson(authApiUrl("/{$deck['id']}/slides/{$poll['id']}"), ['time_limit_seconds' => null])->assertOk()->assertJsonPath('data.slide.timeLimitSeconds', null);
});

it('deletes slides softly and shifts positions down', function () {
    authApiSignIn();
    $deck = authApiCreateDeck();
    $a = authApiAppend($deck['id'], 'poll_single');
    $b = authApiAppend($deck['id'], 'heading');

    $order = $this->deleteJson(authApiUrl("/{$deck['id']}/slides/{$deck['slides'][0]['id']}"))->assertOk()->json('data.order');
    expect($order)->toBe([['id' => $a['id'], 'position' => 1], ['id' => $b['id'], 'position' => 2]])
        ->and(Slide::withTrashed()->find($deck['slides'][0]['id'])->trashed())->toBeTrue();

    $this->deleteJson(authApiUrl("/{$deck['id']}/slides/{$deck['slides'][0]['id']}"))->assertNotFound();
    $this->deleteJson(authApiUrl("/{$deck['id']}/slides/{$b['id']}"))->assertOk()->assertJsonPath('data.order', [['id' => $a['id'], 'position' => 1]]);

    expect(SlideOption::where('slide_id', $a['id'])->count())->toBe(2)
        ->and($this->getJson(authApiUrl("/{$deck['id']}"))->json('data.deck.slideCount'))->toBe(1);
});

it('keeps an explicit get-ready 0 on a slide through session start, and never inherits later deck defaults', function () {
    authApiSignIn();
    $deck = authApiCreateDeck(['settings' => ['get_ready_seconds' => 5, 'default_time_limit' => 20]]);
    $off = authApiAppend($deck['id'], 'poll_single');
    $on = authApiAppend($deck['id'], 'poll_single');
    expect($off['getReadySeconds'])->toBe(5)->and($on['getReadySeconds'])->toBe(5);

    $this->patchJson(authApiUrl("/{$deck['id']}/slides/{$off['id']}"), ['get_ready_seconds' => 0])->assertOk()->assertJsonPath('data.slide.getReadySeconds', 0);
    expect(Slide::find($off['id'])->get_ready_seconds)->toBe(0);

    // A slide seeded while the deck default was 0 stays off after the default changes.
    $this->patchJson(authApiUrl("/{$deck['id']}"), ['settings' => ['get_ready_seconds' => 0]])->assertOk();
    $seededOff = authApiAppend($deck['id'], 'poll_single');
    expect($seededOff['getReadySeconds'])->toBe(0);
    $this->patchJson(authApiUrl("/{$deck['id']}"), ['settings' => ['get_ready_seconds' => 7]])->assertOk();

    $sessionId = $this->postJson(authApiUrl("/{$deck['id']}/sessions"))->assertCreated()->json('data.session_id');
    $runs = DeckSessionSlideRun::query()->where('deck_session_id', $sessionId)->get()->keyBy('slide_id');

    expect($runs[$off['id']]->get_ready_seconds)->toBeNull()
        ->and($runs[$seededOff['id']]->get_ready_seconds)->toBeNull()
        ->and($runs[$on['id']]->get_ready_seconds)->toBe(5)
        ->and($runs[$on['id']]->time_limit_seconds)->toBe(20);
});

it('resizes the stored scale labels when only scale_points changes', function () {
    authApiSignIn();
    $deck = authApiCreateDeck();
    $scales = authApiAppend($deck['id'], 'scales');
    $url = authApiUrl("/{$deck['id']}/slides/{$scales['id']}");

    $this->patchJson($url, ['config' => ['scale_labels' => ['Never', 'Rarely', 'Sometimes', 'Often', 'Always']]])->assertOk();

    $config = $this->patchJson($url, ['config' => ['scale_points' => 7]])->assertOk()->json('data.slide.config');
    expect($config['scale_points'])->toBe(7)
        ->and($config['scale_labels'])->toBe(['Never', null, null, null, null, null, 'Always']);

    $config = $this->patchJson($url, ['config' => ['scale_points' => 3, 'scale_labels' => ['Low', 'Mid', 'High']]])->assertOk()->json('data.slide.config');
    expect($config['scale_labels'])->toBe(['Low', 'Mid', 'High']);

    $this->patchJson($url, ['config' => ['scale_points' => 11]])->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['config.scale_points']]]);
});

it('starts new Q&A slides with the deck default Q&A sort', function () {
    authApiSignIn();
    $deck = authApiCreateDeck(['settings' => ['default_qa_sort' => 'newest']]);

    expect(authApiAppend($deck['id'], 'qa_audience')['config']['sort'])->toBe('newest');

    $bulk = $this->postJson(authApiUrl("/{$deck['id']}/slides/bulk"), ['slides' => [
        ['type' => 'qa_audience'],
        ['type' => 'qa_audience', 'config' => ['sort' => 'top']],
    ]])->assertCreated()->json('data.slides');
    expect(array_column(array_column($bulk, 'config'), 'sort'))->toBe(['newest', 'top']);

    $this->patchJson(authApiUrl("/{$deck['id']}"), ['settings' => ['default_qa_sort' => 'top']])->assertOk();
    expect(authApiAppend($deck['id'], 'qa_audience')['config']['sort'])->toBe('top');
});

it('merges overlapping partial config and settings edits onto the current row', function () {
    authApiSignIn();
    $deck = authApiCreateDeck();
    $cloud = authApiAppend($deck['id'], 'word_cloud');

    // Two requests that loaded the same slide before either saved.
    $a = Slide::with('deck')->find($cloud['id']);
    $b = Slide::with('deck')->find($cloud['id']);
    $service = app(SlideAuthoringService::class);
    $service->update($a, ['config' => ['max_entries_per_participant' => 5]]);
    $service->update($b, ['config' => ['max_entry_length' => 40]]);

    expect(Slide::find($cloud['id'])->config)->toMatchArray(['max_entries_per_participant' => 5, 'max_entry_length' => 40]);

    $d1 = Deck::find($deck['id']);
    $d2 = Deck::find($deck['id']);
    $decks = app(\App\Deck\Authoring\DeckAuthoringService::class);
    $decks->update($d1, ['settings' => ['theme' => 'ocean']]);
    $decks->update($d2, ['settings' => ['default_qa_sort' => 'newest']]);

    expect(Deck::find($deck['id'])->settings)->toMatchArray(['theme' => 'ocean', 'default_qa_sort' => 'newest']);
});

it('keeps every authorable slide inside the slide.changed broadcast limit', function () {
    authApiSignIn();
    $deck = authApiCreateDeck();
    $poll = authApiAppend($deck['id'], 'poll_single');
    $slideUrl = authApiUrl("/{$deck['id']}/slides/{$poll['id']}");

    // 30 options of 200 Bengali characters cannot all fit: adding stops with 422 before the broadcast would.
    $label = str_repeat('অ', SlideInput::MAX_LABEL);
    $statuses = [];
    for ($i = 0; $i < 28; $i++) {
        $statuses[] = $this->postJson("{$slideUrl}/options", ['label' => $label, 'payload' => ['note' => str_repeat('n', 400)]])->status();
    }
    expect($statuses)->toContain(422)->and($statuses[0])->toBe(201);
    $this->postJson("{$slideUrl}/options", ['label' => $label, 'payload' => ['note' => str_repeat('n', 400)]])->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['options']]]);

    $slide = Slide::with(['deck', 'options'])->find($poll['id']);
    $type = app(\App\Deck\Slides\SlideTypeRegistry::class)->for('poll_single');
    [$content, $options] = SlideBroadcastBudget::current($slide);
    expect(SlideBroadcastBudget::measure($type, $slide, $content, $options))->toBeLessThanOrEqual(SlideBroadcastBudget::MAX_BYTES);

    // Title and config edits are checked as well.
    $this->patchJson($slideUrl, ['title' => str_repeat('শ', SlideInput::MAX_TITLE)])->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['title']]]);

    // Option payloads are small type extras.
    $first = SlideOption::where('slide_id', $poll['id'])->orderBy('position')->first();
    $this->patchJson("{$slideUrl}/options/{$first->id}", ['payload' => ['note' => str_repeat('x', 600)]])->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['payload']]]);

    // 30 maximal ASCII options under a maximal title come to about 9.5 KB on the wire: refused.
    // 30 options of 120 characters under the same title fit.
    $title = str_repeat('t', SlideInput::MAX_TITLE);
    $this->postJson(authApiUrl("/{$deck['id']}/slides/bulk"), ['slides' => [
        ['type' => 'poll_single', 'title' => $title, 'options' => array_fill(0, 30, ['label' => str_repeat('a', SlideInput::MAX_LABEL)])],
    ]])->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['slides.0']]]);

    $bulk = $this->postJson(authApiUrl("/{$deck['id']}/slides/bulk"), ['slides' => [
        ['type' => 'poll_single', 'title' => $title, 'options' => array_fill(0, 30, ['label' => str_repeat('a', 120)])],
    ]])->assertCreated()->json('data.slides.0');
    $slide = Slide::with('deck')->find($bulk['id']);
    [$content, $options] = SlideBroadcastBudget::current($slide);
    expect(SlideBroadcastBudget::measure($type, $slide, $content, $options))->toBeLessThanOrEqual(SlideBroadcastBudget::MAX_BYTES);

    // Bulk names the slide that does not fit.
    $this->postJson(authApiUrl("/{$deck['id']}/slides/bulk"), ['slides' => [
        ['type' => 'heading'],
        ['type' => 'poll_single', 'title' => str_repeat('শ', 200), 'options' => array_fill(0, 30, ['label' => $label])],
    ]])->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['slides.1']]]);
    expect(Slide::where('deck_id', $deck['id'])->count())->toBe(3);
});

it('answers 422, not 500, for invalid UTF-8 input', function () {
    authApiSignIn();
    $deck = authApiCreateDeck();

    $this->getJson(authApiUrl('?search=%FF'))->assertStatus(422)->assertJsonPath('data.validation_errors.search', ['The text must be valid UTF-8.']);

    $this->post(authApiUrl("/{$deck['id']}/slides"), ['type' => "\xFF"], ['Accept' => 'application/json'])
        ->assertStatus(422)->assertJsonPath('data.validation_errors.type', ['The text must be valid UTF-8.']);

    $this->patch(authApiUrl("/{$deck['id']}"), ['description' => "ok\xFF"], ['Accept' => 'application/json'])
        ->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['description']]]);

    $this->post(authApiUrl("/{$deck['id']}/slides/bulk"), ['slides' => [['type' => 'heading', 'config' => ['subtitle' => "x\xFF"]]]], ['Accept' => 'application/json'])
        ->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['slides.0.config.subtitle']]]);

    $response = SlideInput::unsupported("\xFF", ['type'])->render();
    expect($response->getStatusCode())->toBe(422)
        ->and(json_decode($response->getContent(), true)['data'])->toMatchArray(['code' => 'unsupported_type', 'type' => null]);
});

it('caps slides per deck so the deck can always be reordered', function () {
    expect(config('deck.max_slides_per_deck'))->toBe(100)
        ->and(SlideAuthoringService::maxSlides())->toBe(100);

    config(['deck.max_slides_per_deck' => 5]);
    authApiSignIn();
    $deck = authApiCreateDeck();
    $this->postJson(authApiUrl("/{$deck['id']}/slides/bulk"), ['slides' => array_fill(0, 3, ['type' => 'heading'])])->assertCreated();
    $capped = fn ($response) => $response->assertStatus(422)
        ->assertJsonPath('message', 'A deck can have at most 5 slides.')
        ->assertJsonPath('data.code', 'slide_limit_reached')
        ->assertJsonPath('data.max_slides', 5)
        ->assertJsonPath('data.validation_errors.slides', ['A deck can have at most 5 slides.']);

    $capped($this->postJson(authApiUrl("/{$deck['id']}/slides/bulk"), ['slides' => array_fill(0, 2, ['type' => 'heading'])]));
    expect(Slide::where('deck_id', $deck['id'])->count())->toBe(4);

    $last = authApiAppend($deck['id'], 'heading');
    $capped($this->postJson(authApiUrl("/{$deck['id']}/slides"), ['type' => 'heading']));
    $capped($this->postJson(authApiUrl("/{$deck['id']}/slides/{$last['id']}/duplicate")));
    expect(Slide::where('deck_id', $deck['id'])->count())->toBe(5);

    config(['deck.max_slides_per_deck' => 4]);
    $this->postJson(authApiUrl("/{$deck['id']}/duplicate"))->assertStatus(422)
        ->assertJsonPath('data.code', 'slide_limit_reached')->assertJsonPath('data.max_slides', 4);
    expect(Deck::where('owner_id', auth()->id())->count())->toBe(1);
    config(['deck.max_slides_per_deck' => 5]);
    $this->postJson(authApiUrl("/{$deck['id']}/duplicate"))->assertCreated();

    $order = array_reverse(authApiOrder($deck['id']));
    $items = array_map(fn ($row, $i) => ['id' => $row['id'], 'position' => $i + 1], $order, array_keys($order));
    $this->postJson(authApiUrl("/{$deck['id']}/slides/reorder"), ['slides' => $items])->assertOk();
    $this->postJson(authApiUrl("/{$deck['id']}/slides/reorder"), ['slides' => [...$items, ['id' => 999999999, 'position' => 6]]])
        ->assertStatus(422)->assertJsonStructure(['data' => ['validation_errors' => ['slides']]]);
});
