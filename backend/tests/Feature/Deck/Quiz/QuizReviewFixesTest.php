<?php

use App\Deck\Participants\ParticipantReadAccess;
use App\Deck\Slides\SlideTypeRegistry;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use App\Models\User;
use App\Deck\Participants\ParticipantTokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Arr;

require_once __DIR__ . '/QuizApiHelpers.php';

/*
 * Regression tests for the quiz review fixes (QUIZ_REDESIGN_PLAN.md
 * "Review fixes"), through the HTTP API: the score oracle (answers final,
 * totals only at the reveal), options hidden until voting, per-participant
 * orders, leave / same-device rejoin / active-only counts, participant_count
 * in the participant state and the insert_leaderboard action. The first two
 * started as the review's probes (scratchpad qrev/QrevProbe*Test.php).
 */

uses(DatabaseTransactions::class);

beforeEach(function () {
    qapiSetUp();
    $this->freezeTime();
});

/** A quiz deck: spec [type, columns + options (label strings or attribute arrays) + config?]. */
function qfixDeck(User $owner, array $slides): Deck
{
    $deck = Deck::factory()->quiz()->ownedBy($owner)->create(['title' => 'Fix quiz']);
    $registry = app(SlideTypeRegistry::class);

    foreach ($slides as [$type, $attributes]) {
        $slide = Slide::factory()->ofType($type, $attributes['config'] ?? $registry->for($type)->defaultConfig())
            ->create(['deck_id' => $deck->id] + Arr::except($attributes, ['config', 'options']));

        foreach ($attributes['options'] ?? [] as $index => $option) {
            SlideOption::factory()->create(['slide_id' => $slide->id, 'position' => $index + 1, 'payload' => []]
                + (is_array($option) ? $option : ['label' => $option]));
        }
    }

    return $deck;
}

/** pick_answer_single, Paris correct, untimed Get ready, fixed points. */
function qfixPick(array $columns = []): array
{
    return ['pick_answer_single', $columns + [
        'title' => 'Capital of France?',
        'time_limit_seconds' => 20,
        'get_ready_seconds' => 0,
        'points_min' => 100,
        'points_max' => 200,
        'speed_bonus_enabled' => false,
        'options' => [['label' => 'Paris', 'is_correct' => true], ['label' => 'Lyon', 'is_correct' => false], ['label' => 'Nice']],
    ]];
}

function qfixRun(int $sessionId, int $position): DeckSessionSlideRun
{
    return DeckSessionSlideRun::query()->where('deck_session_id', $sessionId)->where('position_snapshot', $position)->firstOrFail();
}

/** @return array<string, int> */
function qfixIds(DeckSessionSlideRun $run): array
{
    return collect($run->options_snapshot)->mapWithKeys(fn (array $o) => [$o['label'] => (int) $o['id']])->all();
}

function qfixPublic(int $from = 0): array
{
    return qapiEvents()->slice($from)->reject(fn (LiveBroadcastEvent $e) => $e->isPrivate())->map(fn ($e) => $e->broadcastAs())->values()->all();
}

function qfixLeave(int $sessionId, ?string $token, string $prefix = QAPI_SESSIONS)
{
    qapiAsGuest();

    return test()->postJson("{$prefix}/{$sessionId}/participants/leave", [], $token ? qapiHeaders($token) : ['Accept' => 'application/json']);
}

function qfixJoin(array $hostState, string $name, ?string $token = null, string $prefix = QAPI_SESSIONS, string $emoji = '🦊')
{
    qapiAsGuest();

    return test()->postJson("{$prefix}/{$hostState['session_id']}/participants/join", [
        'join_code' => $hostState['join_code'],
        'display_name' => $name,
        'emoji_avatar' => $emoji,
    ], $token ? qapiHeaders($token) : ['Accept' => 'application/json']);
}

/** The leaderboard rows a participant reads, reduced to [id, total, rank]. */
function qfixBoard(int $sessionId, string $token): array
{
    return array_map(
        fn (array $row) => [$row['participant_id'], $row['total_points'], $row['rank']],
        qapiLeaderboard($sessionId, $token)->assertOk()->json('data.leaderboard'),
    );
}

