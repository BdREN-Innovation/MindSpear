<?php

use App\Models\Deck\Deck;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use Illuminate\Foundation\Testing\DatabaseTransactions;

require_once __DIR__ . '/QuizApiHelpers.php';

/*
 * Quiz authoring (QUIZ_REDESIGN_PLAN.md §2.1): /api/v1/quizzes on the
 * shared deck controllers with product = quiz. Quiz-only fields (slides:
 * points_min / points_max / speed_bonus_enabled, options: is_correct) work
 * here and are refused on the Quest routes; quiz-only types are refused on
 * Quest, Quest-only types on Quiz; content types work on both.
 */

uses(DatabaseTransactions::class);

beforeEach(fn () => qapiSetUp());

it('creates a quiz deck with a qr_code slide and the 5 s Get ready default', function () {
    $host = qapiOwner();
    qapiAsHost($host);

    $deck = $this->postJson(QAPI_AUTHOR, [])->assertCreated()->json('data.deck');

    expect($deck['title'])->toBe('Untitled quiz')
        ->and($deck['product'])->toBe('quiz')
        ->and($deck['settings']['get_ready_seconds'])->toBe(5)
        ->and($deck['slides'])->toHaveCount(1)
        ->and($deck['slides'][0]['type'])->toBe('qr_code');

    // null resets to the quiz default, not the shared 0.
    $this->patchJson(QAPI_AUTHOR . "/{$deck['id']}", ['settings' => ['get_ready_seconds' => 0]])
        ->assertOk()->assertJsonPath('data.deck.settings.get_ready_seconds', 0);
    $this->patchJson(QAPI_AUTHOR . "/{$deck['id']}", ['settings' => ['get_ready_seconds' => null]])
        ->assertOk()->assertJsonPath('data.deck.settings.get_ready_seconds', 5);

    // Lists, shows and deletes only quiz decks.
    $quest = Deck::factory()->ownedBy($host)->create();
    $this->getJson(QAPI_AUTHOR)->assertOk()->assertJsonPath('data.meta.total', 1)->assertJsonPath('data.items.0.id', $deck['id']);
    $this->getJson(QAPI_AUTHOR . "/{$quest->id}")->assertNotFound();
    $this->getJson("/api/v1/quests/{$deck['id']}")->assertNotFound();
});

it('seeds each quiz type with its timer, points and options, and scopes types per product', function () {
    $host = qapiOwner();
    $deck = qapiCreateQuiz($host);

    $expected = [
        // type => [time limit, points?, options]
        'pick_answer_single' => [20, true, 2],
        'true_false' => [20, true, 2],
        'short_answer' => [30, true, 1],
        'match_pairs' => [45, true, 6],
        'correct_order' => [30, true, 4],
        'categorise' => [45, true, 4],
        'spinner_wheel' => [null, false, 4],
        'leaderboard' => [null, false, 0],
        'fill_blanks' => [45, true, 0],
        'drag_drop' => [45, true, 0],
    ];

    foreach ($expected as $type => [$limit, $scored, $options]) {
        $slide = qapiAppend($host, $deck['id'], $type);

        expect($slide['timeLimitSeconds'])->toBe($limit, $type)
            ->and($slide['getReadySeconds'])->toBe($scored ? 5 : null, $type)
            ->and($slide['pointsMin'])->toBe($scored ? 50 : null, $type)
            ->and($slide['pointsMax'])->toBe($scored ? 100 : null, $type)
            ->and($slide['speedBonusEnabled'])->toBe($scored ? true : null, $type)
            ->and($slide['options'])->toHaveCount($options);
    }

    // Content types are shared; Quest-only types are not on offer here, quiz types not on Quest.
    qapiAppend($host, $deck['id'], 'heading');
    foreach (['poll_single', 'qa_audience', 'word_cloud'] as $questType) {
        $this->postJson(QAPI_AUTHOR . "/{$deck['id']}/slides", ['type' => $questType])
            ->assertStatus(422)->assertJsonPath('data.code', 'unsupported_type');
    }

    $questDeck = $this->postJson('/api/v1/quests', ['title' => 'Q'])->assertCreated()->json('data.deck.id');
    foreach (QAPI_QUIZ_TYPES as $quizType) {
        $this->postJson("/api/v1/quests/{$questDeck}/slides", ['type' => $quizType])
            ->assertStatus(422)->assertJsonPath('data.code', 'unsupported_type');
    }

    // A deck timer default set by the author wins over the type's own.
    $this->patchJson(QAPI_AUTHOR . "/{$deck['id']}", ['settings' => ['default_time_limit' => 15, 'get_ready_seconds' => 3]])->assertOk();
    $slide = qapiAppend($host, $deck['id'], 'match_pairs');
    expect($slide['timeLimitSeconds'])->toBe(15)->and($slide['getReadySeconds'])->toBe(3);
});

