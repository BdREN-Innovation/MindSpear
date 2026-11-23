<?php

use App\Deck\Legacy\LegacyDeckImport;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;

require_once __DIR__ . '/Quiz/QuizApiHelpers.php';

/*
 * My Library > a quiz > its sessions (GET /quizzes/{deck}/sessions) and one
 * session's results (GET /quiz-sessions/{session}/results, .../export).
 */

uses(DatabaseTransactions::class);

beforeEach(function () {
    qapiSetUp();
    $this->freezeTime();
});

/** Host: next slide, start voting, wait out Get ready. Returns the run id. */
function sresOpen(User $host, int $sessionId): int
{
    $moved = qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk()->json('data');
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    test()->travel(5)->seconds();
    qapiHostState($host, $sessionId)->assertOk();

    return (int) $moved['current_run']['id'];
}

/** A quiz with one Pick answer slide (Paris correct, Lyon wrong) and an ended session three people played. */
function sresPlayedQuiz(User $host): array
{
    $deck = qapiCreateQuiz($host, 'Capitals');
    $slide = qapiAppend($host, $deck['id'], 'pick_answer_single');
    qapiPatchSlide($host, $deck['id'], $slide['id'], ['title' => 'Capital of France?', 'speed_bonus_enabled' => false])->assertOk();
    qapiPatchOption($host, $deck['id'], $slide['id'], $slide['options'][0]['id'], ['label' => 'Paris', 'is_correct' => true])->assertOk();
    qapiPatchOption($host, $deck['id'], $slide['id'], $slide['options'][1]['id'], ['label' => 'Lyon', 'is_correct' => false])->assertOk();

    $state = qapiStart($host, $deck['id']);
    $sessionId = $state['session_id'];
    [$ada, $grace, $linus] = qapiJoin($state);

    $run = sresOpen($host, $sessionId);
    $options = collect(qapiState($sessionId, $ada['token'])->json('data.current_slide_run.options'))->keyBy('label');
    qapiSubmit($sessionId, $run, $ada['token'], ['option_id' => $options['Paris']['id']])->assertNoContent();
    qapiSubmit($sessionId, $run, $grace['token'], ['option_id' => $options['Lyon']['id']])->assertNoContent();
    // Linus closes the tab without answering: still listed, last.
    DB::table('deck_participants')->where('id', $linus['id'])->update(['left_at' => now()]);
    qapiAdvance($host, $sessionId, ['action' => 'reveal'])->assertOk();

    qapiAsHost($host);
    test()->postJson(QAPI_SESSIONS . "/{$sessionId}/end")->assertOk();

    return ['deck' => $deck, 'session_id' => $sessionId, 'people' => [$ada, $grace, $linus]];
}

it('lists a quiz\'s sessions, newest first, with counts', function () {
    $host = qapiOwner();
    $played = sresPlayedQuiz($host);
    $deckId = $played['deck']['id'];
    $second = qapiStart($host, $deckId)['session_id'];

    qapiAsHost($host);
    $data = $this->getJson(QAPI_AUTHOR . "/{$deckId}/sessions")->assertOk()->json('data');

    expect($data['deck']['title'])->toBe('Capitals')
        ->and(array_column($data['sessions'], 'id'))->toBe([$second, $played['session_id']])
        ->and($data['sessions'][0]['status'])->toBe('live')
        ->and($data['sessions'][1])->toMatchArray(['status' => 'ended', 'participant_count' => 3, 'answer_count' => 2])
        ->and($data['legacy'])->toBe([]);
});