// --- 1. the score oracle ---------------------------------------------------------------

it('never moves standing or the leaderboard while a run takes answers, only at the reveal', function () {
    $host = qapiOwner();
    $deck = qfixDeck($host, [qfixPick()]);
    $state = qapiStart($host, $deck->id);
    $sessionId = $state['session_id'];
    [$ada, $grace, $linus] = qapiJoin($state);
    $run = qfixRun($sessionId, 1);
    $ids = qfixIds($run);
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();

    $standingBefore = qapiState($sessionId, $ada['token'])->json('data.standing');
    $boardBefore = qfixBoard($sessionId, $grace['token']);
    $meBefore = qapiLeaderboard($sessionId, $ada['token'])->json('data.me');
    $hostBoardBefore = qapiLeaderboard($sessionId, host: $host)->json('data.leaderboard');

    // A correct answer: nothing anyone can read during voting changes.
    qapiSubmit($sessionId, $run->id, $ada['token'], ['option_id' => $ids['Paris']])->assertNoContent();
    expect(DeckParticipantAnswer::query()->where('deck_participant_id', $ada['id'])->value('points_awarded'))->toBe(200)
        ->and(DeckParticipant::find($ada['id'])->total_points)->toBe(0)
        ->and(qapiState($sessionId, $ada['token'])->json('data.standing'))->toBe($standingBefore)
        ->and(qfixBoard($sessionId, $grace['token']))->toBe($boardBefore)
        ->and(qapiLeaderboard($sessionId, $ada['token'])->json('data.me'))->toBe($meBefore)
        ->and(qapiLeaderboard($sessionId, host: $host)->json('data.leaderboard'))->toBe($hostBoardBefore)
        ->and(array_keys(qapiMyAnswer($sessionId, $run->id, $ada['token'])->json('data')))
        ->toBe(['slide_run_id', 'answer_payload', 'time_to_answer_ms', 'submitted_at']);

    // Brute force: trying the other options is refused and changes nothing.
    foreach (['Lyon', 'Nice', 'Paris'] as $label) {
        $this->travel(1)->seconds();
        qapiSubmit($sessionId, $run->id, $ada['token'], ['option_id' => $ids[$label]])
            ->assertConflict()->assertJsonPath('data.code', 'invalid_state')->assertJsonPath('data.reason', 'already_answered');
    }
    qapiSubmit($sessionId, $run->id, $grace['token'], ['option_id' => $ids['Lyon']])->assertNoContent();
    expect(qapiState($sessionId, $ada['token'])->json('data.standing'))->toBe($standingBefore)
        ->and(qfixBoard($sessionId, $linus['token']))->toBe($boardBefore)
        ->and($run->fresh()->state)->toBe('voting');

    // The reveal adds the points, once, and only then do standing and the leaderboard move.
    qapiAdvance($host, $sessionId, ['action' => 'reveal'])->assertOk();
    expect(DeckParticipant::find($ada['id'])->total_points)->toBe(200)
        ->and(qapiState($sessionId, $ada['token'])->json('data.standing'))
        ->toBe(['participant_id' => $ada['id'], 'total_points' => 200, 'rank' => 1, 'points_delta' => 200])
        ->and(qfixBoard($sessionId, $grace['token']))->toBe([[$ada['id'], 200, 1], [$grace['id'], 0, 2], [$linus['id'], 0, 2]])
        ->and(collect(qapiEvents('slide.revealed')->last()->broadcastWith()['leaderboard_delta'])->firstWhere('participant_id', $ada['id']))
        ->toBe(['participant_id' => $ada['id'], 'points_delta' => 200, 'new_total' => 200, 'new_rank' => 1]);
    qapiMyAnswer($sessionId, $run->id, $ada['token'])->assertOk()
        ->assertJsonPath('data.points_awarded', 200)->assertJsonPath('data.total_points', 200)->assertJsonPath('data.rank', 1);

    // Reads after the reveal never add the points again.
    qapiHostState($host, $sessionId)->assertOk();
    expect(DeckParticipant::find($ada['id'])->total_points)->toBe(200);
});

