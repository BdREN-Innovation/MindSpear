<?php

use App\Deck\Slides\SlideTypeRegistry;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Arr;

require_once __DIR__ . '/QuizApiHelpers.php';

/*
 * Quiz v2 Phase 2 exit test (QUIZ_REDESIGN_PLAN.md §2 exit criteria), through
 * the HTTP API only and on PostgreSQL: create a quiz, append every quiz type,
 * edit, reorder, start a session, three participants answer, reveal (all
 * answered / host / timer), leaderboard updates, next slide, spinner, end,
 * review. Every id comes from an API response, like a client gets it;
 * participants build their answers from what their own state shows them.
 */

uses(DatabaseTransactions::class);

beforeEach(function () {
    qapiSetUp();
    $this->freezeTime();
});

/** The participant's current run, as their phone sees it (and never with an answer key before the reveal). */
function qe2eRun(int $sessionId, string $token): array
{
    $state = qapiState($sessionId, $token)->assertOk()->json('data');

    if (($state['current_slide_run']['state'] ?? null) !== 'reveal') {
        qapiAssertNoSecrets($state['current_slide_run'], 'participant run');
        expect($state['aggregate'])->toBeNull();
    }

    return $state['current_slide_run'];
}

/** @return array<string, array> the run's participant options by label */
function qe2eByLabel(array $run): array
{
    return collect($run['options'])->keyBy('label')->all();
}

/** Host: next slide, start it, wait out the 5 s Get ready (the state read applies the timer). */
function qe2eOpen(User $host, int $sessionId, string $type): int
{
    $moved = qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk()->json('data');
    expect($moved['current_run']['type'])->toBe($type)->and($moved['current_run']['state'])->toBe('waiting');

    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk()
        ->assertJsonPath('data.current_run.state', 'get_ready')
        ->assertJsonPath('data.duration_seconds', 5);
    test()->travel(5)->seconds();
    qapiHostState($host, $sessionId)->assertOk()->assertJsonPath('data.current_run.state', 'voting');

    return (int) $moved['current_run']['id'];
}

function qe2eRevealed(int $runId): array
{
    $events = qapiEvents('slide.revealed')->filter(fn (LiveBroadcastEvent $e) => $e->broadcastWith()['slide_run_id'] === $runId);
    expect($events)->toHaveCount(1);

    return $events->first()->broadcastWith();
}

/** points_delta per participant id from a slide.revealed. */
function qe2eDeltas(array $revealed): array
{
    return collect($revealed['leaderboard_delta'])->mapWithKeys(fn ($row) => [$row['participant_id'] => $row['points_delta']])->all();
}

it('covers every quiz slide type the registry offers', function () {
    $quizOnly = collect(app(SlideTypeRegistry::class)->forProduct('quiz'))
        ->filter(fn ($type) => $type->products() === ['quiz'])
        ->keys()->sort()->values()->all();

    expect($quizOnly)->toBe(QAPI_QUIZ_TYPES);
});

