<?php

use App\Models\Deck\Deck;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
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

/**
 * A My Library quiz deck: a QR code slide, then one question slide of each
 * kind the editor makes (content slides are never listed).
 */
function fgLibraryQuiz(User $user): Deck
{
    $deck = Deck::factory()->quiz()->ownedBy($user)->create(['title' => 'Networks Basics', 'description' => 'Week 3']);
    $slide = function (string $type, string $title, array $options = [], int $limit = 20) use ($deck) {
        $slide = Slide::factory()->ofType($type)->create(['deck_id' => $deck->id, 'title' => $title, 'time_limit_seconds' => $limit]);
        foreach ($options as [$label, $correct]) {
            SlideOption::factory()->create(['slide_id' => $slide->id, 'label' => $label, 'is_correct' => $correct]);
        }

        return $slide;
    };
    $slide('qr_code', 'Join');
    $slide('pick_answer_single', 'Default port for HTTPS?', [['80', false], ['443', true], ['', false], ['22', false]]);
    $slide('true_false', 'TCP is connection-oriented.', [['True', true], ['False', false]]);
    $slide('pick_answer_single', 'Which is a transport protocol?', [['IP', false], ['UDP', true], ['ARP', false]], 45);
    $slide('pick_answer_single', 'Pick both link-layer protocols', [['Ethernet', true], ['PPP', true], ['HTTP', false]]);
    $slide('correct_order', 'Order the OSI layers', [['Physical', null], ['Link', null], ['Network', null]]);
    $slide('pick_answer_single', 'Blank correct answer', [['A', false], ['', true], ['C', false]]);

    return $deck;
}

it('lists only the host\'s own library quizzes and previews the conversion', function () {
    $user = fgImportUser();
    $quiz = fgLibraryQuiz($user);
    $other = fgLibraryQuiz(fgImportUser());
    Deck::factory()->ownedBy($user)->create(); // a quest
    Sanctum::actingAs($user);

    $list = $this->getJson('/api/v1/fun-games/host/library-quizzes')->assertOk()->json('data.quizzes');
    expect($list)->toHaveCount(1)
        ->and($list[0]['questionCount'])->toBe(6);

    $preview = $this->getJson("/api/v1/fun-games/host/library-quizzes/{$quiz->id}/preview")->assertOk()->json('data');
    expect(collect($preview['rows'])->pluck('status')->all())->toBe(['ready', 'ready', 'ready', 'skipped', 'skipped', 'skipped'])
        ->and($preview['importable'])->toBe(3)
        ->and($preview['rows'][3]['messages'][0])->toContain('2 correct answers')
        ->and($preview['rows'][4]['messages'][0])->toContain('Correct order')
        ->and($preview['rows'][5]['messages'][0])->toContain('No correct answer')
        ->and($preview['suggestedTimer']['secondsPerQuestion'])->toBe(20);

    $this->getJson("/api/v1/fun-games/host/library-quizzes/{$other->id}/preview")->assertNotFound();
});

it('creates a draft game from a library quiz that owns its own copy of the questions', function () {
    $user = fgImportUser();
    $quiz = fgLibraryQuiz($user);
    Sanctum::actingAs($user);

    $response = $this->postJson('/api/v1/fun-games/host/games/from-library', ['quizId' => $quiz->id])->assertCreated();
    $game = $response->json('data.game');

    expect($game['title'])->toBe('Networks Basics')
        ->and($game['description'])->toBe('Week 3')
        ->and($game['sourceDeckId'])->toBe((string) $quiz->id)
        ->and($game['published'])->toBeFalse()
        ->and($game['timer'])->toMatchArray(['mode' => 'perQuestion', 'secondsPerQuestion' => 20])
        ->and($game['questions'])->toHaveCount(3)
        ->and($response->json('data.import.skipped'))->toHaveCount(3);

    // Blank choices are dropped and the correct answer still points at the right option.
    $first = $game['questions'][0];
    expect(collect($first['options'])->pluck('text')->all())->toBe(['80', '443', '22'])
        ->and(collect($first['options'])->firstWhere('id', $first['correctOptionId'])['text'])->toBe('443')
        ->and($first['marks'])->toEqual(1);
    // A different time limit is kept as a per-question override.
    expect($game['questions'][2]['secondsOverride'])->toBe(45);

    // Editing the library quiz later doesn't change the game.
    Slide::where('deck_id', $quiz->id)->update(['title' => 'Changed']);
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
