<?php

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

/*
 * /api/v1/legacy-results: results of the previous version's quizzes and quests, read
 * straight from the old tables for their owner. Data shapes copied from production.
 */

uses(DatabaseTransactions::class);

beforeEach(function () {
    $this->owner = User::factory()->create();
});

/** A quiz with two questions, one session, two participants (anonymous) and their answers. */
function legacyQuizWithResults(User $owner): array
{
    $quiz = DB::table('quizes')->insertGetId(['title' => 'Sociology', 'user_id' => $owner->id, 'visibility' => 'public', 'created_at' => now(), 'updated_at' => now()]);
    $q1 = DB::table('questions')->insertGetId(['quiz_id' => $quiz, 'serial_number' => 1, 'question_type' => 'quiz_single_choice', 'question_text' => 'Founder of sociology?',
        'options' => json_encode(['choices' => ['Comte', 'Marx', 'Weber', null], 'correct_answer' => 0]), 'visibility' => 'public']);
    $q2 = DB::table('questions')->insertGetId(['quiz_id' => $quiz, 'serial_number' => 2, 'question_type' => 'quiz_multiple_choice', 'question_text' => 'Classical theorists',
        'options' => json_encode(['choices' => ['Durkheim', 'Weber', 'Freud'], 'correct_answer' => [0, 1]]), 'visibility' => 'public']);
    $session = DB::table('quiz_sessions')->insertGetId(['quiz_id' => $quiz, 'session_id' => 'abc', 'title' => 'Class A',
        'start_datetime' => '2026-07-20 10:00:00', 'end_datetime' => '2026-07-20 11:00:00', 'created_at' => now(), 'updated_at' => now()]);

    $answers = [
        'Nadia' => [[$q1, 0], [$q2, [0, 1]]],      // both right
        '=cmd|calc' => [[$q1, 1], [$q2, [0]]],    // both wrong; a name that would be a spreadsheet formula
    ];
    foreach ($answers as $name => $list) {
        $p = DB::table('quiz_participants')->insertGetId(['quiz_id' => $quiz, 'quiz_session_id' => $session, 'is_anonymous' => true,
            'anonymous_details' => json_encode(['name' => $name, 'email' => null]), 'start_time' => now(), 'score' => 0, 'created_at' => now(), 'updated_at' => now()]);
        foreach ($list as [$question, $selected]) {
            DB::table('user_quiz_answers')->insert(['quiz_participant_id' => $p, 'question_id' => $question,
                'answer_data' => json_encode(['selected_option' => $selected, 'start_time' => '2026-07-20 10:00:00']), 'time_taken_seconds' => 43200]);
        }
    }

    return ['quiz' => $quiz, 'session' => $session, 'q1' => $q1, 'q2' => $q2];
}

function legacyQuestWithResults(User $owner): array
{
    $quest = DB::table('quests')->insertGetId(['title' => 'AI survey', 'creator_id' => $owner->id, 'visibility' => 'public', 'created_at' => now(), 'updated_at' => now()]);
    $task = fn (string $type, array $items, array $extra = []) => DB::table('quest_tasks')->insertGetId([
        'quest_id' => $quest, 'title' => ucfirst($type), 'task_type' => $type, 'owner_id' => $owner->id,
        'task_data' => json_encode($extra + ['questions' => array_map(fn ($t) => ['text' => $t], $items)]),
    ]);
    $poll = $task('single_choice', ['Privacy', 'Accuracy']);
    $rank = $task('ranking', ['Save time', 'Better writing', 'Grading']);
    $scale = $task('scales', ['How often', 'How confident'], ['minNumber' => 1, 'maxNumber' => 5, 'minText' => 'Very Low', 'maxText' => 'Max']);
    $cloud = $task('wordcloud', []);
    $session = DB::table('quest_sessions')->insertGetId(['quest_id' => $quest, 'session_id' => 'q1', 'title' => 'Workshop', 'start_datetime' => '2026-10-19 15:00:00', 'created_at' => now(), 'updated_at' => now()]);

    $people = [
        [[$poll, 1], [$rank, [0, 2, 1]], [$scale, [5, 4]], [$cloud, ['Excited']]],
        [[$poll, 1], [$rank, [0]], [$scale, [3, 0]], [$cloud, ['excited', 'Curious']]],
    ];
    foreach ($people as $i => $list) {
        $p = DB::table('quest_participants')->insertGetId(['quest_id' => $quest, 'quest_session_id' => $session, 'is_anonymous' => true,
            'anonymous_details' => json_encode(['name' => "P{$i}"]), 'start_time' => now(), 'created_at' => now(), 'updated_at' => now()]);
        foreach ($list as [$t, $selected]) {
            DB::table('quest_task_completions')->insert(['participant_id' => $p, 'task_id' => $t, 'completion_data' => json_encode(['selected_option' => $selected])]);
        }
    }

    return ['quest' => $quest, 'session' => $session];
}