it('ranks everyone in the room as tied before the first reveal, so a reloaded phone shows its rank', function () {
    $host = qapiOwner();
    $deck = qfixDeck($host, [qfixPick()]);
    $state = qapiStart($host, $deck->id);
    $sessionId = $state['session_id'];
    [$ada, $grace] = qapiJoin($state);

    expect(qapiState($sessionId, $ada['token'])->json('data.standing'))
        ->toMatchArray(['total_points' => 0, 'rank' => 1])
        ->and(qapiState($sessionId, $grace['token'])->json('data.standing.rank'))->toBe(1);

    // Someone who left is not ranked.
    qfixLeave($sessionId, $grace['token'])->assertNoContent();
    expect(qapiState($sessionId, $grace['token'])->json('data.standing.rank'))->toBeNull();
});

it('keeps the first answer final on every scored type, at its own time and score', function () {
    $host = qapiOwner();
    $deck = qfixDeck($host, [
        qfixPick(['speed_bonus_enabled' => true]),
        ['pick_answer_multi', ['time_limit_seconds' => 20, 'get_ready_seconds' => 0, 'points_min' => 50, 'points_max' => 100, 'speed_bonus_enabled' => false,
            'options' => [['label' => 'A', 'is_correct' => true], ['label' => 'B', 'is_correct' => true], ['label' => 'C', 'is_correct' => false]]]],
        ['correct_order', ['time_limit_seconds' => 30, 'get_ready_seconds' => 0, 'speed_bonus_enabled' => false, 'options' => ['First', 'Second', 'Third']]],
    ]);
    $state = qapiStart($host, $deck->id);
    $sessionId = $state['session_id'];
    [$ada, $grace, $linus] = qapiJoin($state);

    // pick single with the speed bonus: 5 s → 175; a resubmit at 15 s is refused, not re-scored.
    $run = qfixRun($sessionId, 1);
    $ids = qfixIds($run);
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    $this->travel(5)->seconds();
    qapiSubmit($sessionId, $run->id, $ada['token'], ['option_id' => $ids['Paris']])->assertNoContent();
    $this->travel(10)->seconds();
    qapiSubmit($sessionId, $run->id, $ada['token'], ['option_id' => $ids['Paris']])->assertConflict()->assertJsonPath('data.reason', 'already_answered');
    $answer = DeckParticipantAnswer::query()->where('slide_run_id', $run->id)->where('deck_participant_id', $ada['id'])->firstOrFail();
    expect($answer->points_awarded)->toBe(175)->and($answer->time_to_answer_ms)->toBe(5000);

    // Within the 1 s grace after the deadline still counts; past it is time_up.
    $this->travel(5500)->milliseconds();
    qapiSubmit($sessionId, $run->id, $grace['token'], ['option_id' => $ids['Paris']])->assertNoContent();
    $this->travel(1000)->milliseconds();
    qapiSubmit($sessionId, $run->id, $linus['token'], ['option_id' => $ids['Paris']])->assertConflict()->assertJsonPath('data.reason', 'time_up');
    qapiHostState($host, $sessionId)->assertOk()->assertJsonPath('data.current_run.state', 'reveal');
    expect(DeckParticipant::find($ada['id'])->total_points)->toBe(175);

    // pick multi, all or nothing: a subset scores 0 and cannot be completed afterwards.
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk();
    $run = qfixRun($sessionId, 2);
    $ids = qfixIds($run);
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    qapiSubmit($sessionId, $run->id, $ada['token'], ['option_ids' => [$ids['A']]])->assertNoContent();
    qapiSubmit($sessionId, $run->id, $ada['token'], ['option_ids' => [$ids['A'], $ids['B']]])->assertConflict()->assertJsonPath('data.reason', 'already_answered');
    qapiSubmit($sessionId, $run->id, $grace['token'], ['option_ids' => [$ids['A'], $ids['B'], $ids['C']]])->assertNoContent();
    qapiSubmit($sessionId, $run->id, $linus['token'], ['option_ids' => [$ids['B'], $ids['A']]])->assertNoContent();
    expect(DeckParticipantAnswer::query()->where('slide_run_id', $run->id)->orderBy('deck_participant_id')->pluck('points_awarded')->all())->toBe([0, 0, 100])
        ->and($run->fresh()->state)->toBe('reveal')
        ->and(DeckParticipant::find($linus['id'])->total_points)->toBe(100);

    // correct_order (opaque keys): a wrong first order cannot be "climbed" to the right one.
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk();
    $run = qfixRun($sessionId, 3);
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    $keys = collect(qapiState($sessionId, $ada['token'])->json('data.current_slide_run.options'))->pluck('id', 'label');
    $order = fn (string ...$labels) => ['order' => array_map(fn ($l) => $keys[$l], $labels)];
    qapiSubmit($sessionId, $run->id, $ada['token'], $order('Third', 'Second', 'First'))->assertNoContent();
    qapiSubmit($sessionId, $run->id, $ada['token'], $order('First', 'Second', 'Third'))->assertConflict()->assertJsonPath('data.reason', 'already_answered');
    expect(DeckParticipantAnswer::query()->where('slide_run_id', $run->id)->value('points_awarded'))->toBe(33)
        ->and(DeckParticipantAnswer::query()->where('slide_run_id', $run->id)->value('answer_payload'))->toBe($order('Third', 'Second', 'First'));

    // Ending the session reveals the run and adds its points too.
    qapiAsHost($host);
    $this->postJson(QAPI_SESSIONS . "/{$sessionId}/end")->assertOk();
    expect($run->fresh()->state)->toBe('reveal')
        ->and(DeckParticipant::find($ada['id'])->total_points)->toBe(175 + 0 + 33);
});

