<?php

use App\Deck\Legacy\LegacyDeckConverter;
use App\Deck\Legacy\LegacyDeckImport;
use App\Deck\Legacy\LegacySlides;
use App\Models\Deck\Deck;
use App\Models\Deck\Slide;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;

require_once __DIR__ . '/Quiz/QuizApiHelpers.php';

/*
 * legacy:convert-decks: legacy v1 quizzes (quizes + questions) and quests (quests +
 * quest_tasks) become decks of the same owner. The option shapes below are copied from
 * the production data (mindspear_backup.dump).
 */

uses(DatabaseTransactions::class);

beforeEach(function () {
    qapiSetUp();
    $this->owner = User::factory()->create();
});

function legacyQuiz(User $owner, array $questions, array $attributes = []): int
{
    $id = DB::table('quizes')->insertGetId($attributes + [
        'title' => 'Ancient to Mughal', 'description' => 'Bengal history', 'user_id' => $owner->id,
        'visibility' => 'public', 'created_at' => '2026-07-13 10:00:00', 'updated_at' => '2026-07-14 10:00:00',
    ]);
    foreach ($questions as $i => [$type, $text, $options, $seconds]) {
        DB::table('questions')->insert([
            'quiz_id' => $id, 'serial_number' => $i + 1, 'question_type' => $type, 'question_text' => $text,
            'options' => $options === null ? null : json_encode($options), 'time_limit_seconds' => $seconds,
            'visibility' => 'public', 'owner_id' => $owner->id,
        ]);
    }

    return $id;
}

function legacyQuest(User $owner, array $tasks): int
{
    $id = DB::table('quests')->insertGetId([
        'title' => 'AI in teaching', 'creator_id' => $owner->id, 'visibility' => 'public',
        'created_at' => now(), 'updated_at' => now(),
    ]);
    foreach ($tasks as $i => [$type, $title, $data]) {
        DB::table('quest_tasks')->insert([
            'quest_id' => $id, 'serial_number' => $i + 1, 'task_type' => $type, 'title' => $title,
            'task_data' => $data === null ? null : json_encode($data), 'owner_id' => $owner->id,
        ]);
    }

    return $id;
}

/** Legacy quest task_data: the same defaults the old editor saved. */
function legacyItems(array $texts, array $extra = []): array
{
    return $extra + [
        'maxText' => 'Strongly disagree', 'minText' => 'Strongly agree', 'layout_id' => null,
        'maxNumber' => 0, 'minNumber' => 0, 'time_limit' => 60,
        'questions' => array_map(fn ($text, $i) => ['id' => $i + 1, 'text' => $text, 'color' => '#F79945'], $texts, array_keys($texts)),
    ];
}

/** "label✓" per option, in order. */
function legacySlideOptions(Slide $slide): array
{
    return $slide->options()->orderBy('position')->get()
        ->map(fn ($o) => $o->label . ($o->is_correct ? '✓' : ''))->all();
}

function legacyConvert(string $source, int $id, bool $dryRun = false, string $visibility = 'private'): array
{
    return app(LegacyDeckConverter::class)->convert($source, $id, $dryRun, $visibility);
}