it('lists the owner\'s old quizzes and quests that people took part in', function () {
    $quiz = legacyQuizWithResults($this->owner);
    $quest = legacyQuestWithResults($this->owner);
    DB::table('quizes')->insert(['title' => 'Never played', 'user_id' => $this->owner->id, 'visibility' => 'public']);
    Sanctum::actingAs($this->owner);

    $items = $this->getJson('/api/v1/legacy-results')->assertOk()->json('data.items');

    expect(collect($items)->map(fn ($i) => [$i['source'], $i['id'], $i['sessions'], $i['participants']])->sortBy(0)->values()->all())
        ->toBe([['quest', $quest['quest'], 1, 2], ['quiz', $quiz['quiz'], 1, 2]]);
});

it('shows a quiz session with right / wrong per answer and per question', function () {
    $ids = legacyQuizWithResults($this->owner);
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/v1/legacy-results/quiz/{$ids['quiz']}")->assertOk()
        ->assertJsonPath('data.sessions.0.id', (string) $ids['session'])
        ->assertJsonPath('data.sessions.0.participants', 2);

    $data = $this->getJson("/api/v1/legacy-results/quiz/{$ids['quiz']}/sessions/{$ids['session']}")->assertOk()->json('data');

    expect($data['questions'][0])->toMatchArray(['number' => 1, 'answered' => 2, 'correct' => 1, 'correct_answer' => 'Comte'])
        ->and($data['questions'][0]['summary']['choices'])->toBe([
            ['label' => 'Comte', 'count' => 1, 'correct' => true],
            ['label' => 'Marx', 'count' => 1, 'correct' => false],
            ['label' => 'Weber', 'count' => 0, 'correct' => false],
        ])
        ->and($data['questions'][1]['correct_answer'])->toBe('Durkheim, Weber');

    $nadia = collect($data['participants'])->firstWhere('name', 'Nadia');
    expect($nadia)->toMatchArray(['answered' => 2, 'correct' => 2])
        ->and($nadia['answers'][(string) $ids['q2']])->toBe(['text' => 'Durkheim, Weber', 'correct' => true]);
    expect(collect($data['participants'])->firstWhere('name', '=cmd|calc')['correct'])->toBe(0);
});

it('adds up a quest session: votes, rankings, scales and words', function () {
    $ids = legacyQuestWithResults($this->owner);
    Sanctum::actingAs($this->owner);

    $q = collect($this->getJson("/api/v1/legacy-results/quest/{$ids['quest']}/sessions/{$ids['session']}")->assertOk()->json('data.questions'))->keyBy('type');

    expect($q['single_choice']['summary']['choices'])->toBe([['label' => 'Privacy', 'count' => 0], ['label' => 'Accuracy', 'count' => 2]])
        ->and($q['single_choice']['correct'])->toBeNull()
        ->and($q['ranking']['summary']['items'][0])->toBe(['label' => 'Save time', 'average_position' => 1, 'first' => 2, 'ranked' => 2])
        ->and($q['scales']['summary']['statements'][0])->toMatchArray(['label' => 'How often', 'average' => 4, 'answered' => 2, 'skipped' => 0])
        ->and($q['scales']['summary']['statements'][1])->toMatchArray(['average' => 4, 'answered' => 1, 'skipped' => 1]) // 0 = slider left unset
        ->and($q['wordcloud']['summary']['words'])->toBe([['text' => 'Excited', 'count' => 2], ['text' => 'Curious', 'count' => 1]]);
});

it('exports a session as CSV without letting a name run as a formula', function () {
    $ids = legacyQuizWithResults($this->owner);
    Sanctum::actingAs($this->owner);

    $csv = $this->get("/api/v1/legacy-results/quiz/{$ids['quiz']}/sessions/{$ids['session']}/export")->assertOk()->streamedContent();

    expect($csv)->toContain('Participant,"Joined at",Answered,Correct,"Q1: Founder of sociology?"')
        ->toContain('Nadia,')
        ->toContain('"Comte (correct)"')
        ->toContain("'=cmd|calc")
        ->not->toContain("\n=cmd");
});

it('hides other people\'s results', function () {
    $ids = legacyQuizWithResults($this->owner);
    Sanctum::actingAs(User::factory()->create());

    $this->getJson('/api/v1/legacy-results')->assertOk()->assertJsonPath('data.items', []);
    $this->getJson("/api/v1/legacy-results/quiz/{$ids['quiz']}")->assertNotFound();
    $this->getJson("/api/v1/legacy-results/quiz/{$ids['quiz']}/sessions/{$ids['session']}")->assertNotFound();
    $this->get("/api/v1/legacy-results/quiz/{$ids['quiz']}/sessions/{$ids['session']}/export")->assertNotFound();
});

it('needs a signed-in user', function () {
    $this->getJson('/api/v1/legacy-results')->assertUnauthorized();
});