it('still replaces a Quest re-submission (Quest is unchanged)', function () {
    $host = qapiOwner();
    $deck = Deck::factory()->ownedBy($host)->create();
    $slide = Slide::factory()->ofType('poll_single', app(SlideTypeRegistry::class)->for('poll_single')->defaultConfig())->create(['deck_id' => $deck->id]);
    $yes = SlideOption::factory()->create(['slide_id' => $slide->id, 'label' => 'Yes']);
    $no = SlideOption::factory()->create(['slide_id' => $slide->id, 'label' => 'No']);
    qapiAsHost($host);
    $state = $this->postJson("/api/v1/quests/{$deck->id}/sessions")->assertCreated()->json('data');
    $sessionId = $state['session_id'];
    $this->postJson("/api/v1/quest-sessions/{$sessionId}/advance", ['action' => 'start_voting'])->assertOk();
    $token = qfixJoin($state, 'Ada', null, '/api/v1/quest-sessions')->assertCreated()->json('data.participant_token');
    $run = qfixRun($sessionId, 1);

    foreach ([$yes, $no] as $option) {
        $this->postJson("/api/v1/quest-sessions/{$sessionId}/slide-runs/{$run->id}/answers", ['answer_payload' => ['option_id' => $option->id]], qapiHeaders($token))
            ->assertNoContent();
    }
    expect(DeckParticipantAnswer::query()->where('slide_run_id', $run->id)->sole()->answer_payload)->toBe(['option_id' => $no->id]);
});

// --- 2. options hidden until voting, per-participant orders ----------------------------

