<?php

use App\Events\Live\LiveBroadcastEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;

require_once __DIR__ . '/QuizApiHelpers.php';

/*
 * True or false, Fill in the blanks and Drag and drop through the HTTP API:
 * author them, host a session, three participants answer from what their
 * phones show, reveal, and check points and the answer key.
 */

uses(DatabaseTransactions::class);

beforeEach(function () {
    qapiSetUp();
    $this->freezeTime();
});

/** The participant's current run as their phone sees it (no answer key before the reveal). */
function qntRun(int $sessionId, string $token): array
{
    $run = qapiState($sessionId, $token)->assertOk()->json('data.current_slide_run');
    if ($run['state'] !== 'reveal') {
        qapiAssertNoSecrets($run, 'participant run');
    }

    return $run;
}

/** Host: next slide, start it, wait out Get ready; returns the run id. */
function qntOpen(User $host, int $sessionId, string $type): int
{
    $moved = qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk()->json('data');
    expect($moved['current_run']['type'])->toBe($type);
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    test()->travel(5)->seconds();
    qapiHostState($host, $sessionId)->assertOk()->assertJsonPath('data.current_run.state', 'voting');

    return (int) $moved['current_run']['id'];
}

/** points_delta per participant id from the run's slide.revealed. */
function qntDeltas(int $runId): array
{
    $revealed = qapiEvents('slide.revealed')->first(fn (LiveBroadcastEvent $e) => $e->broadcastWith()['slide_run_id'] === $runId)->broadcastWith();

    return collect($revealed['leaderboard_delta'])->mapWithKeys(fn ($row) => [$row['participant_id'] => $row['points_delta']])->all();
}

it('authors the new quiz types and refuses options on sentence slides', function () {
    $host = qapiOwner();
    $deck = qapiCreateQuiz($host);

    $tf = qapiAppend($host, $deck['id'], 'true_false');
    expect(array_column($tf['options'], 'label'))->toBe(['True', 'False'])
        ->and(array_column($tf['options'], 'isCorrect'))->toBe([null, null]);
    $this->postJson(QAPI_AUTHOR . "/{$deck['id']}/slides/{$tf['id']}/options", ['label' => 'Maybe'])->assertStatus(422);

    $fill = qapiAppend($host, $deck['id'], 'fill_blanks');
    expect($fill['config'])->toBe(['text' => '', 'blanks' => [], 'case_sensitive' => false])->and($fill['options'])->toBe([]);
    $this->postJson(QAPI_AUTHOR . "/{$deck['id']}/slides/{$fill['id']}/options", ['label' => 'x'])->assertStatus(422);
    qapiPatchSlide($host, $deck['id'], $fill['id'], ['config' => ['text' => str_repeat('[a] ', 11)]])
        ->assertStatus(422)->assertJsonValidationErrors(['config.text'], 'data.validation_errors');
    qapiPatchSlide($host, $deck['id'], $fill['id'], ['config' => ['text' => 'Paris is in [France].', 'blanks' => [['mode' => 'dropdown', 'distractors' => ['Spain']]]]])
        ->assertOk()->assertJsonPath('data.slide.config.blanks.0.distractors', ['Spain']);

    $drag = qapiAppend($host, $deck['id'], 'drag_drop');
    expect($drag['config'])->toBe(['text' => '', 'distractors' => []]);

    // The retired multi-answer type is created as a Pick answer.
    $this->postJson(QAPI_AUTHOR . "/{$deck['id']}/slides", ['type' => 'pick_answer_multi'])->assertCreated()->assertJsonPath('data.slide.type', 'pick_answer_single');
    $this->postJson('/api/v1/quests/v2', ['title' => 'Q'])->assertCreated();
});

