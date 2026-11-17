<?php

use App\Models\User;
use App\Modules\FunGame\Models\FunGame;
use App\Modules\FunGame\Models\FunGameParticipant;
use App\Modules\FunGame\Models\FunGameQuestion;
use App\Modules\FunGame\Models\FunGameSession;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

beforeEach(function () {
    $this->logFile = sys_get_temp_dir() . '/fungames-test-' . getmypid() . '.log';
    @unlink($this->logFile);
    config([
        'broadcasting.default' => 'null',
        'cache.default' => 'array',
        'queue.default' => 'sync',
        'logging.channels.fungames' => ['driver' => 'single', 'path' => $this->logFile, 'level' => 'debug'],
    ]);
    app()->forgetInstance('log');
    // Deterministic clock: deadlines and speed points are checked to the millisecond.
    $this->freezeTime();
});

function fgUser(): User
{
    return User::create([
        'first_name' => 'Fun',
        'last_name' => 'Host',
        'email' => 'fun-host-' . str()->uuid() . '@example.test',
        'email_verified_at' => now(),
        'is_verified' => true,
        'password' => Hash::make('password'),
    ]);
}

/**
 * A published game with `$count` questions; option "a" is always correct (2 marks, −0.5 wrong).
 * Per-question timer: 20 s each. Total timer: 300 s.
 */
function fgGame(User $user, string $mode = 'per_question', int $count = 3, string $scoring = 'marks', bool $shuffle = true): FunGame
{
    $game = FunGame::create([
        'user_id' => $user->id,
        'title' => 'Networks warm-up',
        'status' => FunGame::STATUS_PUBLISHED,
        'timer_mode' => $mode,
        'total_seconds' => 300,
        'seconds_per_question' => 20,
        'scoring_mode' => $scoring,
        'shuffle_questions' => $shuffle,
    ]);
    for ($i = 1; $i <= $count; $i++) {
        FunGameQuestion::create([
            'fun_game_id' => $game->id,
            'position' => $i,
            'text' => "Question {$i}",
            'options' => [['id' => 'a', 'text' => 'Right'], ['id' => 'b', 'text' => 'Wrong'], ['id' => 'c', 'text' => 'Also wrong']],
            'correct_option_id' => 'a',
            'marks' => 2,
            'negative_marks' => 0.5,
        ]);
    }

    return $game;
}

function fgHostSession($test, FunGame $game): FunGameSession
{
    Sanctum::actingAs($game->user);
    $id = $test->postJson("/api/v1/fun-games/host/games/{$game->id}/sessions")
        ->assertCreated()
        ->json('data.session.id');

    return FunGameSession::findOrFail($id);
}

/** @return array{token: string, id: string} */
function fgJoin($test, FunGameSession $session, string $name, string $email): array
{
    $response = $test->postJson("/api/v1/fun-games/join/{$session->join_code}", ['name' => $name, 'email' => $email])
        ->assertOk();

    return ['token' => $response->json('data.participantToken'), 'id' => $response->json('data.participantId')];
}

function fgAs($test, string $token)
{
    return $test->withHeader('X-Participant-Token', $token);
}

function fgQuestionIds(FunGame $game): array
{
    return $game->questions()->pluck('id')->all();
}