it('hides quiz options from phones until voting opens, never from the presenter', function () {
    $host = qapiOwner();
    $deck = qfixDeck($host, [['heading', []], qfixPick(['get_ready_seconds' => 5])]);
    $state = qapiStart($host, $deck->id);
    $sessionId = $state['session_id'];
    [$ada] = qapiJoin($state, ['Ada']);

    // Waiting: slide.changed and the phone's state carry the question without options.
    $before = qapiEvents('slide.changed')->count();
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk()
        ->assertJsonPath('data.current_run.options_hidden', false)
        ->assertJsonCount(3, 'data.current_run.options');
    expect(qapiEvents('slide.changed'))->toHaveCount($before + 1);
    $changed = qapiEvents('slide.changed')->last()->broadcastWith()['slide'];
    expect($changed['options'])->toBe([])->and($changed['options_hidden'])->toBeTrue()->and($changed['title'])->toBe('Capital of France?');

    $phone = qapiState($sessionId, $ada['token'])->json('data.current_slide_run');
    expect($phone['options'])->toBe([])->and($phone['options_hidden'])->toBeTrue()->and($phone['title'])->toBe('Capital of France?')
        ->and($phone['config']['scoring']['points_max'])->toBe(200);

    // The host's run list keeps every run's options.
    $hostState = qapiHostState($host, $sessionId)->json('data');
    expect($hostState['runs'][1]['options'])->toHaveCount(3)->and($hostState['runs'][1]['options_hidden'])->toBeFalse();

    // Get ready: still hidden on phones; the presenter has them.
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk()
        ->assertJsonPath('data.current_run.state', 'get_ready')->assertJsonCount(3, 'data.current_run.options');
    expect(qapiState($sessionId, $ada['token'])->json('data.current_slide_run.options'))->toBe([]);

    // Voting: the phone re-reads its state and gets the options.
    $this->travel(5)->seconds();
    $phone = qapiState($sessionId, $ada['token'])->json('data.current_slide_run');
    expect($phone['state'])->toBe('voting')->and($phone['options_hidden'])->toBeFalse()
        ->and(array_column($phone['options'], 'label'))->toBe(['Paris', 'Lyon', 'Nice']);
    qapiAssertNoSecrets($phone, 'participant run');
});

it('serves every phone its own keyed order of the same opaque keys', function () {
    $host = qapiOwner();
    $labels = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
    $deck = qfixDeck($host, [['correct_order', ['time_limit_seconds' => 30, 'get_ready_seconds' => 0, 'options' => $labels]]]);
    $state = qapiStart($host, $deck->id);
    $sessionId = $state['session_id'];
    $people = qapiJoin($state, ['Ada', 'Grace', 'Linus', 'Alan']);
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();

    $orders = [];
    foreach ($people as $person) {
        $options = qapiState($sessionId, $person['token'])->json('data.current_slide_run.options');
        expect(qapiState($sessionId, $person['token'])->json('data.current_slide_run.options'))->toBe($options);
        $orders[$person['id']] = array_column($options, 'id');
    }

    $keys = array_values($orders)[0];
    foreach ($orders as $order) {
        expect($order)->toEqualCanonicalizing($keys);
    }
    expect(count(array_unique(array_map('implode', $orders))))->toBeGreaterThan(1);

    // Each phone answers with what it sees; keys are per run, not per phone.
    $run = qfixRun($sessionId, 1);
    $byLabel = collect(qapiState($sessionId, $people[0]['token'])->json('data.current_slide_run.options'))->pluck('id', 'label');
    qapiSubmit($sessionId, $run->id, $people[1]['token'], ['order' => array_map(fn ($l) => $byLabel[$l], $labels)])->assertNoContent();
    expect(DeckParticipantAnswer::query()->where('slide_run_id', $run->id)->value('points_awarded'))->toBeGreaterThan(0);
});

// --- 3. leaving, rejoining, active-only counts --------------------------------------------

