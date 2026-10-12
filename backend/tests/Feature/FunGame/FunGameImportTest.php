<?php

use App\Models\Quiz\Question;
use App\Models\Quiz\Quiz;
use App\Models\User;
use App\Modules\FunGame\Models\FunGame;
use App\Modules\FunGame\Models\FunGameQuestion;
use App\Modules\FunGame\Models\FunGameSession;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

beforeEach(function () {
    config([
        'broadcasting.default' => 'null',
        'cache.default' => 'array',
        'queue.default' => 'sync',
        'logging.channels.fungames' => ['driver' => 'null'],
    ]);
});

function fgImportUser(): User
{
    return User::create([
        'first_name' => 'Lib',
        'last_name' => 'Owner',
        'email' => 'lib-owner-' . str()->uuid() . '@example.test',
        'email_verified_at' => now(),
        'is_verified' => true,
        'password' => Hash::make('password'),
    ]);
}

/** A My Library quiz with one question of each kind the creator produces. */
function fgLibraryQuiz(User $user): Quiz
{
    $quiz = Quiz::create(['title' => 'Networks <b>Basics</b>', 'description' => '<p>Week 3</p>', 'user_id' => $user->id, 'visibility' => 'private']);
    $q = fn (int $n, string $type, string $text, array $choices, $correct, int $points = 2, int $limit = 20) => Question::create([
        'quiz_id' => $quiz->id,
        'owner_id' => $user->id,
        'serial_number' => $n,
        'question_type' => $type,
        'question_text' => $text,
        'options' => ['choices' => $choices, 'correct_answer' => $correct, 'color' => []],
        'points' => $points,
        'time_limit_seconds' => $limit,
        'visibility' => 'private',
    ]);
    $q(1, 'quiz_single_choice', 'Default port for HTTPS?', ['80', '443', '', '22'], 1);
    $q(2, 'true_false_choice', 'TCP is connection-oriented.', ['True', 'False'], 0, 1);
    $q(3, 'quiz_multiple_choice', 'Which is a transport protocol?', ['IP', 'UDP', 'ARP'], [1], 3, 45);
    $q(4, 'quiz_multiple_choice', 'Pick both link-layer protocols', ['Ethernet', 'PPP', 'HTTP'], [0, 1]);
    $q(5, 'sort_answer_choice', 'Order the OSI layers', ['Physical', 'Link', 'Network'], [0, 1, 2]);
    $q(6, 'quiz_single_choice', 'Blank correct answer', ['A', '', 'C'], 1);

    return $quiz;
}

it('lists only the host\'s own library quizzes and previews the conversion', function () {
    $user = fgImportUser();
    $quiz = fgLibraryQuiz($user);
    fgLibraryQuiz(fgImportUser()); // someone else's
    Sanctum::actingAs($user);

    $list = $this->getJson('/api/v1/fun-games/host/library-quizzes')->assertOk()->json('data.quizzes');
    expect($list)->toHaveCount(1)
        ->and($list[0]['questionCount'])->toBe(6);

    $preview = $this->getJson("/api/v1/fun-games/host/library-quizzes/{$quiz->id}/preview")->assertOk()->json('data');
    expect(collect($preview['rows'])->pluck('status')->all())->toBe(['ready', 'ready', 'check', 'skipped', 'skipped', 'skipped'])
        ->and($preview['importable'])->toBe(3)
        ->and($preview['rows'][3]['messages'][0])->toContain('2 correct answers')
        ->and($preview['rows'][4]['messages'][0])->toContain('Sort answer')
        ->and($preview['suggestedTimer']['secondsPerQuestion'])->toBe(20);

    $other = Quiz::where('user_id', '!=', $user->id)->latest('id')->first();
    $this->getJson("/api/v1/fun-games/host/library-quizzes/{$other->id}/preview")->assertNotFound();
});

it('creates a draft game from a library quiz that owns its own copy of the questions', function () {
    $user = fgImportUser();
    $quiz = fgLibraryQuiz($user);
    Sanctum::actingAs($user);

    $response = $this->postJson('/api/v1/fun-games/host/games/from-library', ['quizId' => $quiz->id])->assertCreated();
    $game = $response->json('data.game');

    expect($game['title'])->toBe('Networks <b>Basics</b>')
        ->and($game['description'])->toBe('Week 3')
        ->and($game['published'])->toBeFalse()
        ->and($game['timer'])->toMatchArray(['mode' => 'perQuestion', 'secondsPerQuestion' => 20])
        ->and($game['questions'])->toHaveCount(3)
        ->and($response->json('data.import.skipped'))->toHaveCount(3);

    // Blank choices are dropped and the correct answer still points at the right option.
    $first = $game['questions'][0];
    expect(collect($first['options'])->pluck('text')->all())->toBe(['80', '443', '22'])
        ->and(collect($first['options'])->firstWhere('id', $first['correctOptionId'])['text'])->toBe('443')
        ->and($first['marks'])->toEqual(2);
    // A different time limit is kept as a per-question override.
    expect($game['questions'][2]['secondsOverride'])->toBe(45);

    // Editing the library quiz later doesn't change the game.
    Question::where('quiz_id', $quiz->id)->update(['question_text' => 'Changed']);
    expect(FunGameQuestion::where('fun_game_id', $game['id'])->pluck('text')->contains('Changed'))->toBeFalse();
});