/** The player's current progress (opens their next question if needed). */
function fgCurrent($test, FunGameSession $session, array $player): array
{
    return fgAs($test, $player['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/current")
        ->assertOk()->json('data.progress');
}

/** Answers (or skips, with null) the given question; returns {ack, progress}. */
function fgAnswer($test, FunGameSession $session, array $player, string $questionId, ?string $optionId): array
{
    return fgAs($test, $player['token'])->postJson("/api/v1/fun-games/sessions/{$session->id}/answers", [
        'questionId' => $questionId,
        'optionId' => $optionId,
    ])->assertOk()->json('data');
}

function fgStart($test, FunGameSession $session): void
{
    Sanctum::actingAs($session->game->user);
    $test->postJson("/api/v1/fun-games/host/sessions/{$session->id}/start")->assertOk();
}

/** Plays every remaining question for a player, answering `$option`, `$step` seconds apart. */
function fgPlayAll($test, FunGameSession $session, array $player, string $option = 'a', int $step = 0): array
{
    $progress = fgCurrent($test, $session, $player);
    while (! $progress['finished']) {
        if ($step) {
            $test->travel($step)->seconds();
        }
        $progress = fgAnswer($test, $session, $player, $progress['question']['id'], $option)['progress'];
    }

    return $progress;
}

// ---------------------------------------------------------------- host setup

it('lets a host create, fill and publish a game, with timer limits enforced', function () {
    Sanctum::actingAs(fgUser());

    $this->postJson('/api/v1/fun-games/host/games', [
        'title' => 'Quick quiz',
        'timer' => ['mode' => 'perQuestion', 'secondsPerQuestion' => 3],
    ])->assertUnprocessable()->assertJsonPath('data.validation_errors', fn ($e) => isset($e['timer.secondsPerQuestion']));

    $this->postJson('/api/v1/fun-games/host/games', [
        'title' => 'Quick quiz',
        'timer' => ['mode' => 'total', 'totalSeconds' => 30],
    ])->assertUnprocessable();

    $gameId = $this->postJson('/api/v1/fun-games/host/games', [
        'title' => 'Quick quiz',
        'timer' => ['mode' => 'total', 'totalSeconds' => 600, 'allowNavigation' => true],
    ])->assertCreated()->assertJsonPath('data.game.status', 'draft')->json('data.game.id');

    $this->postJson("/api/v1/fun-games/host/games/{$gameId}/publish")->assertUnprocessable();

    $this->postJson("/api/v1/fun-games/host/games/{$gameId}/questions", [
        'text' => '2 + 2?',
        'options' => [['id' => 'x', 'text' => '4'], ['id' => 'y', 'text' => '5']],
        'correctOptionId' => 'z',
    ])->assertUnprocessable();

    $this->postJson("/api/v1/fun-games/host/games/{$gameId}/questions", [
        'text' => '2 + 2?',
        'options' => [['id' => 'x', 'text' => '4'], ['id' => 'y', 'text' => '5']],
        'correctOptionId' => 'x',
        'marks' => 2,
    ])->assertCreated()->assertJsonPath('data.question.correctOptionId', 'x');

    // Switching to per-question keeps the total timer's value for later.
    $this->patchJson("/api/v1/fun-games/host/games/{$gameId}", [
        'timer' => ['mode' => 'perQuestion', 'secondsPerQuestion' => 45],
    ])->assertOk()
        ->assertJsonPath('data.game.timer.mode', 'perQuestion')
        ->assertJsonPath('data.game.timerSettings.totalSeconds', 600);

    $this->postJson("/api/v1/fun-games/host/games/{$gameId}/publish")
        ->assertOk()->assertJsonPath('data.game.published', true);
});

it('hides other hosts\' games', function () {
    $game = fgGame(fgUser());
    Sanctum::actingAs(fgUser());

    $this->getJson("/api/v1/fun-games/host/games/{$game->id}")->assertNotFound();
    $this->postJson("/api/v1/fun-games/host/games/{$game->id}/sessions")->assertNotFound();
});

// ---------------------------------------------------------------- joining

it('joins with name and email, no login, and rejoining with the same email resumes the participant', function () {
    $session = fgHostSession($this, fgGame(fgUser()));
    $this->app['auth']->forgetGuards();

    $this->postJson("/api/v1/fun-games/join/{$session->join_code}", ['name' => 'Ayesha'])->assertUnprocessable();
    $this->postJson("/api/v1/fun-games/join/{$session->join_code}", ['name' => 'Ayesha', 'email' => 'not-an-email'])->assertUnprocessable();
    $this->getJson('/api/v1/fun-games/join/GNOPE00')->assertNotFound();

    $first = fgJoin($this, $session, 'Ayesha', 'Ayesha@Example.com');
    $again = fgJoin($this, $session, 'Ayesha R', 'ayesha@example.com');

    expect($again['id'])->toBe($first['id'])
        ->and($again['token'])->not->toBe($first['token'])
        ->and(FunGameParticipant::find($first['id'])->email)->toBe('ayesha@example.com');

    fgAs($this, $again['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/state")
        ->assertOk()
        ->assertJsonPath('data.session.status', 'waiting')
        ->assertJsonPath('data.session.participantName', 'Ayesha R');

    $this->withHeader('X-Participant-Token', 'wrong')
        ->getJson("/api/v1/fun-games/sessions/{$session->id}/state")
        ->assertUnauthorized();
});

// ---------------------------------------------------------------- self-paced play

it('gives each player their own question order and moves on as soon as they answer', function () {
    $game = fgGame(fgUser(), 'per_question', 3);
    $session = fgHostSession($this, $game);
    $ayesha = fgJoin($this, $session, 'Ayesha', 'ayesha@example.com');
    fgStart($this, $session);

    $p = fgCurrent($this, $session, $ayesha);
    expect($p['index'])->toBe(0)
        ->and($p['total'])->toBe(3)
        ->and($p['finished'])->toBeFalse()
        ->and($p['question'])->not->toHaveKey('correctOptionId')
        ->and(strtotime($p['deadline']) - strtotime($p['openedAt']))->toBe(20);
    $first = $p['question']['id'];

    // Answering opens the next question immediately — no waiting for the timer.
    $r = fgAnswer($this, $session, $ayesha, $first, 'b');
    expect($r['ack']['accepted'])->toBeTrue()
        ->and($r['progress']['index'])->toBe(1)
        ->and($r['progress']['question']['id'])->not->toBe($first);

    // The previous question can't be answered again.
    expect(fgAnswer($this, $session, $ayesha, $first, 'a')['ack']['reason'])->toBe('locked');

    // Skip.
    $r = fgAnswer($this, $session, $ayesha, $r['progress']['question']['id'], null);
    expect($r['ack']['accepted'])->toBeTrue()->and($r['progress']['index'])->toBe(2);

    $r = fgAnswer($this, $session, $ayesha, $r['progress']['question']['id'], 'a');
    expect($r['progress']['finished'])->toBeTrue()->and($r['progress']['question'])->toBeNull();

    // Every player's order is a permutation of the game's questions.
    $order = FunGameParticipant::find($ayesha['id'])->question_order;
    expect(collect($order)->sort()->values()->all())->toBe(collect(fgQuestionIds($game))->sort()->values()->all());
});

it('keeps the game order when shuffling is off', function () {
    $game = fgGame(fgUser(), 'per_question', 4, 'marks', shuffle: false);
    $session = fgHostSession($this, $game);
    $p = fgJoin($this, $session, 'Bob', 'bob@example.com');
    fgStart($this, $session);
    fgCurrent($this, $session, $p);

    expect(FunGameParticipant::find($p['id'])->question_order)->toBe(fgQuestionIds($game));
});

it('expires questions on the server: time runs on while the player is away', function () {
    $session = fgHostSession($this, fgGame(fgUser(), 'per_question', 3));
    $p = fgJoin($this, $session, 'Nusrat', 'nusrat@example.com');
    fgStart($this, $session);
    $first = fgCurrent($this, $session, $p)['question']['id'];

    // 45 s later: Q1 (0–20 s) and Q2 (20–40 s) have expired; Q3 opened at 40 s.
    $this->travel(45)->seconds();
    expect(fgAnswer($this, $session, $p, $first, 'a')['ack']['reason'])->toBe('late');
    $now = fgCurrent($this, $session, $p);
    expect($now['index'])->toBe(2)
        ->and(strtotime($now['deadline']) - now()->timestamp)->toBeBetween(14, 15);

    // Q3 expires too: the player is done with nothing answered.
    $this->travel(16)->seconds();
    expect(fgCurrent($this, $session, $p)['finished'])->toBeTrue()
        ->and(FunGameParticipant::find($p['id'])->answers()->count())->toBe(0);
});

it('refuses an answer that arrives after its deadline', function () {
    $session = fgHostSession($this, fgGame(fgUser(), 'per_question', 2));
    $p = fgJoin($this, $session, 'Imran', 'imran@example.com');
    fgStart($this, $session);
    $q = fgCurrent($this, $session, $p)['question']['id'];

    $this->travel(21)->seconds();
    $r = fgAnswer($this, $session, $p, $q, 'a');
    expect($r['ack']['accepted'])->toBeFalse()
        ->and($r['ack']['reason'])->toBe('late')
        ->and($r['progress']['index'])->toBe(1);
});

it('lets new players join only during the first two minutes', function () {
    $session = fgHostSession($this, fgGame(fgUser(), 'total', 2));
    $early = fgJoin($this, $session, 'Early', 'early@example.com');
    fgStart($this, $session);

    $this->travel(60)->seconds();
    fgJoin($this, $session, 'Late but ok', 'ok@example.com');

    $this->travel(61)->seconds();
    $this->postJson("/api/v1/fun-games/join/{$session->join_code}", ['name' => 'Too late', 'email' => 'late@example.com'])
        ->assertStatus(409);
    // Someone who already joined can always come back.
    expect(fgJoin($this, $session, 'Early', 'early@example.com')['id'])->toBe($early['id']);
});

it('ends when everyone has finished after the join window, and publishes the results', function () {
    $session = fgHostSession($this, fgGame(fgUser(), 'per_question', 2));
    $a = fgJoin($this, $session, 'Ayesha', 'ayesha@example.com');
    $b = fgJoin($this, $session, 'Bob', 'bob@example.com');
    fgStart($this, $session);

    fgPlayAll($this, $session, $a, 'a');
    fgPlayAll($this, $session, $b, 'b');
    // Everyone is done, but late players could still join.
    expect($session->refresh()->status)->toBe('live');

    fgAs($this, $a['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/leaderboard")
        ->assertJsonPath('data.leaderboard.status', 'pending');

    $this->travel(121)->seconds();
    $this->artisan('fun-games:tick')->assertSuccessful();
    expect($session->refresh()->status)->toBe('finished');

    fgAs($this, $a['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/results/me")
        ->assertJsonPath('data.result.status', 'final')
        ->assertJsonPath('data.result.marks', 4)
        ->assertJsonPath('data.result.rank', 1);
    fgAs($this, $b['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/results/me")
        ->assertJsonPath('data.result.marks', -1)
        ->assertJsonPath('data.result.incorrect', 2);
});

it('ends at the hard end time even if a player never finishes', function () {
    $session = fgHostSession($this, fgGame(fgUser(), 'total', 3));
    $idle = fgJoin($this, $session, 'Idle', 'idle@example.com');
    fgStart($this, $session);
    fgCurrent($this, $session, $idle);

    // Join window 120 s + total timer 300 s + grace 30 s.
    $this->travel(451)->seconds();
    $this->artisan('fun-games:tick')->assertSuccessful();
    expect($session->refresh()->status)->toBe('finished');

    fgAs($this, $idle['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/results/me")
        ->assertJsonPath('data.result.unanswered', 3)
        ->assertJsonPath('data.result.timeMs', 300000);
});

// ---------------------------------------------------------------- scoring

it('scores speed points per question: faster correct answers earn more', function () {
    $session = fgHostSession($this, fgGame(fgUser(), 'per_question', 2, 'speed'));
    $fast = fgJoin($this, $session, 'Fast', 'fast@example.com');
    $wrong = fgJoin($this, $session, 'Wrong', 'wrong@example.com');
    fgStart($this, $session);

    // 2 marks → up to 2000 points; 20 s limit.  2 s → 1900, 10 s → 1500.
    $q = fgCurrent($this, $session, $fast)['question']['id'];
    $this->travel(2)->seconds();
    $q = fgAnswer($this, $session, $fast, $q, 'a')['progress']['question']['id'];
    $this->travel(10)->seconds();
    fgAnswer($this, $session, $fast, $q, 'a');

    fgPlayAll($this, $session, $wrong, 'b'); // wrong answers: 0, no penalty

    Sanctum::actingAs($session->game->user);
    $live = $this->getJson("/api/v1/fun-games/host/sessions/{$session->id}/leaderboard")->json('data.leaderboard');
    expect($live['status'])->toBe('live')
        ->and($live['entries'][0]['name'])->toBe('Fast')
        ->and($live['entries'][0]['score'])->toEqual(3400)
        ->and($live['entries'][0]['progress'])->toMatchArray(['done' => 2, 'total' => 2, 'finished' => true]);

    $this->postJson("/api/v1/fun-games/host/sessions/{$session->id}/end")->assertOk();
    $board = fgAs($this, $wrong['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/leaderboard")
        ->json('data.leaderboard');
    expect($board['scoringMode'])->toBe('speed')
        ->and(collect($board['entries'])->map(fn ($e) => [$e['name'], $e['score']])->all())
        ->toEqual([['Fast', 3400], ['Wrong', 0]]);
    fgAs($this, $fast['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/results/me")
        ->assertJsonPath('data.result.maxMarks', 4000)
        ->assertJsonPath('data.result.answerSheet.0.points', 1900);
});

it('scores speed points on the total timer by the time taken for the whole quiz', function () {
    $session = fgHostSession($this, fgGame(fgUser(), 'total', 3, 'speed'));
    $quick = fgJoin($this, $session, 'Quick', 'quick@example.com');
    $slow = fgJoin($this, $session, 'Slow', 'slow@example.com');
    fgStart($this, $session);

    // 3 × 2 marks correct = 6000 base; 300 s timer.
    fgPlayAll($this, $session, $quick, 'a', 20);  // 60 s  → 6000 × (1 − 60/600)  = 5400
    fgPlayAll($this, $session, $slow, 'a', 50);   // 150 s → 6000 × (1 − 150/600) = 4500

    // Both finished after the join window closed, so the game ended by itself.
    expect($session->refresh()->status)->toBe('finished');
    $board = fgAs($this, $quick['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/leaderboard")
        ->json('data.leaderboard.entries');
    expect(collect($board)->map(fn ($e) => [$e['name'], $e['score'], $e['timeMs']])->all())
        ->toEqual([['Quick', 5400, 60000], ['Slow', 4500, 150000]]);
});

it('breaks ties on marks by the time taken', function () {
    $session = fgHostSession($this, fgGame(fgUser(), 'total', 2));
    $slow = fgJoin($this, $session, 'Slow', 'slow@example.com');
    $fast = fgJoin($this, $session, 'Fast', 'fast@example.com');
    fgStart($this, $session);

    fgPlayAll($this, $session, $slow, 'a', 30);
    fgPlayAll($this, $session, $fast, 'a', 5);

    Sanctum::actingAs($session->game->user);
    $this->postJson("/api/v1/fun-games/host/sessions/{$session->id}/end")->assertOk();
    $board = fgAs($this, $fast['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/leaderboard")
        ->json('data.leaderboard.entries');
    expect(collect($board)->map(fn ($e) => [$e['rank'], $e['name'], $e['score']])->all())
        ->toEqual([[1, 'Fast', 4], [2, 'Slow', 4]]);
});

it('lets the host end early; unfinished players keep what they answered', function () {
    $session = fgHostSession($this, fgGame(fgUser(), 'total', 3));
    $p = fgJoin($this, $session, 'Mid', 'mid@example.com');
    fgStart($this, $session);
    $q = fgCurrent($this, $session, $p)['question']['id'];
    fgAnswer($this, $session, $p, $q, 'a');

    Sanctum::actingAs($session->game->user);
    $this->postJson("/api/v1/fun-games/host/sessions/{$session->id}/end")->assertOk();
    expect($session->refresh()->status)->toBe('finished')->and($session->ended_by_host)->toBeTrue();
    $this->postJson("/api/v1/fun-games/host/sessions/{$session->id}/end")->assertStatus(409);

    fgAs($this, $p['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/results/me")
        ->assertJsonPath('data.result.correct', 1)
        ->assertJsonPath('data.result.unanswered', 2);
    $this->postJson("/api/v1/fun-games/join/{$session->join_code}", ['name' => 'After', 'email' => 'after@example.com'])
        ->assertStatus(409);
});

it('never sends more than the current question, and no answers', function () {
    $session = fgHostSession($this, fgGame(fgUser(), 'total', 3));
    $p = fgJoin($this, $session, 'Peek', 'peek@example.com');
    fgStart($this, $session);

    $state = fgAs($this, $p['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/state")->assertOk()->json('data');
    $current = fgCurrent($this, $session, $p);
    expect(json_encode($state))->not->toContain('correctOptionId')
        ->and(json_encode($current))->not->toContain('correctOptionId')
        ->and($current)->toHaveKey('question');
    fgAs($this, $p['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/questions")->assertNotFound();
});

it('blocks question and timer edits while a session is running', function () {
    $game = fgGame(fgUser(), 'per_question', 2);
    $session = fgHostSession($this, $game);
    Sanctum::actingAs($game->user);
    $this->postJson("/api/v1/fun-games/host/sessions/{$session->id}/start")->assertOk();

    $this->patchJson("/api/v1/fun-games/host/games/{$game->id}", ['timer' => ['mode' => 'total', 'totalSeconds' => 600]])
        ->assertStatus(409);
    $this->deleteJson("/api/v1/fun-games/host/games/{$game->id}/questions/" . fgQuestionIds($game)[0])
        ->assertStatus(409);
    $this->patchJson("/api/v1/fun-games/host/games/{$game->id}", ['title' => 'Renamed'])->assertOk();
});

it('writes the session lifecycle to the fungames log', function () {
    $game = fgGame(fgUser(), 'per_question', 1);
    $session = fgHostSession($this, $game);
    fgJoin($this, $session, 'Sadia', 'sadia@example.com');
    Sanctum::actingAs($game->user);
    $this->postJson("/api/v1/fun-games/host/sessions/{$session->id}/start")->assertOk();
    $this->postJson("/api/v1/fun-games/host/sessions/{$session->id}/end")->assertOk();

    $log = file_get_contents($this->logFile);
    foreach (['session.created', 'participant.joined', 'session.started', 'session.ended_by_host', 'participant.finished', 'session.finished'] as $event) {
        expect($log)->toContain($event);
    }
    expect($log)->not->toContain('sadia@example.com');
});

// ---------------------------------------------------------------- question pool

it('gives every player the same N questions drawn from the pool', function () {
    $game = fgGame(fgUser(), 'per_question', 10, 'marks', shuffle: false);
    $game->update(['questions_per_player' => 3, 'question_selection' => 'same']);
    $session = fgHostSession($this, $game);
    $a = fgJoin($this, $session, 'Ayesha', 'ayesha@example.com');
    $b = fgJoin($this, $session, 'Bob', 'bob@example.com');
    fgStart($this, $session);

    expect(fgCurrent($this, $session, $a)['total'])->toBe(3);
    fgCurrent($this, $session, $b);
    $orderA = FunGameParticipant::find($a['id'])->question_order;
    $orderB = FunGameParticipant::find($b['id'])->question_order;
    expect($orderA)->toHaveCount(3)
        ->and($orderB)->toBe($orderA)
        ->and(array_diff($orderA, fgQuestionIds($game)))->toBe([]);

    fgAs($this, $a['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/state")
        ->assertJsonPath('data.session.quiz.questionCount', 3)
        ->assertJsonPath('data.session.quiz.poolSize', 10);
    $this->getJson("/api/v1/fun-games/join/{$session->join_code}")->assertJsonPath('data.game.questionCount', 3);

    // Results count only this player's 3 questions.
    fgPlayAll($this, $session, $a, 'a');
    Sanctum::actingAs($game->user);
    $this->postJson("/api/v1/fun-games/host/sessions/{$session->id}/end")->assertOk();
    fgAs($this, $b['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/results/me")
        ->assertJsonPath('data.result.unanswered', 3)
        ->assertJsonPath('data.result.maxMarks', 6);
    fgAs($this, $a['token'])->getJson("/api/v1/fun-games/sessions/{$session->id}/results/me")
        ->assertJsonPath('data.result.marks', 6)
        ->assertJsonPath('data.result.unanswered', 0);
});

it('gives each player their own random N questions, kept when they rejoin', function () {
    $game = fgGame(fgUser(), 'total', 10);
    $game->update(['questions_per_player' => 3, 'question_selection' => 'different']);
    $session = fgHostSession($this, $game);
    $players = collect(range(1, 8))->map(fn ($i) => fgJoin($this, $session, "P{$i}", "p{$i}@example.com"));
    fgStart($this, $session);

    $sets = $players->map(function ($p) use ($session) {
        fgCurrent($this, $session, $p);
        $order = FunGameParticipant::find($p['id'])->question_order;
        sort($order);

        return implode(',', $order);
    });
    expect($sets->every(fn ($set) => count(explode(',', $set)) === 3))->toBeTrue()
        ->and($sets->unique()->count())->toBeGreaterThan(1);

    // Rejoining (e.g. another device) keeps the same questions and the current one.
    $first = $players->first();
    $before = fgCurrent($this, $session, $first)['question']['id'];
    $again = fgJoin($this, $session, 'P1', 'p1@example.com');
    expect(fgCurrent($this, $session, $again)['question']['id'])->toBe($before);
});

it('sizes the hard end for the slowest questions a player could draw', function () {
    $game = fgGame(fgUser(), 'per_question', 5);
    $game->update(['questions_per_player' => 2, 'question_selection' => 'different']);
    $game->questions()->first()->update(['seconds_override' => 60]);
    $session = fgHostSession($this, $game);
    fgStart($this, $session);

    $session->refresh();
    // Join window 120 s + slowest two questions (60 + 20) + grace 30 s.
    expect((int) $session->started_at->diffInSeconds($session->ends_at))->toBe(230);
});

it('validates questions per player', function () {
    $game = fgGame(fgUser(), 'total', 3);
    $game->update(['status' => FunGame::STATUS_DRAFT]);
    Sanctum::actingAs($game->user);

    $this->patchJson("/api/v1/fun-games/host/games/{$game->id}", ['questionsPerPlayer' => 0])->assertUnprocessable();
    $this->patchJson("/api/v1/fun-games/host/games/{$game->id}", ['questionSelection' => 'some'])->assertUnprocessable();
    $this->patchJson("/api/v1/fun-games/host/games/{$game->id}", ['questionsPerPlayer' => 5, 'questionSelection' => 'different'])
        ->assertOk()
        ->assertJsonPath('data.game.questionsPerPlayer', 5)
        ->assertJsonPath('data.game.questionSelection', 'different');
    $this->postJson("/api/v1/fun-games/host/games/{$game->id}/publish")
        ->assertUnprocessable()
        ->assertJsonPath('data.issues.0', 'Each player should answer 5 questions, but the game has only 3.');
    $this->patchJson("/api/v1/fun-games/host/games/{$game->id}", ['questionsPerPlayer' => null])->assertOk();
    $this->postJson("/api/v1/fun-games/host/games/{$game->id}/publish")->assertOk();
});