it('edits points on quiz slides within 0..1000 and min <= max', function () {
    $host = qapiOwner();
    $deck = qapiCreateQuiz($host);
    $slide = qapiAppend($host, $deck['id'], 'pick_answer_single');
    $url = QAPI_AUTHOR . "/{$deck['id']}/slides/{$slide['id']}";

    $this->patchJson($url, ['points_min' => 0, 'points_max' => 1000, 'speed_bonus_enabled' => false])
        ->assertOk()
        ->assertJsonPath('data.slide.pointsMin', 0)
        ->assertJsonPath('data.slide.pointsMax', 1000)
        ->assertJsonPath('data.slide.speedBonusEnabled', false);

    $this->patchJson($url, ['points_min' => 500])->assertOk()->assertJsonPath('data.slide.pointsMin', 500);

    $this->patchJson($url, ['points_min' => 1001])->assertStatus(422)->assertJsonValidationErrors(['points_min'], 'data.validation_errors');
    $this->patchJson($url, ['points_max' => -1])->assertStatus(422)->assertJsonValidationErrors(['points_max'], 'data.validation_errors');
    $this->patchJson($url, ['speed_bonus_enabled' => 'sometimes'])->assertStatus(422)->assertJsonValidationErrors(['speed_bonus_enabled'], 'data.validation_errors');
    // Against the stored value: min 500 is above a new max of 400.
    $this->patchJson($url, ['points_max' => 400])->assertStatus(422)->assertJsonValidationErrors(['points_max'], 'data.validation_errors');
    $this->patchJson($url, ['points_min' => 300, 'points_max' => 200])->assertStatus(422)->assertJsonValidationErrors(['points_min'], 'data.validation_errors');
    // null goes back to the default (50 / 100 / on at session start).
    $this->patchJson($url, ['points_min' => null, 'points_max' => null, 'speed_bonus_enabled' => null])
        ->assertOk()
        ->assertJsonPath('data.slide.pointsMin', null)
        ->assertJsonPath('data.slide.pointsMax', null);

    expect(Slide::find($slide['id'])->only(['points_min', 'points_max', 'speed_bonus_enabled']))
        ->toBe(['points_min' => null, 'points_max' => null, 'speed_bonus_enabled' => null]);

    // Unscored slides have no points.
    $board = qapiAppend($host, $deck['id'], 'leaderboard');
    $this->patchJson(QAPI_AUTHOR . "/{$deck['id']}/slides/{$board['id']}", ['points_max' => 10])
        ->assertStatus(422)->assertJsonValidationErrors(['points_max'], 'data.validation_errors');
});