it('copies a quiz with every legacy question type into a deck of the same owner', function () {
    $colors = ['#F79945', '#BC5EB3', '#5769e7', '#89c6c7'];
    $id = legacyQuiz($this->owner, [
        ['quiz_single_choice', 'Pala School of art?', ['color' => $colors, 'choices' => ['Mughal', 'Pala', 'Sena', 'Sultanate'], 'correct_answer' => 1], 45],
        ['quiz_multiple_choice', 'The Mughal period was known for', ['choices' => ['Jamdani', 'Persian wheel', 'Charyapada', 'Bronze'], 'correct_answer' => [0, 1]], 45],
        ['true_false_choice', 'Dhaka was a trade centre.', ['color' => $colors, 'choices' => ['True', 'False', null, null], 'correct_answer' => 0], null],
        ['fill_in_the_blanks', 'Blood returns to the ___ atrium', ['choices' => ['left', 'right'], 'correct_answer' => 1], null],
        ['sort_answer_choice', 'Oldest first', ['choices' => ['Pala', 'Sena', 'Sultanate', null], 'correct_answer' => [0, 1, 2, 3]], 30],
        ['short_answer', 'Smallest blood vessels?', ['choices' => ['Capillaries', 'Tissue capillaries'], 'correct_answer' => [0, 1]], null],
        ['short_answer', 'Stateful firewall challenge?', ['choices' => [], 'correct_answer' => ['Tracking connections', 'Connection state']], null],
        [null, '.', null, null],
    ]);

    $report = legacyConvert('quiz', $id);

    expect($report['status'])->toBe('converted')->and($report['slides'])->toBe(7)
        ->and($report['skipped'])->toBe([['position' => 8, 'type' => null, 'reason' => 'no question type (an unfinished, blank question)']]);

    $deck = Deck::findOrFail($report['deck_id']);
    expect($deck->owner_id)->toBe($this->owner->id)
        ->and($deck->product)->toBe('quiz')
        ->and($deck->title)->toBe('Ancient to Mughal')
        ->and($deck->description)->toBe('Bengal history')
        ->and($deck->visibility)->toBe('private')
        ->and($deck->created_at->toDateTimeString())->toBe('2026-07-13 10:00:00');

    $slides = $deck->slides()->orderBy('position')->get();
    expect($slides->pluck('type')->all())->toBe([
        'qr_code', 'pick_answer_single', 'pick_answer_single', 'true_false', 'pick_answer_single', 'correct_order', 'short_answer', 'short_answer',
    ]);
    expect($slides[1]->title)->toBe('Pala School of art?')
        ->and(legacySlideOptions($slides[1]))->toBe(['Mughal', 'Pala✓', 'Sena', 'Sultanate'])
        ->and($slides[1]->time_limit_seconds)->toBe(45)
        ->and(legacySlideOptions($slides[2]))->toBe(['Jamdani✓', 'Persian wheel✓', 'Charyapada', 'Bronze'])
        ->and(legacySlideOptions($slides[3]))->toBe(['True✓', 'False'])
        ->and(legacySlideOptions($slides[4]))->toBe(['left', 'right✓'])
        ->and(legacySlideOptions($slides[5]))->toBe(['Pala', 'Sena', 'Sultanate'])
        ->and($slides[5]->time_limit_seconds)->toBe(30)
        ->and(legacySlideOptions($slides[6]))->toBe(['Capillaries', 'Tissue capillaries'])
        ->and(legacySlideOptions($slides[7]))->toBe(['Tracking connections', 'Connection state']);

    // The legacy rows are only read.
    expect(DB::table('quizes')->where('id', $id)->exists())->toBeTrue()
        ->and(DB::table('questions')->where('quiz_id', $id)->count())->toBe(8);
});

it('copies a quest into poll, ranking, scales, word cloud and open-ended slides', function () {
    $id = legacyQuest($this->owner, [
        ['single_choice', 'Biggest worry?', legacyItems(['Accuracy', 'Privacy', 'Over-reliance'])],
        ['multiple_choice', 'Tools you use', legacyItems(['ChatGPT', 'Gemini', 'Grammarly'])],
        ['truefalse', 'Do you use AI?', legacyItems(['Yes', 'No'])],
        ['ranking', 'Rank the benefits', legacyItems(['Save time', 'Better writing'])],
        ['scales', 'In using AI tools', legacyItems(['How often', 'How confident'], ['minNumber' => 1, 'maxNumber' => 5, 'minText' => 'Very Low', 'maxText' => 'Max'])],
        ['wordcloud', 'One word for AI', legacyItems(['Curious'])],
        ['shortanswer', 'Your name?', legacyItems(['Item 1'])],
        ['longanswer', 'Describe a lesson', legacyItems(['Item 1'])],
        ['qsenchoice', 'Untitled question', null],
    ]);

    $report = legacyConvert('quest', $id);

    expect($report['status'])->toBe('converted')->and($report['slides'])->toBe(8)->and($report['skipped'])->toHaveCount(1);
    $slides = Deck::findOrFail($report['deck_id'])->slides()->orderBy('position')->get();
    expect($slides->pluck('type')->all())->toBe([
        'qr_code', 'poll_single', 'poll_multi', 'poll_single', 'ranking', 'scales', 'word_cloud', 'open_ended', 'open_ended',
    ]);
    expect(legacySlideOptions($slides[1]))->toBe(['Accuracy', 'Privacy', 'Over-reliance'])
        ->and($slides[1]->time_limit_seconds)->toBe(60)
        ->and(legacySlideOptions($slides[4]))->toBe(['Save time', 'Better writing'])
        ->and($slides[5]->config['scale_points'])->toBe(5)
        ->and($slides[5]->config['scale_labels'])->toBe(['Very Low', null, null, null, 'Max'])
        ->and(legacySlideOptions($slides[5]))->toBe(['How often', 'How confident'])
        ->and($slides[8]->config['max_length'])->toBe(2000);
});