it('hosts true or false, fill in the blanks and drag and drop end to end', function () {
    $host = qapiOwner();
    $deck = qapiCreateQuiz($host, 'New types');
    $deckId = $deck['id'];

    $tf = qapiAppend($host, $deckId, 'true_false');
    qapiPatchSlide($host, $deckId, $tf['id'], ['title' => 'Octopuses have three hearts.', 'speed_bonus_enabled' => false])->assertOk();
    qapiPatchOption($host, $deckId, $tf['id'], $tf['options'][0]['id'], ['is_correct' => true])->assertOk();

    $fill = qapiAppend($host, $deckId, 'fill_blanks');
    qapiPatchSlide($host, $deckId, $fill['id'], ['speed_bonus_enabled' => false, 'config' => [
        'text' => 'The first person on the Moon was Neil [Armstrong] in [1969].',
        'blanks' => [['mode' => 'type', 'alternatives' => ['Neil Armstrong']], ['mode' => 'dropdown', 'distractors' => ['1959', '1979']]],
    ]])->assertOk();

    $drag = qapiAppend($host, $deckId, 'drag_drop');
    qapiPatchSlide($host, $deckId, $drag['id'], ['speed_bonus_enabled' => false, 'config' => [
        'text' => 'The sun rises in the [east] and sets in the [west].', 'distractors' => ['north'],
    ]])->assertOk();

    $state = qapiStart($host, $deckId);
    $sessionId = $state['session_id'];
    qapiAssertNoSecrets($state['runs'], 'host runs list');
    [$p0, $p1, $p2] = qapiJoin($state);

    // --- true or false: one right, one wrong, one silent; the host reveals --------------------
    $run = qntOpen($host, $sessionId, 'true_false');
    $view = qntRun($sessionId, $p0['token']);
    expect($view['config']['multiple_answers'])->toBeFalse();
    $options = collect($view['options'])->keyBy('label');
    qapiSubmit($sessionId, $run, $p0['token'], ['option_id' => $options['True']['id']])->assertNoContent();
    qapiSubmit($sessionId, $run, $p1['token'], ['option_id' => $options['False']['id']])->assertNoContent();
    qapiAdvance($host, $sessionId, ['action' => 'reveal'])->assertOk();
    expect(qntDeltas($run))->toBe([$p0['id'] => 100, $p1['id'] => 0, $p2['id'] => 0]);

    // --- fill in the blanks ------------------------------------------------------------------
    $run = qntOpen($host, $sessionId, 'fill_blanks');
    $view = qntRun($sessionId, $p1['token']);
    expect($view['options'])->toBe([])
        ->and($view['config']['parts'])->toBe([['text' => 'The first person on the Moon was Neil '], ['blank' => 0], ['text' => ' in '], ['blank' => 1], ['text' => '.']])
        ->and($view['config']['blanks'][0])->toBe(['mode' => 'type'])
        ->and($view['config']['blanks'][1]['choices'])->toEqualCanonicalizing(['1969', '1959', '1979']);
    qapiSubmit($sessionId, $run, $p0['token'], ['answers' => [' armstrong', '1969']])->assertNoContent();
    qapiSubmit($sessionId, $run, $p1['token'], ['answers' => ['Aldrin', '1969']])->assertNoContent();
    qapiSubmit($sessionId, $run, $p2['token'], ['answers' => ['Armstrong', '2001']])->assertStatus(422);
    qapiSubmit($sessionId, $run, $p2['token'], ['answers' => [null, '1959']])->assertNoContent();
    // Everyone answered: it reveals by itself.
    expect(qntRun($sessionId, $p0['token'])['state'])->toBe('reveal')
        ->and(qntDeltas($run))->toBe([$p0['id'] => 100, $p1['id'] => 50, $p2['id'] => 0]);
    qapiMyAnswer($sessionId, $run, $p1['token'])->assertOk()
        ->assertJsonPath('data.is_correct', false)
        ->assertJsonPath('data.correct_answer.blanks.0.answers', ['Armstrong', 'Neil Armstrong']);

    // --- drag and drop -----------------------------------------------------------------------
    $run = qntOpen($host, $sessionId, 'drag_drop');
    $view = qntRun($sessionId, $p2['token']);
    expect(array_column($view['options'], 'label'))->toEqualCanonicalizing(['east', 'west', 'north'])
        ->and($view['config']['blanks'])->toBe([['mode' => 'drop'], ['mode' => 'drop']]);
    qapiSubmit($sessionId, $run, $p0['token'], ['answers' => ['east', 'west']])->assertNoContent();
    qapiSubmit($sessionId, $run, $p1['token'], ['answers' => ['west', 'east']])->assertNoContent();
    qapiSubmit($sessionId, $run, $p2['token'], ['answers' => ['east', 'east']])->assertStatus(422);
    qapiSubmit($sessionId, $run, $p2['token'], ['answers' => ['east', 'north']])->assertNoContent();
    expect(qntDeltas($run))->toBe([$p0['id'] => 100, $p1['id'] => 0, $p2['id'] => 50]);
    $revealed = qapiEvents('slide.revealed')->first(fn (LiveBroadcastEvent $e) => $e->broadcastWith()['slide_run_id'] === $run)->broadcastWith();
    expect($revealed['aggregate']['blanks'])->toBe([
        ['correct_count' => 2, 'correct_percentage' => 66.67],
        ['correct_count' => 1, 'correct_percentage' => 33.33],
    ])->and($revealed['aggregate']['correct'])->toBe(['blanks' => [['answers' => ['east']], ['answers' => ['west']]]]);

    qapiLeaderboard($sessionId, host: $host)->assertOk()
        ->assertJsonPath('data.leaderboard.0.participant_id', $p0['id'])
        ->assertJsonPath('data.leaderboard.0.total_points', 300);
});