it('refuses the quiz-only fields on Quest routes', function () {
    $host = qapiOwner();
    qapiAsHost($host);
    $deckId = $this->postJson('/api/v1/quests', ['title' => 'Quest'])->json('data.deck.id');
    $slide = $this->postJson("/api/v1/quests/{$deckId}/slides", ['type' => 'poll_single'])->assertCreated()->json('data.slide');
    $option = $slide['options'][0]['id'];

    expect($slide['pointsMin'])->toBeNull()->and($slide['pointsMax'])->toBeNull();

    foreach (['points_min' => 10, 'points_max' => 20, 'speed_bonus_enabled' => true] as $field => $value) {
        $this->patchJson("/api/v1/quests/{$deckId}/slides/{$slide['id']}", [$field => $value])
            ->assertStatus(422)
            ->assertJsonPath("data.validation_errors.{$field}.0", 'This field is only available on quiz slides.');
    }

    $this->patchJson("/api/v1/quests/{$deckId}/slides/{$slide['id']}", ['points_min' => null])
        ->assertStatus(422)->assertJsonValidationErrors(['points_min'], 'data.validation_errors');

    $this->patchJson("/api/v1/quests/{$deckId}/slides/{$slide['id']}/options/{$option}", ['is_correct' => true])
        ->assertStatus(422)->assertJsonPath('data.validation_errors.is_correct.0', 'This field is only available on quiz slides.');
    $this->postJson("/api/v1/quests/{$deckId}/slides/{$slide['id']}/options", ['label' => 'x', 'is_correct' => false])
        ->assertStatus(422)->assertJsonValidationErrors(['is_correct'], 'data.validation_errors');

    $this->postJson("/api/v1/quests/{$deckId}/slides/bulk", ['slides' => [
        ['type' => 'poll_single', 'points_max' => 10, 'options' => [['label' => 'a', 'is_correct' => true], ['label' => 'b']]],
    ]])->assertStatus(422)
        ->assertJsonValidationErrors(['slides.0.points_max', 'slides.0.options.0.is_correct'], 'data.validation_errors');

    expect(Slide::find($slide['id'])->points_min)->toBeNull()
        ->and(SlideOption::find($option)->is_correct)->toBeNull()
        ->and(Slide::query()->where('deck_id', $deckId)->count())->toBe(2);
});

it('marks correct options and validates type option payloads', function () {
    $host = qapiOwner();
    $deck = qapiCreateQuiz($host);
    $pick = qapiAppend($host, $deck['id'], 'pick_answer_single');
    $base = QAPI_AUTHOR . "/{$deck['id']}/slides/{$pick['id']}/options";

    $this->patchJson("{$base}/{$pick['options'][1]['id']}", ['label' => 'Paris', 'is_correct' => true])
        ->assertOk()
        ->assertJsonPath('data.option.isCorrect', true)
        ->assertJsonPath('data.slide.options.1.isCorrect', true);
    $this->postJson($base, ['label' => 'Rome', 'is_correct' => false])
        ->assertCreated()->assertJsonPath('data.option.isCorrect', false)->assertJsonPath('data.option.position', 3);
    $this->patchJson("{$base}/{$pick['options'][0]['id']}", ['is_correct' => 'yes'])
        ->assertStatus(422)->assertJsonValidationErrors(['is_correct'], 'data.validation_errors');
    $this->patchJson("{$base}/{$pick['options'][1]['id']}", ['is_correct' => null])->assertOk()->assertJsonPath('data.option.isCorrect', null);

    // Caps and minimums per type: pick answer 2..10.
    for ($i = 4; $i <= 10; $i++) {
        $this->postJson($base, ['label' => "Option {$i}"])->assertCreated();
    }
    $this->postJson($base, ['label' => 'Eleven'])->assertStatus(422)->assertJsonValidationErrors(['options'], 'data.validation_errors');

    // match_pairs cells need {side, pair_key}; the hook normalises the payload.
    $pairs = qapiAppend($host, $deck['id'], 'match_pairs');
    $pairsUrl = QAPI_AUTHOR . "/{$deck['id']}/slides/{$pairs['id']}/options";
    $this->postJson($pairsUrl, ['label' => 'Left 4'])->assertStatus(422)->assertJsonValidationErrors(['payload.side', 'payload.pair_key'], 'data.validation_errors');
    $this->postJson($pairsUrl, ['label' => 'Left 4', 'payload' => ['side' => 'left', 'pair_key' => 'p4', 'junk' => 1]])
        ->assertCreated()->assertJsonPath('data.option.payload', ['side' => 'left', 'pair_key' => 'p4']);
    $this->patchJson("{$pairsUrl}/{$pairs['options'][0]['id']}", ['payload' => ['side' => 'middle', 'pair_key' => 'p1']])
        ->assertStatus(422)->assertJsonValidationErrors(['payload.side'], 'data.validation_errors');

    // Spinner weights 0.1..100.
    $wheel = qapiAppend($host, $deck['id'], 'spinner_wheel');
    $this->patchJson(QAPI_AUTHOR . "/{$deck['id']}/slides/{$wheel['id']}/options/{$wheel['options'][0]['id']}", ['label' => 'Big', 'payload' => ['weight' => 101]])
        ->assertStatus(422)->assertJsonValidationErrors(['payload.weight'], 'data.validation_errors');
    $this->patchJson(QAPI_AUTHOR . "/{$deck['id']}/slides/{$wheel['id']}/options/{$wheel['options'][0]['id']}", ['label' => 'Big', 'payload' => ['weight' => 3]])
        ->assertOk()->assertJsonPath('data.option.payload.weight', 3);
});