it('lets a participant leave so the rest of the room reveals the run without them', function () {
    $host = qapiOwner();
    $deck = qfixDeck($host, [qfixPick(), qfixPick()]);
    $state = qapiStart($host, $deck->id);
    $sessionId = $state['session_id'];
    [$ada, $grace, $linus] = qapiJoin($state);
    $run = qfixRun($sessionId, 1);
    $ids = qfixIds($run);
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();

    qapiSubmit($sessionId, $run->id, $ada['token'], ['option_id' => $ids['Paris']])->assertNoContent();
    qapiSubmit($sessionId, $run->id, $grace['token'], ['option_id' => $ids['Lyon']])->assertNoContent();
    expect($run->fresh()->state)->toBe('voting')
        ->and(qapiState($sessionId, $ada['token'])->json('data.quiz.participant_count'))->toBe(3);

    qfixLeave($sessionId, null)->assertUnauthorized();
    qfixLeave($sessionId, 'not-a-token')->assertUnauthorized();

    $from = qapiEvents()->count();
    qfixLeave($sessionId, $linus['token'])->assertNoContent();
    expect(DeckParticipant::find($linus['id'])->left_at)->not->toBeNull()
        ->and($run->fresh()->state)->toBe('reveal')
        ->and(qfixPublic($from))->toBe(['participant.count.updated', 'slide.state.changed', 'slide.revealed'])
        ->and(qapiEvents('participant.count.updated')->last()->broadcastWith()['participant_count'])->toBe(2);

    // Leaving twice changes nothing.
    $from = qapiEvents()->count();
    qfixLeave($sessionId, $linus['token'])->assertNoContent();
    expect(qfixPublic($from))->toBe([]);

    // Counts and leaderboards only see the room.
    qapiHostState($host, $sessionId)->assertOk()->assertJsonPath('data.participant_count', 2);
    expect(qapiState($sessionId, $ada['token'])->json('data.quiz.participant_count'))->toBe(2)
        ->and(array_column(qapiLeaderboard($sessionId, $ada['token'])->json('data.leaderboard'), 'participant_id'))->toBe([$ada['id'], $grace['id']])
        ->and(qapiLeaderboard($sessionId, $ada['token'])->json('data.participant_count'))->toBe(2);

    // submitted_count ("x / y answered") counts the room only.
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk();
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    $second = qfixRun($sessionId, 2);
    $ids = qfixIds($second);
    qapiSubmit($sessionId, $second->id, $linus['token'], ['option_id' => $ids['Paris']])->assertNoContent();
    // ...but an answer means they are back.
    expect(DeckParticipant::find($linus['id'])->left_at)->toBeNull()
        ->and(qapiState($sessionId, $ada['token'])->json('data.quiz'))->toMatchArray(['submitted_count' => 1, 'participant_count' => 3]);
    qfixLeave($sessionId, $linus['token'])->assertNoContent();
    expect(qapiState($sessionId, $ada['token'])->json('data.quiz'))->toMatchArray(['submitted_count' => 0, 'participant_count' => 2]);
    qapiHostState($host, $sessionId)->assertOk()->assertJsonPath('data.quiz.submitted_count', 0);
});

it('accepts the leave token in the body for navigator.sendBeacon', function () {
    $host = qapiOwner();
    $state = qapiStart($host, qfixDeck($host, [qfixPick()])->id);
    [$ada] = qapiJoin($state, ['Ada']);

    qapiAsGuest();
    $this->post(QAPI_SESSIONS . "/{$state['session_id']}/participants/leave", ['participant_token' => $ada['token']])->assertNoContent();
    expect(DeckParticipant::find($ada['id'])->left_at)->not->toBeNull();

    $this->post(QAPI_SESSIONS . "/{$state['session_id']}/participants/leave", ['participant_token' => 'nope'], ['Accept' => 'application/json'])->assertUnauthorized();
});