it('validates JSON rows, refuses imports with errors, and imports the rest', function () {
    $user = fgImportUser();
    Sanctum::actingAs($user);
    $gameId = $this->postJson('/api/v1/fun-games/host/games', ['title' => 'JSON game'])->assertCreated()->json('data.game.id');

    $questions = [
        ['type' => 'single_choice', 'text' => 'Context switch?', 'options' => ['Save CPU state', 'Switch users'], 'answer' => 0, 'marks' => 2],
        ['type' => 'single_choice', 'text' => 'No marks given', 'options' => ['a', 'b'], 'answer' => 1],
        ['type' => 'multi', 'text' => 'Bad type', 'options' => ['a', 'b'], 'answer' => 0],
        ['type' => 'single_choice', 'text' => 'Answer out of range', 'options' => ['a', 'b'], 'answer' => 2],
    ];

    $dry = $this->postJson("/api/v1/fun-games/host/games/{$gameId}/import", [
        'source' => 'json', 'questions' => $questions, 'mode' => 'append', 'dryRun' => true,
    ])->assertOk()->json('data');
    expect(collect($dry['rows'])->pluck('status')->all())->toBe(['ready', 'check', 'error', 'error'])
        ->and($dry['rows'][3]['messages'][0])->toContain('only 2 options');

    $this->postJson("/api/v1/fun-games/host/games/{$gameId}/import", [
        'source' => 'json', 'questions' => $questions, 'mode' => 'append',
    ])->assertUnprocessable();
    expect(FunGameQuestion::where('fun_game_id', $gameId)->count())->toBe(0);

    $done = $this->postJson("/api/v1/fun-games/host/games/{$gameId}/import", [
        'source' => 'json', 'questions' => array_slice($questions, 0, 2), 'mode' => 'append',
        'timer' => ['mode' => 'total', 'totalSeconds' => 900],
    ])->assertCreated()->json('data');
    expect($done['import']['added'])->toBe(2)
        ->and($done['game']['timer'])->toMatchArray(['mode' => 'total', 'totalSeconds' => 900]);
});

it('replaces questions without breaking finished sessions, and undoes an import', function () {
    $user = fgImportUser();
    Sanctum::actingAs($user);
    $game = FunGame::create(['user_id' => $user->id, 'title' => 'Played', 'status' => 'published', 'timer_mode' => 'total', 'total_seconds' => 300]);
    $old = FunGameQuestion::create([
        'fun_game_id' => $game->id, 'position' => 1, 'text' => 'Old question',
        'options' => [['id' => 'a', 'text' => 'Yes'], ['id' => 'b', 'text' => 'No']], 'correct_option_id' => 'a', 'marks' => 2,
    ]);
    $session = FunGameSession::create([
        'fun_game_id' => $game->id, 'join_code' => 'GTEST' . random_int(10, 99), 'public_channel_key' => str()->random(32),
        'status' => 'finished', 'started_at' => now()->subHour(), 'finished_at' => now()->subMinutes(50),
        'timer_snapshot' => ['mode' => 'total', 'total_seconds' => 300, 'question_ids' => [$old->id]],
    ]);

    $importId = $this->postJson("/api/v1/fun-games/host/games/{$game->id}/import", [
        'source' => 'json', 'mode' => 'replace',
        'questions' => [['type' => 'single_choice', 'text' => 'New question', 'options' => ['x', 'y'], 'answer' => 0, 'marks' => 1]],
    ])->assertCreated()->json('data.import.id');

    expect($game->questions()->pluck('text')->all())->toBe(['New question'])
        // The finished session still sees the question it was played with.
        ->and(FunGameQuestion::withTrashed()->find($old->id))->not->toBeNull()
        ->and($session->refresh()->questionIds())->toBe([$old->id]);

    $this->postJson("/api/v1/fun-games/host/imports/{$importId}/undo")->assertOk();
    expect($game->questions()->pluck('text')->all())->toBe(['Old question']);
    $this->postJson("/api/v1/fun-games/host/imports/{$importId}/undo")->assertStatus(409);

    Sanctum::actingAs(fgImportUser());
    $this->postJson("/api/v1/fun-games/host/imports/{$importId}/undo")->assertNotFound();
});