it('adds scored quiz slides in bulk with points, correct options and payloads, all or nothing', function () {
    $host = qapiOwner();
    $deck = qapiCreateQuiz($host);
    $url = QAPI_AUTHOR . "/{$deck['id']}/slides/bulk";

    $slides = [
        ['type' => 'pick_answer_single', 'title' => 'Capital of France?', 'points_min' => 100, 'points_max' => 200, 'speed_bonus_enabled' => false,
            'options' => [['label' => 'Paris', 'is_correct' => true], ['label' => 'Lyon', 'is_correct' => false]]],
        ['type' => 'pick_answer_multi', 'title' => 'Primes?', 'config' => ['partial_credit' => false],
            'options' => [['label' => '2', 'is_correct' => true], ['label' => '3', 'is_correct' => true], ['label' => '4']]],
        ['type' => 'short_answer', 'title' => 'Largest planet?', 'options' => [['label' => 'Jupiter']]],
        ['type' => 'correct_order', 'title' => 'Order', 'options' => [['label' => 'One'], ['label' => 'Two'], ['label' => 'Three']]],
        ['type' => 'match_pairs', 'title' => 'Match', 'options' => [
            ['label' => 'Cat', 'payload' => ['side' => 'left', 'pair_key' => 'a']], ['label' => 'Meow', 'payload' => ['side' => 'right', 'pair_key' => 'a']],
            ['label' => 'Dog', 'payload' => ['side' => 'left', 'pair_key' => 'b']], ['label' => 'Woof', 'payload' => ['side' => 'right', 'pair_key' => 'b']],
        ]],
        ['type' => 'categorise', 'title' => 'Sort', 'config' => ['categories' => [['key' => 'fruit', 'label' => 'Fruit'], ['key' => 'veg', 'label' => 'Veg']]],
            'options' => [
                ['label' => 'Apple', 'payload' => ['correct_category_key' => 'fruit']], ['label' => 'Pear', 'payload' => ['correct_category_key' => 'fruit']],
                ['label' => 'Leek', 'payload' => ['correct_category_key' => 'veg']], ['label' => 'Kale', 'payload' => ['correct_category_key' => 'veg']],
            ]],
        ['type' => 'leaderboard', 'config' => ['top_n' => 5]],
    ];

    $created = $this->postJson($url, ['slides' => $slides])->assertCreated()->json('data');

    // pick_answer_multi is retired: it is saved as a Pick answer (its two correct options make it a multi-answer one).
    expect(array_column($created['slides'], 'type'))->toBe(array_replace(array_column($slides, 'type'), [1 => 'pick_answer_single']))
        ->and(array_column($created['order'], 'position'))->toBe([1, 2, 3, 4, 5, 6, 7, 8])
        ->and($created['slides'][0]['pointsMin'])->toBe(100)
        ->and($created['slides'][0]['pointsMax'])->toBe(200)
        ->and($created['slides'][0]['speedBonusEnabled'])->toBeFalse()
        ->and(array_column($created['slides'][0]['options'], 'isCorrect'))->toBe([true, false])
        ->and($created['slides'][1]['pointsMin'])->toBe(50)
        ->and($created['slides'][1]['timeLimitSeconds'])->toBe(20)
        ->and(array_column($created['slides'][1]['options'], 'isCorrect'))->toBe([true, true, null])
        ->and($created['slides'][4]['options'][1]['payload'])->toBe(['side' => 'right', 'pair_key' => 'a'])
        ->and($created['slides'][5]['config']['categories'][0])->toBe(['key' => 'fruit', 'label' => 'Fruit'])
        ->and($created['slides'][6]['pointsMin'])->toBeNull();

    // One bad slide saves nothing: points, payload and type errors are keyed slides.N.*.
    $before = Slide::query()->where('deck_id', $deck['id'])->count();
    $this->postJson($url, ['slides' => [
        ['type' => 'pick_answer_single', 'points_min' => 90, 'points_max' => 80],
        ['type' => 'match_pairs', 'options' => [['label' => 'x'], ['label' => 'y'], ['label' => 'z'], ['label' => 'w']]],
        ['type' => 'leaderboard', 'points_max' => 5],
    ]])->assertStatus(422)
        ->assertJsonValidationErrors(['slides.0.points_min', 'slides.1.options.0.payload.side', 'slides.2.points_max'], 'data.validation_errors');
    $this->postJson($url, ['slides' => [['type' => 'poll_single']]])->assertStatus(422)->assertJsonPath('data.code', 'unsupported_type');

    expect(Slide::query()->where('deck_id', $deck['id'])->count())->toBe($before);
});