it('converts each source once, and a dry run saves nothing', function () {
    $id = legacyQuiz($this->owner, [['single_choice', 'Q', ['choices' => ['A', 'B'], 'correct_answer' => 0], null]]);

    $dry = legacyConvert('quiz', $id, dryRun: true);
    expect($dry['status'])->toBe('converted')->and($dry['slides'])->toBe(1)
        ->and(Deck::query()->where('owner_id', $this->owner->id)->count())->toBe(0)
        ->and(LegacyDeckImport::query()->count())->toBe(0);

    $first = legacyConvert('quiz', $id);
    $again = legacyConvert('quiz', $id);
    expect($again['status'])->toBe('already')->and($again['deck_id'])->toBe($first['deck_id'])
        ->and(Deck::query()->where('owner_id', $this->owner->id)->count())->toBe(1);
});

it('keeps public visibility only when asked', function () {
    $id = legacyQuiz($this->owner, []);

    expect(Deck::find(legacyConvert('quiz', $id, visibility: 'keep')['deck_id'])->visibility)->toBe('public');
});

it('runs from artisan and reports failures', function () {
    $id = legacyQuiz($this->owner, [['true_false', 'Sky is blue', ['choices' => ['True', 'False'], 'correct_answer' => 0], null]]);

    $this->artisan('legacy:convert-decks', ['--only' => 'quiz', '--id' => [$id]])->assertSuccessful();
    $this->artisan('legacy:convert-decks', ['--only' => 'quiz', '--id' => [999999999]])->assertFailed();
    $this->artisan('legacy:convert-decks', ['--id' => [$id]])->assertFailed(); // --id needs --only
});

it('maps the edge cases of legacy questions', function () {
    // No correct answer marked: still converted, with a note.
    $mapped = LegacySlides::fromQuestion(['question_type' => 'single_choice', 'question_text' => 'Q', 'options' => ['choices' => ['A', 'B']], 'time_limit_seconds' => null]);
    expect($mapped['slide']['options'])->toBe([['label' => 'A', 'is_correct' => false], ['label' => 'B', 'is_correct' => false]])
        ->and($mapped['notes'])->toHaveCount(1);

    // True/false with more than two real answers stays a Pick answer.
    expect(LegacySlides::fromQuestion(['question_type' => 'true_false', 'question_text' => 'Q', 'options' => ['choices' => ['A', 'B', 'C'], 'correct_answer' => 2]])['slide']['type'])
        ->toBe('pick_answer_single');

    // Sort question whose items were never filled in.
    expect(LegacySlides::fromQuestion(['question_type' => 'sort_answer_choice', 'question_text' => 'Q', 'options' => ['choices' => [null, null, null, null], 'correct_answer' => [0, 1, 2, 3]]]))
        ->toBe(['skip' => 'Correct order needs at least 3 items']);

    // Time limits outside the deck range are clamped.
    expect(LegacySlides::fromQuestion(['question_type' => 'single_choice', 'question_text' => 'Q', 'options' => ['choices' => ['A', 'B'], 'correct_answer' => 0], 'time_limit_seconds' => 99999])['time_limit'])
        ->toBe(\App\Deck\Authoring\SlideInput::MAX_TIME_LIMIT);
});

it('can be presented live like any deck', function () {
    $id = legacyQuiz($this->owner, [['quiz_single_choice', 'Capital?', ['choices' => ['Dhaka', 'Khulna'], 'correct_answer' => 0], 20]]);
    $deckId = legacyConvert('quiz', $id)['deck_id'];

    $state = qapiStart($this->owner, $deckId);
    $sessionId = $state['session_id'];
    [$p0] = qapiJoin($state, ['Ada']);

    $moved = qapiAdvance($this->owner, $sessionId, ['action' => 'next_slide'])->assertOk()->json('data');
    expect($moved['current_run']['type'])->toBe('pick_answer_single');
    qapiAdvance($this->owner, $sessionId, ['action' => 'start_voting'])->assertOk();
    $this->travel(10)->seconds();
    $run = qapiState($sessionId, $p0['token'])->assertOk()->json('data.current_slide_run');
    $dhaka = collect($run['options'])->firstWhere('label', 'Dhaka');

    qapiSubmit($sessionId, (int) $run['id'], $p0['token'], ['option_id' => $dhaka['id']])->assertNoContent();
    qapiMyAnswer($sessionId, (int) $run['id'], $p0['token'])->assertOk()->assertJsonPath('data.is_correct', true);
});