it('returns a session\'s results: every answered slide with its final aggregate, and everyone ranked', function () {
    $host = qapiOwner();
    $played = sresPlayedQuiz($host);
    [$ada, $grace, $linus] = $played['people'];

    qapiAsHost($host);
    $data = $this->getJson(QAPI_SESSIONS . "/{$played['session_id']}/results")->assertOk()->json('data');

    expect($data['scored'])->toBeTrue()
        ->and($data['session'])->toMatchArray(['deck_title' => 'Capitals', 'status' => 'ended', 'product' => 'quiz'])
        // The QR slide takes no answers, so only the question is listed.
        ->and($data['runs'])->toHaveCount(1)
        ->and($data['runs'][0])->toMatchArray(['type' => 'pick_answer_single', 'state' => 'reveal'])
        ->and($data['runs'][0]['aggregate']['total_responses'])->toBe(2)
        ->and(array_column($data['participants'], 'display_name'))->toBe(['Ada', 'Grace', 'Linus'])
        ->and($data['participants'][0])->toMatchArray(['rank' => 1, 'answered' => 1, 'correct' => 1, 'left' => false])
        ->and($data['participants'][0]['total_points'])->toBeGreaterThan(0)
        ->and($data['participants'][1])->toMatchArray(['rank' => 2, 'answered' => 1, 'correct' => 0, 'total_points' => 0])
        ->and($data['participants'][2])->toMatchArray(['rank' => 2, 'answered' => 0, 'left' => true]);
});

it('exports the results as CSV with each answer as text', function () {
    $host = qapiOwner();
    $played = sresPlayedQuiz($host);

    qapiAsHost($host);
    $response = $this->get(QAPI_SESSIONS . "/{$played['session_id']}/results/export")->assertOk();
    expect($response->headers->get('content-type'))->toContain('text/csv');

    $lines = array_map('str_getcsv', explode("\n", trim(ltrim($response->streamedContent(), "\xEF\xBB\xBF"))));
    expect($lines[0])->toBe(['Rank', 'Name', 'Points', 'Correct', 'Answered', 'Joined', 'Q1: Capital of France?'])
        ->and($lines[1][1])->toBe('Ada')->and($lines[1][6])->toBe('Paris ✓')
        ->and($lines[2][1])->toBe('Grace')->and($lines[2][6])->toBe('Lyon ✗')
        ->and($lines[3][1])->toBe('Linus')->and($lines[3][6])->toBe('');
});

it('includes the sessions of the previous version\'s quiz the deck was converted from', function () {
    $host = qapiOwner();
    $deck = qapiCreateQuiz($host, 'Converted');

    $quizId = DB::table('quizes')->insertGetId([
        'user_id' => $host->id, 'title' => 'Old quiz', 'visibility' => 'private', 'created_at' => now(), 'updated_at' => now(),
    ]);
    $sessionId = DB::table('quiz_sessions')->insertGetId([
        'quiz_id' => $quizId, 'session_id' => 'old-1', 'start_datetime' => now()->subDay(), 'end_datetime' => now()->subDay()->addHour(),
        'created_at' => now(), 'updated_at' => now(),
    ]);
    DB::table('quiz_participants')->insert([
        'quiz_id' => $quizId, 'quiz_session_id' => $sessionId, 'is_anonymous' => true,
        'anonymous_details' => json_encode(['name' => 'Old player', 'email' => null]), 'start_time' => now(), 'score' => 0,
        'created_at' => now(), 'updated_at' => now(),
    ]);
    LegacyDeckImport::create(['source_type' => 'quiz', 'source_id' => $quizId, 'deck_id' => $deck['id']]);

    qapiAsHost($host);
    $legacy = $this->getJson(QAPI_AUTHOR . "/{$deck['id']}/sessions")->assertOk()->json('data.legacy');

    expect($legacy)->toHaveCount(1)
        ->and($legacy[0])->toMatchArray(['source' => 'quiz', 'id' => $quizId, 'title' => 'Old quiz'])
        ->and($legacy[0]['sessions'][0])->toMatchArray(['id' => (string) $sessionId, 'participants' => 1]);
});

it('hides sessions and results from everyone but the host', function () {
    $host = qapiOwner();
    $played = sresPlayedQuiz($host);

    qapiAsHost(qapiOwner());
    $this->getJson(QAPI_AUTHOR . "/{$played['deck']['id']}/sessions")->assertNotFound();
    $this->getJson(QAPI_SESSIONS . "/{$played['session_id']}/results")->assertNotFound();
    $this->get(QAPI_SESSIONS . "/{$played['session_id']}/results/export")->assertNotFound();
    // A quiz session is not reachable under the quest prefix.
    qapiAsHost($host);
    $this->getJson("/api/v1/quest-sessions/{$played['session_id']}/results")->assertNotFound();

    qapiAsGuest();
    $this->getJson(QAPI_SESSIONS . "/{$played['session_id']}/results")->assertUnauthorized();
});