it('brings the same participant back when the same device joins again with its token', function () {
    $host = qapiOwner();
    $deck = qfixDeck($host, [qfixPick()]);
    $state = qapiStart($host, $deck->id);
    $sessionId = $state['session_id'];
    [$ada, $grace] = qapiJoin($state, ['Ada', 'Grace']);
    $run = qfixRun($sessionId, 1);
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    qapiSubmit($sessionId, $run->id, $ada['token'], ['option_id' => qfixIds($run)['Paris']])->assertNoContent();
    qapiAdvance($host, $sessionId, ['action' => 'reveal'])->assertOk();
    qfixLeave($sessionId, $ada['token'])->assertNoContent();

    // Rejoin: same row, same token, points kept, left_at cleared; the stored name wins.
    $from = qapiEvents()->count();
    $rejoined = qfixJoin($state, 'Someone Else', $ada['token'])->assertOk()->json('data');
    expect($rejoined)->toMatchArray([
        'participant_id' => $ada['id'],
        'participant_token' => $ada['token'],
        'session_id' => $sessionId,
        'display_name' => 'Ada',
        'rejoined' => true,
    ])
        ->and(DeckParticipant::query()->where('deck_session_id', $sessionId)->count())->toBe(2)
        ->and(DeckParticipant::find($ada['id'])->left_at)->toBeNull()
        ->and(DeckParticipant::find($ada['id'])->total_points)->toBe(200)
        ->and(qfixPublic($from))->toBe(['participant.count.updated'])
        ->and(qapiEvents('participant.joined')->slice($from))->toHaveCount(0);
    qapiState($sessionId, $ada['token'])->assertOk()->assertJsonPath('data.participant.id', $ada['id'])
        ->assertJsonPath('data.standing.total_points', 200)->assertJsonPath('data.standing.rank', 1);

    // A reload that never left: still the same participant, nothing broadcast.
    $from = qapiEvents()->count();
    qfixJoin($state, 'Grace', $grace['token'])->assertOk()->assertJsonPath('data.participant_id', $grace['id'])->assertJsonPath('data.rejoined', true);
    expect(qfixPublic($from))->toBe([]);

    // Another session's token, or a revoked one, is just a new join.
    $other = qapiStart($host, qfixDeck($host, [qfixPick()])->id);
    [$stranger] = qapiJoin($other, ['Stranger']);
    $new = qfixJoin($state, 'Stranger', $stranger['token'])->assertCreated()->json('data');
    expect($new['participant_id'])->not->toBe($stranger['id'])->and($new['rejoined'])->toBeFalse()
        ->and($new['participant_token'])->not->toBe($stranger['token']);

    app(ParticipantTokenService::class)->revokeParticipant(DeckParticipant::find($grace['id']));
    qfixJoin($state, 'Grace', $grace['token'])->assertCreated()->assertJsonPath('data.rejoined', false);
    expect(DeckParticipant::query()->where('deck_session_id', $sessionId)->count())->toBe(4);

    // The join code is still checked on a rejoin.
    qfixJoin(['session_id' => $sessionId, 'join_code' => 'WRONG1'], 'Ada', $ada['token'])->assertNotFound();
});

it('leaves and rejoins on Quest routes too', function () {
    $host = qapiOwner();
    $deck = Deck::factory()->ownedBy($host)->create();
    Slide::factory()->ofType('poll_single', app(SlideTypeRegistry::class)->for('poll_single')->defaultConfig())->create(['deck_id' => $deck->id]);
    qapiAsHost($host);
    $state = $this->postJson("/api/v1/quests/{$deck->id}/sessions")->assertCreated()->json('data');
    $quest = '/api/v1/quest-sessions';
    $joined = qfixJoin($state, 'Ada', null, $quest)->assertCreated()->assertJsonPath('data.rejoined', false)->json('data');

    qfixLeave($state['session_id'], $joined['participant_token'], $quest)->assertNoContent();
    qapiAsHost($host);
    $this->getJson("{$quest}/{$state['session_id']}/state")->assertOk()->assertJsonPath('data.participant_count', 0);

    qfixJoin($state, 'Ada', $joined['participant_token'], $quest)->assertOk()
        ->assertJsonPath('data.participant_id', $joined['participant_id'])->assertJsonPath('data.rejoined', true);
    qapiAsHost($host);
    $this->getJson("{$quest}/{$state['session_id']}/state")->assertOk()->assertJsonPath('data.participant_count', 1);

    // The quiz route does not serve a Quest session.
    qfixLeave($state['session_id'], $joined['participant_token'])->assertNotFound();
});

it('throttles leave like the other token routes and sizes the shared per-IP cap for a 500-phone room', function () {
    $routes = app('router')->getRoutes();

    foreach (['quest', 'quiz'] as $product) {
        $route = $routes->getByName("deck.{$product}.sessions.participants.leave");
        expect($route)->not->toBeNull()
            ->and($route->methods())->toContain('POST')
            ->and($route->gatherMiddleware())->toContain(ParticipantReadAccess::IP_THROTTLE)->toContain('throttle:deck-participant');
    }

    // 500 phones × (1 answer + 1 read) per 20 s question = 3,000 / min: 2x headroom.
    expect(ParticipantReadAccess::IP_PER_MINUTE)->toBe(6000)
        ->and(ParticipantReadAccess::IP_PER_MINUTE)->toBeGreaterThanOrEqual(2 * 500 * 2 * 3);
});