it('duplicates quiz slides and decks with their points and correct answers, and reorders', function () {
    $host = qapiOwner();
    $deck = qapiCreateQuiz($host);
    $slide = qapiAppend($host, $deck['id'], 'pick_answer_single');
    qapiPatchSlide($host, $deck['id'], $slide['id'], ['points_max' => 300, 'speed_bonus_enabled' => false])->assertOk();
    qapiPatchOption($host, $deck['id'], $slide['id'], $slide['options'][0]['id'], ['is_correct' => true])->assertOk();

    $copy = $this->postJson(QAPI_AUTHOR . "/{$deck['id']}/slides/{$slide['id']}/duplicate")->assertCreated()->json('data.slide');
    expect($copy['pointsMax'])->toBe(300)
        ->and($copy['speedBonusEnabled'])->toBeFalse()
        ->and($copy['options'][0]['isCorrect'])->toBeTrue()
        ->and($copy['position'])->toBe(3);

    $order = $this->postJson(QAPI_AUTHOR . "/{$deck['id']}/slides/reorder", ['slides' => [
        ['id' => $copy['id'], 'position' => 1], ['id' => $deck['slides'][0]['id'], 'position' => 2], ['id' => $slide['id'], 'position' => 3],
    ]])->assertOk()->json('data.order');
    expect(array_column($order, 'id'))->toBe([$copy['id'], $deck['slides'][0]['id'], $slide['id']]);

    $dup = $this->postJson(QAPI_AUTHOR . "/{$deck['id']}/duplicate")->assertCreated()->json('data.deck');
    expect($dup['product'])->toBe('quiz')
        ->and($dup['settings']['get_ready_seconds'])->toBe(5)
        ->and($dup['slides'][0]['pointsMax'])->toBe(300)
        ->and($dup['slides'][0]['options'][0]['isCorrect'])->toBeTrue();
});