it('authors, hosts and plays a whole quiz through the API', function () {
    $host = qapiOwner();

    // --- author ---------------------------------------------------------------------
    $deck = qapiCreateQuiz($host, 'General knowledge');
    $deckId = $deck['id'];
    $qr = $deck['slides'][0]['id'];

    $slides = [];
    foreach (['pick_answer_single', 'pick_answer_multi', 'short_answer', 'match_pairs', 'correct_order', 'categorise', 'spinner_wheel', 'leaderboard'] as $type) {
        // pick_answer_multi is retired: a second Pick answer, given two correct options below, plays its part.
        $slides[$type] = qapiAppend($host, $deckId, $type === 'pick_answer_multi' ? 'pick_answer_single' : $type);
    }

    $label = function (string $type, array $labels, array $extra = []) use ($host, $deckId, &$slides) {
        foreach ($labels as $i => $text) {
            $optionId = $slides[$type]['options'][$i]['id'] ?? null;
            if ($optionId === null) {
                qapiAsHost($host);
                test()->postJson(QAPI_AUTHOR . "/{$deckId}/slides/{$slides[$type]['id']}/options", ['label' => $text] + ($extra[$i] ?? []))->assertCreated();

                continue;
            }

            qapiPatchOption($host, $deckId, $slides[$type]['id'], $optionId, ['label' => $text] + ($extra[$i] ?? []))->assertOk();
        }
    };

    // Speed bonus off everywhere: points are the slide's points_max times the credit.
    foreach (QAPI_SCORED_TYPES as $type) {
        qapiPatchSlide($host, $deckId, $slides[$type]['id'], ['title' => "Q: {$type}", 'speed_bonus_enabled' => false])->assertOk();
    }
    qapiPatchSlide($host, $deckId, $slides['pick_answer_single']['id'], ['points_min' => 100, 'points_max' => 200])
        ->assertOk()->assertJsonPath('data.slide.pointsMax', 200);

    $label('pick_answer_single', ['Paris', 'Lyon'], [['is_correct' => true], ['is_correct' => false]]);
    $label('pick_answer_multi', ['Two', 'Three', 'Four'], [['is_correct' => true], ['is_correct' => true]]);
    $label('short_answer', ['Jupiter']);
    $label('match_pairs', ['Cat', 'Meow', 'Dog', 'Woof', 'Cow', 'Moo']);
    $label('correct_order', ['First', 'Second', 'Third', 'Fourth']);
    qapiPatchSlide($host, $deckId, $slides['categorise']['id'], ['config' => ['categories' => [['key' => 'c1', 'label' => 'Fruit'], ['key' => 'c2', 'label' => 'Veg']]]])
        ->assertOk()->assertJsonPath('data.slide.config.categories.1.label', 'Veg');
    $label('categorise', ['Apple', 'Pear', 'Leek', 'Kale']);
    $label('spinner_wheel', ['Ada', 'Grace', 'Linus', 'Edsger']);
    qapiPatchSlide($host, $deckId, $slides['leaderboard']['id'], ['config' => ['top_n' => 3]])->assertOk();

    // A second leaderboard, then the order: leaderboard after the first three questions and at the end.
    qapiAsHost($host);
    $closing = test()->postJson(QAPI_AUTHOR . "/{$deckId}/slides/{$slides['leaderboard']['id']}/duplicate")->assertCreated()->json('data.slide');
    $order = [$qr, $slides['pick_answer_single']['id'], $slides['pick_answer_multi']['id'], $slides['short_answer']['id'], $slides['leaderboard']['id'],
        $slides['match_pairs']['id'], $slides['correct_order']['id'], $slides['categorise']['id'], $slides['spinner_wheel']['id'], $closing['id']];
    test()->postJson(QAPI_AUTHOR . "/{$deckId}/slides/reorder", ['slides' => array_map(fn ($id, $i) => ['id' => $id, 'position' => $i + 1], $order, array_keys($order))])
        ->assertOk();

    $authored = test()->getJson(QAPI_AUTHOR . "/{$deckId}")->assertOk()->json('data.deck');
    expect(array_column($authored['slides'], 'id'))->toBe($order)
        ->and(array_column($authored['slides'], 'type'))->toBe(['qr_code', 'pick_answer_single', 'pick_answer_single', 'short_answer', 'leaderboard',
            'match_pairs', 'correct_order', 'categorise', 'spinner_wheel', 'leaderboard'])
        ->and($authored['slides'][1]['options'][0]['isCorrect'])->toBeTrue();

    // --- host + join ------------------------------------------------------------------
    $state = qapiStart($host, $deckId);
    $sessionId = $state['session_id'];
    expect($state['session']['total_slides'])->toBe(10)
        ->and($state['current_run']['type'])->toBe('qr_code')
        ->and($state['channels'])->toBe(['public' => "session.quiz.{$state['public_channel_key']}", 'host' => "host.quiz.v2.{$sessionId}"]);
    qapiAssertNoSecrets($state['runs'], 'host runs list');

    [$p0, $p1, $p2] = $people = qapiJoin($state);
    qapiHostState($host, $sessionId)->assertOk()->assertJsonPath('data.participant_count', 3);

    // --- 1. pick_answer_single: everyone answers → it reveals by itself ---------------------
    $run = qe2eOpen($host, $sessionId, 'pick_answer_single');
    $view = qe2eRun($sessionId, $p0['token']);
    expect($view['config']['scoring'])->toMatchArray(['points_min' => 100, 'points_max' => 200, 'speed_bonus_enabled' => false]);
    $o = qe2eByLabel($view);
    qapiSubmit($sessionId, $run, $p0['token'], ['option_id' => $o['Paris']['id']])->assertNoContent();
    qapiSubmit($sessionId, $run, $p1['token'], ['option_id' => $o['Paris']['id']])->assertNoContent();
    qapiMyAnswer($sessionId, $run, $p0['token'])->assertOk()->assertJsonMissingPath('data.is_correct');
    qapiSubmit($sessionId, $run, $p2['token'], ['option_id' => $o['Lyon']['id']])->assertNoContent();

    $revealed = qe2eRevealed($run);
    expect($revealed['aggregate']['correct'])->toBe(['option_ids' => [$o['Paris']['id']]])
        ->and($revealed['aggregate']['correct_responses'])->toBe(2)
        ->and(qe2eDeltas($revealed))->toBe([$p0['id'] => 200, $p1['id'] => 200, $p2['id'] => 0]);
    qapiMyAnswer($sessionId, $run, $p2['token'])->assertOk()
        ->assertJsonPath('data.is_correct', false)->assertJsonPath('data.points_awarded', 0)->assertJsonPath('data.rank', 3);

    // --- 2. Pick answer with two correct (made as pick_answer_multi): two answer, the host reveals (all or nothing: a subset scores 0) -
    $run = qe2eOpen($host, $sessionId, 'pick_answer_single');
    expect(qe2eRun($sessionId, $p0['token'])['config']['multiple_answers'])->toBeTrue();
    $o = qe2eByLabel(qe2eRun($sessionId, $p1['token']));
    qapiSubmit($sessionId, $run, $p0['token'], ['option_ids' => [$o['Two']['id'], $o['Three']['id']]])->assertNoContent();
    qapiSubmit($sessionId, $run, $p1['token'], ['option_ids' => [$o['Two']['id']]])->assertNoContent();
    qapiHostState($host, $sessionId)->assertOk()->assertJsonPath('data.current_run.state', 'voting')->assertJsonPath('data.quiz.submitted_count', 2);
    qapiAdvance($host, $sessionId, ['action' => 'reveal'])->assertOk()->assertJsonPath('data.current_run.state', 'reveal');
    expect(qe2eDeltas(qe2eRevealed($run)))->toBe([$p0['id'] => 100, $p1['id'] => 0, $p2['id'] => 0]);
    qapiMyAnswer($sessionId, $run, $p1['token'])->assertOk()->assertJsonPath('data.is_correct', false)->assertJsonPath('data.points_awarded', 0);

    // --- 3. short_answer: two answer, the time limit reveals it --------------------------------
    $run = qe2eOpen($host, $sessionId, 'short_answer');
    expect(qe2eRun($sessionId, $p2['token'])['options'])->toBe([]);
    qapiSubmit($sessionId, $run, $p0['token'], ['text' => '  jupiter '])->assertNoContent();
    qapiSubmit($sessionId, $run, $p2['token'], ['text' => 'JUPITER'])->assertNoContent();
    test()->travel(31)->seconds();
    expect(qe2eRun($sessionId, $p1['token'])['state'])->toBe('reveal');
    $revealed = qe2eRevealed($run);
    expect($revealed['aggregate']['correct']['accepted_answers'])->toBe(['Jupiter'])
        ->and(qe2eDeltas($revealed))->toBe([$p0['id'] => 100, $p1['id'] => 0, $p2['id'] => 100]);

    // --- 4. leaderboard -----------------------------------------------------------------------
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk()->assertJsonPath('data.current_run.type', 'leaderboard');
    $board = qapiEvents('leaderboard.updated')->sole()->broadcastWith();
    expect(array_map(fn ($row) => Arr::only($row, ['rank', 'participant_id', 'display_name', 'total_points', 'points_delta']), $board['leaderboard']))->toBe([
        ['rank' => 1, 'participant_id' => $p0['id'], 'display_name' => 'Ada', 'total_points' => 400, 'points_delta' => 100],
        ['rank' => 2, 'participant_id' => $p1['id'], 'display_name' => 'Grace', 'total_points' => 200, 'points_delta' => 0],
        ['rank' => 3, 'participant_id' => $p2['id'], 'display_name' => 'Linus', 'total_points' => 100, 'points_delta' => 100],
    ])->and($board['top_n'])->toBe(3);
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertConflict();
    qapiLeaderboard($sessionId, $p2['token'])->assertOk()->assertJsonPath('data.me.rank', 3)->assertJsonPath('data.me.total_points', 100);

    // --- 5. match_pairs (opaque ids; the right column is shuffled) -------------------------------
    $run = qe2eOpen($host, $sessionId, 'match_pairs');
    $o = qe2eByLabel(qe2eRun($sessionId, $p0['token']));
    expect($o['Cat']['payload'])->toBe(['side' => 'left'])->and($o['Cat']['id'])->toBeString();
    $pair = fn (string $left, string $right) => ['left_id' => $o[$left]['id'], 'right_id' => $o[$right]['id']];
    qapiSubmit($sessionId, $run, $p0['token'], ['pairs' => [$pair('Cat', 'Meow'), $pair('Dog', 'Woof'), $pair('Cow', 'Moo')]])->assertNoContent();
    qapiSubmit($sessionId, $run, $p1['token'], ['pairs' => [$pair('Cat', 'Meow'), $pair('Dog', 'Moo'), $pair('Cow', 'Woof')]])->assertNoContent();
    qapiSubmit($sessionId, $run, $p2['token'], ['pairs' => [$pair('Cat', 'Woof')]])->assertNoContent();
    $revealed = qe2eRevealed($run);
    expect($revealed['aggregate']['correct']['pairs'])->toHaveCount(3)
        ->and(qe2eDeltas($revealed))->toBe([$p0['id'] => 100, $p1['id'] => 33, $p2['id'] => 0]);

    // --- 6. correct_order --------------------------------------------------------------------
    $run = qe2eOpen($host, $sessionId, 'correct_order');
    $o = qe2eByLabel(qe2eRun($sessionId, $p1['token']));
    $ids = fn (string ...$labels) => array_map(fn ($l) => $o[$l]['id'], $labels);
    qapiSubmit($sessionId, $run, $p0['token'], ['order' => $ids('First', 'Second', 'Third', 'Fourth')])->assertNoContent();
    qapiSubmit($sessionId, $run, $p1['token'], ['order' => $ids('First', 'Second', 'Fourth', 'Third')])->assertNoContent();
    qapiSubmit($sessionId, $run, $p2['token'], ['order' => $ids('Fourth', 'Third', 'Second', 'First')])->assertNoContent();
    $revealed = qe2eRevealed($run);
    expect($revealed['aggregate']['correct']['order'])->toBe($ids('First', 'Second', 'Third', 'Fourth'))
        ->and(qe2eDeltas($revealed))->toBe([$p0['id'] => 100, $p1['id'] => 50, $p2['id'] => 0]);

    // --- 7. categorise -----------------------------------------------------------------------
    $run = qe2eOpen($host, $sessionId, 'categorise');
    $view = qe2eRun($sessionId, $p2['token']);
    expect(array_column($view['config']['categories'], 'label'))->toBe(['Fruit', 'Veg']);
    $o = qe2eByLabel($view);
    $place = fn (array $map) => ['placements' => array_map(fn ($l, $c) => ['item_id' => $o[$l]['id'], 'category_key' => $c], array_keys($map), $map)];
    qapiSubmit($sessionId, $run, $p0['token'], $place(['Apple' => 'c1', 'Pear' => 'c1', 'Leek' => 'c2', 'Kale' => 'c2']))->assertNoContent();
    qapiSubmit($sessionId, $run, $p1['token'], $place(['Apple' => 'c1', 'Pear' => 'c1', 'Leek' => 'c2', 'Kale' => 'c1']))->assertNoContent();
    qapiSubmit($sessionId, $run, $p2['token'], $place(['Apple' => 'c2', 'Pear' => 'c2', 'Leek' => 'c1', 'Kale' => 'c1']))->assertNoContent();
    expect(qe2eDeltas(qe2eRevealed($run)))->toBe([$p0['id'] => 100, $p1['id'] => 75, $p2['id'] => 0]);
    qapiMyAnswer($sessionId, $run, $p1['token'])->assertOk()
        ->assertJsonPath('data.points_awarded', 75)
        ->assertJsonPath('data.total_points', 358)
        ->assertJsonPath('data.rank', 2)
        ->assertJsonPath('data.correct_answer.categories.0.key', 'c1');

    // --- 8. spinner_wheel -------------------------------------------------------------------
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk()->assertJsonPath('data.current_run.type', 'spinner_wheel');
    $spinRun = qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk()->json('data.current_run.id');
    $spin = qapiEvents('spin.started')->sole()->broadcastWith();
    expect($spin['slide_run_id'])->toBe($spinRun);
    test()->travel(3)->seconds();
    expect(qe2eRun($sessionId, $p0['token'])['state'])->toBe('reveal')
        ->and(qe2eRevealed($spinRun)['spin']['option_id'])->toBe($spin['option_id']);

    // --- 9. closing leaderboard, then end ----------------------------------------------------------
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk()->assertJsonPath('data.current_run.type', 'leaderboard');
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertConflict();
    $final = qapiEvents('leaderboard.updated')->last()->broadcastWith();
    expect(array_map(fn ($row) => [$row['participant_id'], $row['rank'], $row['total_points'], $row['points_delta']], $final['leaderboard']))->toBe([
        [$p0['id'], 1, 700, 100],
        [$p1['id'], 2, 358, 75],
        [$p2['id'], 3, 100, 0],
    ]);
    qapiLeaderboard($sessionId, host: $host)->assertOk()->assertJsonPath('data.leaderboard.0.total_points', 700);

    qapiAsHost($host);
    test()->postJson(QAPI_SESSIONS . "/{$sessionId}/end")->assertOk()->assertJsonPath('data.session.status', 'ended');

    qapiAsGuest();
    $review = test()->getJson(QAPI_SESSIONS . "/{$sessionId}/review", qapiHeaders($p1['token']))->assertOk()->json('data');
    $answered = collect($review['runs'])->filter(fn ($r) => $r['my_answer'] !== null);
    expect($answered->pluck('type')->all())->toBe(['pick_answer_single', 'pick_answer_single', 'match_pairs', 'correct_order', 'categorise'])
        ->and($answered->sum(fn ($r) => $r['my_answer']['points_awarded']))->toBe(358)
        ->and(collect($review['runs'])->where('accepts_answers', true)->pluck('state')->unique()->values()->all())->toBe(['reveal']);

    // --- across the whole session --------------------------------------------------------------
    $public = qapiEvents()->reject(fn (LiveBroadcastEvent $e) => $e->isPrivate());
    expect($public->filter(fn ($e) => $e->broadcastAs() === 'slide.aggregate.updated'))->toHaveCount(0)
        ->and($public->filter(fn ($e) => $e->broadcastAs() === 'slide.closed'))->toHaveCount(0)
        ->and(qapiEvents('slide.revealed'))->toHaveCount(7)
        // One per accepted answer: 3 + 2 + 2 + 3 + 3 + 3.
        ->and(qapiEvents('slide.submitted_count.updated')->count())->toBe(16);

    // Nothing public before a reveal names a correct answer.
    foreach ($public->reject(fn ($e) => in_array($e->broadcastAs(), ['slide.revealed', 'leaderboard.updated'], true)) as $event) {
        qapiAssertNoSecrets($event->broadcastWith(), $event->broadcastAs());
    }

    // Host-only events stayed on the private host channel.
    $hostChannel = "private-host.quiz.v2.{$sessionId}";
    expect(qapiEvents()->filter(fn ($e) => $e->isPrivate())->map(fn ($e) => $e->broadcastOn()->name)->unique()->values()->all())->toBe([$hostChannel])
        ->and(qapiEvents()->filter(fn ($e) => $e->isPrivate())->map(fn ($e) => $e->broadcastAs())->unique()->sort()->values()->all())
        ->toBe(['answer.submitted', 'participant.joined', 'slide.aggregate.updated']);

    expect($people)->toHaveCount(3);
});