// --- 4. insert a leaderboard mid-session -------------------------------------------------------

it('inserts a leaderboard right after the current slide and moves to it', function () {
    $host = qapiOwner();
    $deck = qfixDeck($host, [qfixPick(), ['heading', ['title' => 'Break']]]);
    $state = qapiStart($host, $deck->id);
    $sessionId = $state['session_id'];
    [$ada, $grace] = qapiJoin($state, ['Ada', 'Grace']);
    $pick = qfixRun($sessionId, 1);
    $heading = qfixRun($sessionId, 2);
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    qapiSubmit($sessionId, $pick->id, $ada['token'], ['option_id' => qfixIds($pick)['Paris']])->assertNoContent();

    // Inserting while the question still takes answers reveals it first (like next_slide).
    $from = qapiEvents()->count();
    $data = qapiAdvance($host, $sessionId, ['action' => 'insert_leaderboard'])->assertOk()->json('data');
    $board = qfixRun($sessionId, 2);

    expect($pick->fresh()->state)->toBe('reveal')
        ->and($board->type_snapshot)->toBe('leaderboard')
        ->and($board->slide_id)->toBeNull()
        ->and($board->config_snapshot)->toEqual(['top_n' => 10, 'show_all_participants' => false])
        ->and($heading->fresh()->position_snapshot)->toBe(3)
        ->and($data['current_run']['id'])->toBe($board->id)
        ->and($data['session']['total_slides'])->toBe(3)
        ->and(array_column($data['runs'], 'position'))->toBe([1, 2, 3])
        ->and(qfixPublic($from))->toBe(['slide.state.changed', 'slide.revealed', 'slide.changed', 'slide.state.changed', 'leaderboard.updated']);

    $changed = qapiEvents('slide.changed')->last()->broadcastWith();
    $updated = qapiEvents('leaderboard.updated')->last()->broadcastWith();
    expect($changed['slide_run_id'])->toBe($board->id)->and($changed['total_slides'])->toBe(3)->and($changed['position'])->toBe(2)
        ->and($updated['slide_run_id'])->toBe($board->id)
        ->and(array_map(fn ($row) => [$row['participant_id'], $row['total_points'], $row['points_delta']], $updated['leaderboard']))
        ->toBe([[$ada['id'], 200, 200], [$grace['id'], 0, 0]]);
    qapiState($sessionId, $grace['token'])->assertOk()
        ->assertJsonPath('data.current_slide_run.type', 'leaderboard')
        ->assertJsonPath('data.quiz.leaderboard.0.participant_id', $ada['id']);

    // Not twice in a row; navigation continues to the slide that followed.
    qapiAdvance($host, $sessionId, ['action' => 'insert_leaderboard'])->assertConflict()->assertJsonPath('data.code', 'invalid_state');
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk()->assertJsonPath('data.current_run.id', $heading->id);
    qapiAdvance($host, $sessionId, ['action' => 'insert_leaderboard'])->assertOk()->assertJsonPath('data.session.total_slides', 4);
    expect(DeckSessionSlideRun::query()->where('deck_session_id', $sessionId)->orderBy('position_snapshot')->pluck('type_snapshot')->all())
        ->toBe(['pick_answer_single', 'leaderboard', 'heading', 'leaderboard']);

    // Quest routes have no such action.
    $questDeck = Deck::factory()->ownedBy($host)->create();
    Slide::factory()->ofType('poll_single')->create(['deck_id' => $questDeck->id]);
    qapiAsHost($host);
    $questSession = $this->postJson("/api/v1/quests/{$questDeck->id}/sessions")->assertCreated()->json('data.session_id');
    $this->postJson("/api/v1/quest-sessions/{$questSession}/advance", ['action' => 'insert_leaderboard'])
        ->assertStatus(422)->assertJsonValidationErrors(['action'], 'data.validation_errors');
});
