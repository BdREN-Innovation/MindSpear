<?php

use App\Deck\Slides\SlideTypeRegistry;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Arr;

require_once __DIR__ . '/QuizApiHelpers.php';

/*
 * Quiz live engine (QUIZ_REDESIGN_PLAN.md "Live session state machine",
 * §1.5, §1.6, §2.2, §2.3): waiting → get_ready → voting → reveal, the
 * hidden_until_reveal broadcast gating, scoring on submit, my-answer
 * correctness after the reveal, the spinner and the leaderboard.
 */

uses(DatabaseTransactions::class);

beforeEach(function () {
    qapiSetUp();
    $this->freezeTime();
});

/**
 * A quiz deck of $owner from factory rows. Spec: [type, attributes]; attributes
 * may hold `config` (default: the type's defaultConfig), `options` (labels or
 * option attribute arrays) and slide columns.
 */
function qsessDeck(User $owner, array $slides): Deck
{
    $deck = Deck::factory()->quiz()->ownedBy($owner)->create(['title' => 'Live quiz']);
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

/** A pick_answer_single spec: Paris is correct. */
function qsessPick(array $columns = []): array
{
    return ['pick_answer_single', $columns + [
        'title' => 'Capital of France?',
        'time_limit_seconds' => 20,
        'get_ready_seconds' => 0,
        'options' => [['label' => 'Paris', 'is_correct' => true], ['label' => 'Lyon', 'is_correct' => false], ['label' => 'Nice']],
    ]];
}

/** Starts the deck through the API and joins $names. @return array{0: array, 1: list<array>} */
function qsessLive(User $host, Deck $deck, array $names = ['Ada', 'Grace', 'Linus']): array
{
    $state = qapiStart($host, $deck->id);

    return [$state, $names === [] ? [] : qapiJoin($state, $names)];
}

/** The run at 1-based $position of the session. */
function qsessRun(int $sessionId, int $position): DeckSessionSlideRun
{
    return DeckSessionSlideRun::query()->where('deck_session_id', $sessionId)->where('position_snapshot', $position)->firstOrFail();
}

/** Option ids of a run in author order, by label. @return array<string, int> */
function qsessOptionIds(DeckSessionSlideRun $run): array
{
    return collect($run->options_snapshot)->mapWithKeys(fn (array $o) => [$o['label'] => (int) $o['id']])->all();
}

/** Broadcasts on the public channel / the host channel since $from (an index into qapiEvents()). */
function qsessPublic(int $from = 0): array
{
    return qapiEvents()->slice($from)->reject(fn (LiveBroadcastEvent $e) => $e->isPrivate())->map(fn ($e) => $e->broadcastAs())->values()->all();
}

function qsessHost(int $from = 0): array
{
    return qapiEvents()->slice($from)->filter(fn (LiveBroadcastEvent $e) => $e->isPrivate())->map(fn ($e) => $e->broadcastAs())->values()->all();
}

// --- session start ------------------------------------------------------------------

it('snapshots scoring and the quiz Get ready default at session start', function () {
    $host = qapiOwner();
    $deck = qsessDeck($host, [
        ['pick_answer_single', ['options' => [['label' => 'A', 'is_correct' => true], 'B'], 'time_limit_seconds' => 20]],
        ['pick_answer_multi', ['options' => ['A', 'B'], 'points_min' => 10, 'points_max' => 500, 'speed_bonus_enabled' => false, 'get_ready_seconds' => 0]],
        ['spinner_wheel', ['options' => ['A', 'B'], 'config' => ['spin_duration_ms' => 4500]]],
        ['leaderboard', []],
        ['heading', []],
    ]);

    $state = qapiStart($host, $deck->id);
    $sessionId = $state['session_id'];
    [$pick, $multi, $wheel, $board, $heading] = array_map(fn (int $p) => qsessRun($sessionId, $p), [1, 2, 3, 4, 5]);

    // (JSONB keeps its own key order: compare as maps.)
    expect($pick->config_snapshot['scoring'])->toEqual(['points_min' => 50, 'points_max' => 100, 'speed_bonus_enabled' => true, 'time_limit_seconds' => 20])
        ->and($pick->get_ready_seconds)->toBe(5)
        ->and($multi->config_snapshot['scoring'])->toEqual(['points_min' => 10, 'points_max' => 500, 'speed_bonus_enabled' => false, 'time_limit_seconds' => null])
        ->and($multi->get_ready_seconds)->toBeNull()
        ->and($wheel->time_limit_seconds)->toBe(5)
        ->and($wheel->get_ready_seconds)->toBeNull()
        ->and($wheel->config_snapshot)->not->toHaveKey('scoring')
        ->and($board->time_limit_seconds)->toBeNull()
        ->and($board->config_snapshot)->not->toHaveKey('scoring')
        ->and($heading->config_snapshot)->not->toHaveKey('scoring');

    // The participant view shows the points range (for the 50p ── 100p bar) but no answer key.
    expect($state['runs'][0]['config']['scoring']['points_max'])->toBe(100)
        ->and($state['quiz'])->toBe(['submitted_count' => 0, 'spin' => null, 'leaderboard' => null]);
    qapiAssertNoSecrets($state['runs'], 'host state runs');
});

// --- transitions --------------------------------------------------------------------

it('runs waiting → get_ready → voting → reveal and refuses illegal transitions', function () {
    $host = qapiOwner();
    $deck = qsessDeck($host, [qsessPick(['get_ready_seconds' => null]), ['heading', []]]);
    [$state, $people] = qsessLive($host, $deck);
    $sessionId = $state['session_id'];
    $run = qsessRun($sessionId, 1);

    qapiAdvance($host, $sessionId, ['action' => 'reveal'])->assertConflict()
        ->assertJsonPath('data.code', 'invalid_state')->assertJsonPath('data.state', 'waiting');

    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk()
        ->assertJsonPath('data.current_run.state', 'get_ready')
        ->assertJsonPath('data.duration_seconds', 5);
    qapiSubmit($sessionId, $run->id, $people[0]['token'], ['option_id' => qsessOptionIds($run)['Paris']])
        ->assertConflict()->assertJsonPath('data.reason', 'not_voting');
    qapiAdvance($host, $sessionId, ['action' => 'reveal'])->assertConflict()->assertJsonPath('data.state', 'get_ready');

    $this->travel(5)->seconds();
    qapiHostState($host, $sessionId)->assertOk()->assertJsonPath('data.current_run.state', 'voting')->assertJsonPath('data.duration_seconds', 20);

    $revealed = qapiAdvance($host, $sessionId, ['action' => 'reveal'])->assertOk()->json('data');
    expect($revealed['current_run']['state'])->toBe('reveal')
        ->and($revealed['results_visibility'])->toBe('public')
        ->and($revealed['current_run']['closed_at'])->not->toBeNull();

    qapiAdvance($host, $sessionId, ['action' => 'reveal'])->assertConflict()->assertJsonPath('data.state', 'reveal');
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertConflict();
    qapiAdvance($host, $sessionId, ['action' => 'close_voting'])->assertConflict();

    // Content slides only navigate.
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk()->assertJsonPath('data.current_run.state', 'waiting');
    qapiAdvance($host, $sessionId, ['action' => 'reveal'])->assertConflict()->assertJsonPath('data.code', 'invalid_state');
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertConflict();
    qapiAdvance($host, $sessionId, ['action' => 'previous_slide'])->assertOk()->assertJsonPath('data.current_run.state', 'reveal');

    // Quest routes have no reveal action.
    $questDeck = Deck::factory()->ownedBy($host)->create();
    Slide::factory()->ofType('poll_single')->create(['deck_id' => $questDeck->id]);
    qapiAsHost($host);
    $questSession = $this->postJson("/api/v1/quests/{$questDeck->id}/sessions")->assertCreated()->json('data.session_id');
    $this->postJson("/api/v1/quest-sessions/{$questSession}/advance", ['action' => 'reveal'])
        ->assertStatus(422)->assertJsonValidationErrors(['action'], 'data.validation_errors');
});

it('reveals when the time limit runs out, on close_voting, when leaving the slide and when the session ends', function () {
    $host = qapiOwner();
    $deck = qsessDeck($host, [qsessPick(), qsessPick(), qsessPick(), qsessPick()]);
    [$state] = qsessLive($host, $deck, ['Ada']);
    $sessionId = $state['session_id'];

    // 1: timer.
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk()->assertJsonPath('data.current_run.state', 'voting');
    $this->travel(21)->seconds();
    qapiHostState($host, $sessionId)->assertOk()->assertJsonPath('data.current_run.state', 'reveal');

    // 2: close_voting is the quiz reveal.
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk();
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    qapiAdvance($host, $sessionId, ['action' => 'close_voting'])->assertOk()->assertJsonPath('data.current_run.state', 'reveal');

    // 3: next_slide away from voting reveals it; going back needs force.
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk();
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    qapiAdvance($host, $sessionId, ['action' => 'previous_slide'])->assertConflict()->assertJsonPath('data.requires_force', true);
    $from = qapiEvents()->count();
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk();
    expect(qsessRun($sessionId, 3)->state)->toBe('reveal')
        ->and(qsessPublic($from))->toBe(['slide.state.changed', 'slide.revealed', 'slide.changed', 'slide.state.changed']);

    // 4: ending the session reveals the active run before session.ended.
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    $from = qapiEvents()->count();
    qapiAsHost($host);
    $this->postJson(QAPI_SESSIONS . "/{$sessionId}/end")->assertOk()->assertJsonPath('data.session.status', 'ended');
    expect(qsessRun($sessionId, 4)->state)->toBe('reveal')
        ->and(qsessPublic($from))->toBe(['slide.state.changed', 'slide.revealed', 'session.ended'])
        ->and(DeckSessionSlideRun::query()->where('deck_session_id', $sessionId)->where('state', 'closed')->count())->toBe(0);
});

it('reveals by itself once every participant in the room has answered', function () {
    $host = qapiOwner();
    $deck = qsessDeck($host, [qsessPick(), qsessPick()]);
    [$state, $people] = qsessLive($host, $deck);
    $sessionId = $state['session_id'];
    $run = qsessRun($sessionId, 1);
    $ids = qsessOptionIds($run);

    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    qapiSubmit($sessionId, $run->id, $people[0]['token'], ['option_id' => $ids['Paris']])->assertNoContent();
    // Answers are final: a second one is refused and does not count twice.
    qapiSubmit($sessionId, $run->id, $people[0]['token'], ['option_id' => $ids['Lyon']])
        ->assertConflict()->assertJsonPath('data.reason', 'already_answered');
    qapiSubmit($sessionId, $run->id, $people[1]['token'], ['option_id' => $ids['Paris']])->assertNoContent();
    expect($run->fresh()->state)->toBe('voting');

    $from = qapiEvents()->count();
    qapiSubmit($sessionId, $run->id, $people[2]['token'], ['option_id' => $ids['Nice']])->assertNoContent();
    expect($run->fresh()->state)->toBe('reveal')
        ->and(qsessPublic($from))->toBe(['slide.submitted_count.updated', 'slide.state.changed', 'slide.revealed']);
    qapiSubmit($sessionId, $run->id, $people[2]['token'], ['option_id' => $ids['Paris']])->assertConflict()->assertJsonPath('data.reason', 'not_voting');

    // Someone who left does not hold the room up.
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk();
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    DeckParticipant::query()->whereKey($people[2]['id'])->update(['left_at' => now()]);
    $second = qsessRun($sessionId, 2);
    qapiSubmit($sessionId, $second->id, $people[0]['token'], ['option_id' => qsessOptionIds($second)['Paris']])->assertNoContent();
    expect($second->fresh()->state)->toBe('voting');
    qapiSubmit($sessionId, $second->id, $people[1]['token'], ['option_id' => qsessOptionIds($second)['Paris']])->assertNoContent();
    expect($second->fresh()->state)->toBe('reveal');
});

// --- broadcast gating ---------------------------------------------------------------

it('keeps answers on the host channel until the reveal, then reveals everything publicly', function () {
    $host = qapiOwner();
    $deck = qsessDeck($host, [qsessPick(['points_min' => 100, 'points_max' => 200, 'speed_bonus_enabled' => false])]);
    [$state, $people] = qsessLive($host, $deck);
    $sessionId = $state['session_id'];
    $run = qsessRun($sessionId, 1);
    $ids = qsessOptionIds($run);

    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    $from = qapiEvents()->count();
    qapiSubmit($sessionId, $run->id, $people[0]['token'], ['option_id' => $ids['Paris']])->assertNoContent();
    qapiSubmit($sessionId, $run->id, $people[1]['token'], ['option_id' => $ids['Lyon']])->assertNoContent();

    expect(qsessPublic($from))->toBe(['slide.submitted_count.updated', 'slide.submitted_count.updated'])
        ->and(qsessHost($from))->toBe(['slide.aggregate.updated', 'answer.submitted', 'slide.aggregate.updated', 'answer.submitted']);

    $counts = qapiEvents('slide.submitted_count.updated')->slice(-2)->map(fn ($e) => $e->broadcastWith())->values();
    expect(Arr::only($counts[1], ['slide_run_id', 'submitted_count', 'participant_count']))
        ->toBe(['slide_run_id' => $run->id, 'submitted_count' => 2, 'participant_count' => 3]);
    foreach ($counts as $payload) {
        qapiAssertNoSecrets($payload, 'submitted count');
        expect($payload)->not->toHaveKey('aggregate');
    }

    // Participants: no aggregate, no answer key, 403 on the aggregate read; the host sees the live numbers.
    $mine = qapiState($sessionId, $people[0]['token'])->assertOk()->json('data');
    expect($mine['aggregate'])->toBeNull()
        ->and($mine['results_visibility'])->toBe('host')
        ->and($mine['quiz']['submitted_count'])->toBe(2)
        ->and($mine['my_submission_for_current_slide'])->toHaveKeys(['answer_payload'])
        ->and($mine['my_submission_for_current_slide'])->not->toHaveKey('is_correct');
    qapiAssertNoSecrets($mine['current_slide_run'], 'participant run');
    qapiAssertNoSecrets($mine['my_submission_for_current_slide'], 'my submission');

    qapiAsGuest();
    $this->getJson(QAPI_SESSIONS . "/{$sessionId}/slide-runs/{$run->id}/aggregate", qapiHeaders($people[0]['token']))
        ->assertForbidden()->assertJsonPath('data.code', 'results_hidden');
    $mineBefore = qapiMyAnswer($sessionId, $run->id, $people[0]['token'])->assertOk()->json('data');
    expect(array_keys($mineBefore))->toBe(['slide_run_id', 'answer_payload', 'time_to_answer_ms', 'submitted_at']);

    $hostState = qapiHostState($host, $sessionId)->assertOk()->json('data');
    expect($hostState['current_run']['aggregate']['total_responses'])->toBe(2)
        ->and($hostState['current_run']['aggregate']['correct'])->toBe(['option_ids' => [$ids['Paris']]])
        ->and($hostState['current_run']['answer_key'])->toBe(['option_ids' => [$ids['Paris']]]);

    // Reveal: one public slide.revealed with the correct answer and the leaderboard move.
    $from = qapiEvents()->count();
    qapiAdvance($host, $sessionId, ['action' => 'reveal'])->assertOk();
    expect(qsessPublic($from))->toBe(['slide.state.changed', 'slide.revealed'])
        ->and(qsessHost($from))->toBe([]);

    $revealed = qapiEvents('slide.revealed')->last()->broadcastWith();
    expect($revealed['slide_run_id'])->toBe($run->id)
        ->and($revealed['type'])->toBe('pick_answer_single')
        ->and($revealed['state'])->toBe('reveal')
        ->and($revealed['aggregate']['total_responses'])->toBe(2)
        ->and($revealed['aggregate']['correct_responses'])->toBe(1)
        ->and($revealed['aggregate']['correct'])->toBe(['option_ids' => [$ids['Paris']]])
        ->and($revealed['refetch'])->toBeFalse()
        ->and($revealed['spin'])->toBeNull()
        ->and($revealed['leaderboard_truncated'])->toBeFalse()
        ->and($revealed['leaderboard_delta'])->toBe([
            ['participant_id' => $people[0]['id'], 'points_delta' => 200, 'new_total' => 200, 'new_rank' => 1],
            ['participant_id' => $people[1]['id'], 'points_delta' => 0, 'new_total' => 0, 'new_rank' => 2],
            ['participant_id' => $people[2]['id'], 'points_delta' => 0, 'new_total' => 0, 'new_rank' => 2],
        ])
        ->and(qapiEvents('slide.closed'))->toHaveCount(0);

    // After the reveal participants read the results and their own correctness.
    $after = qapiState($sessionId, $people[1]['token'])->assertOk()->json('data');
    expect($after['results_visibility'])->toBe('public')
        ->and($after['aggregate']['correct'])->toBe(['option_ids' => [$ids['Paris']]])
        ->and($after['my_submission_for_current_slide']['is_correct'])->toBeFalse()
        ->and($after['standing'])->toBe(['participant_id' => $people[1]['id'], 'total_points' => 0, 'rank' => 2, 'points_delta' => 0]);

    qapiAsGuest();
    $this->getJson(QAPI_SESSIONS . "/{$sessionId}/slide-runs/{$run->id}/aggregate", qapiHeaders($people[2]['token']))
        ->assertOk()->assertJsonPath('data.final', true)->assertJsonPath('data.visibility', 'public')
        ->assertJsonPath('data.aggregate.correct.option_ids', [$ids['Paris']]);

    qapiMyAnswer($sessionId, $run->id, $people[0]['token'])->assertOk()
        ->assertJsonPath('data.is_correct', true)
        ->assertJsonPath('data.points_awarded', 200)
        ->assertJsonPath('data.correct_answer', ['option_ids' => [$ids['Paris']]])
        ->assertJsonPath('data.total_points', 200)
        ->assertJsonPath('data.rank', 1);
    qapiMyAnswer($sessionId, $run->id, $people[2]['token'])->assertNotFound();
});

it('keeps slide.revealed within one Reverb publish by capping the leaderboard rows', function () {
    config(['deck.quiz.reveal_leaderboard_limit' => 2]);
    $host = qapiOwner();
    $deck = qsessDeck($host, [qsessPick()]);
    [$state, $people] = qsessLive($host, $deck);
    $sessionId = $state['session_id'];

    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    qapiAdvance($host, $sessionId, ['action' => 'reveal'])->assertOk();

    $revealed = qapiEvents('slide.revealed')->last()->broadcastWith();
    expect($revealed['leaderboard_delta'])->toHaveCount(2)
        ->and($revealed['leaderboard_truncated'])->toBeTrue();
});

// --- scoring --------------------------------------------------------------------------

it('scores the first answer on submit with the speed bonus, keeps it final and adds the points at the reveal', function () {
    // Exact millisecond assertions below: no real time may pass between steps.
    $this->freezeTime();
    $host = qapiOwner();
    $deck = qsessDeck($host, [qsessPick(['get_ready_seconds' => 5])]);
    [$state, $people] = qsessLive($host, $deck);
    $sessionId = $state['session_id'];
    $run = qsessRun($sessionId, 1);
    $ids = qsessOptionIds($run);

    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    $this->travel(5)->seconds();
    qapiState($sessionId, $people[0]['token'])->assertOk()->assertJsonPath('data.current_slide_run.state', 'voting');

    // 4 s into 20: 50 + (16 / 20) * 50 = 90, stored on the answer; the total waits for the reveal.
    $this->travel(4)->seconds();
    qapiSubmit($sessionId, $run->id, $people[0]['token'], ['option_id' => $ids['Paris']])->assertNoContent();
    $answer = DeckParticipantAnswer::query()->where('deck_participant_id', $people[0]['id'])->firstOrFail();
    expect($answer->time_to_answer_ms)->toBe(4000)
        ->and($answer->is_correct)->toBeTrue()
        ->and($answer->points_awarded)->toBe(90)
        ->and(DeckParticipant::find($people[0]['id'])->total_points)->toBe(0);

    // A change of mind is refused (409 already_answered); the first answer and its points stay.
    qapiSubmit($sessionId, $run->id, $people[0]['token'], ['option_id' => $ids['Lyon']])
        ->assertConflict()->assertJsonPath('data.reason', 'already_answered')->assertJsonPath('data.slide_run_id', $run->id);
    expect($answer->fresh()->points_awarded)->toBe(90)
        ->and($answer->fresh()->answer_payload)->toBe(['option_id' => $ids['Paris']])
        ->and($answer->fresh()->time_to_answer_ms)->toBe(4000);

    // Late answers are refused, never scored: 22 s into a 20 s slide, past the 1 s grace.
    $this->travel(18)->seconds();
    qapiSubmit($sessionId, $run->id, $people[1]['token'], ['option_id' => $ids['Paris']])->assertConflict();
    expect(DeckParticipant::find($people[1]['id'])->total_points)->toBe(0);

    // The timer reveals the run: now the points reach the total, once.
    qapiHostState($host, $sessionId)->assertOk()->assertJsonPath('data.current_run.state', 'reveal');
    qapiHostState($host, $sessionId)->assertOk();
    expect(DeckParticipant::find($people[0]['id'])->total_points)->toBe(90)
        ->and(DeckParticipant::find($people[1]['id'])->total_points)->toBe(0);
});

it('leaves Quest answers unscored', function () {
    $host = qapiOwner();
    $deck = Deck::factory()->ownedBy($host)->create();
    $slide = Slide::factory()->ofType('poll_single', app(SlideTypeRegistry::class)->for('poll_single')->defaultConfig())->create(['deck_id' => $deck->id]);
    $yes = SlideOption::factory()->create(['slide_id' => $slide->id, 'label' => 'Yes', 'is_correct' => true]);
    SlideOption::factory()->create(['slide_id' => $slide->id, 'label' => 'No']);

    qapiAsHost($host);
    $state = $this->postJson("/api/v1/quests/{$deck->id}/sessions")->assertCreated()->json('data');
    $this->postJson("/api/v1/quest-sessions/{$state['session_id']}/advance", ['action' => 'start_voting'])->assertOk();
    qapiAsGuest();
    $joined = $this->postJson("/api/v1/quest-sessions/{$state['session_id']}/participants/join", [
        'join_code' => $state['join_code'], 'display_name' => 'Ada', 'emoji_avatar' => config('deck.emoji_avatars')[0],
    ])->assertCreated()->json('data');
    $run = qsessRun($state['session_id'], 1);
    $this->postJson("/api/v1/quest-sessions/{$state['session_id']}/slide-runs/{$run->id}/answers", ['answer_payload' => ['option_id' => $yes->id]], qapiHeaders($joined['participant_token']))
        ->assertNoContent();

    $answer = DeckParticipantAnswer::query()->where('slide_run_id', $run->id)->firstOrFail();
    expect($answer->points_awarded)->toBeNull()
        ->and($answer->is_correct)->toBeNull()
        ->and(DeckParticipant::find($joined['participant_id'])->total_points)->toBeNull()
        ->and($run->fresh()->config_snapshot)->not->toHaveKey('scoring')
        ->and(qapiEvents('slide.submitted_count.updated'))->toHaveCount(0);
});

// --- spinner ----------------------------------------------------------------------------

it('spins the wheel on start, broadcasts spin.started and reveals after the spin', function () {
    $host = qapiOwner();
    $deck = qsessDeck($host, [['spinner_wheel', ['options' => [
        ['label' => 'Ada', 'payload' => ['weight' => 1]], ['label' => 'Grace', 'payload' => ['weight' => 2]], ['label' => 'Linus'],
    ]]]]);
    [$state, $people] = qsessLive($host, $deck, ['Ada']);
    $sessionId = $state['session_id'];
    $run = qsessRun($sessionId, 1);

    $started = qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk()->json('data');
    expect($started['current_run']['state'])->toBe('voting')
        ->and($started['duration_seconds'])->toBe(3)
        ->and($started['quiz']['spin'])->toHaveKeys(['option_id', 'target_angle']);

    $spin = qapiEvents('spin.started')->sole()->broadcastWith();
    $segment = collect($started['current_run']['segments'])->firstWhere('option_id', $spin['option_id']);
    expect($spin['slide_run_id'])->toBe($run->id)
        ->and(qsessOptionIds($run))->toContain($spin['option_id'])
        ->and($segment)->not->toBeNull()
        ->and($spin['target_angle'])->toBeGreaterThanOrEqual($segment['start_angle'])
        ->and($spin['target_angle'])->toBeLessThanOrEqual($segment['end_angle'])
        ->and($spin['duration_seconds'])->toBe(3)
        // Run timestamps are stored to the millisecond.
        ->and(abs(Carbon::parse($spin['ends_at'])->diffInMilliseconds(now()->addSeconds(3))))->toBeLessThan(1.0)
        ->and(qapiEvents('spin.started')->sole()->isPrivate())->toBeFalse();

    // Participants see the same spin on a resync; the wheel takes no answers.
    qapiState($sessionId, $people[0]['token'])->assertOk()
        ->assertJsonPath('data.quiz.spin', ['option_id' => $spin['option_id'], 'target_angle' => $spin['target_angle']]);
    qapiSubmit($sessionId, $run->id, $people[0]['token'], ['option_id' => $spin['option_id']])->assertConflict()->assertJsonPath('data.reason', 'no_answers');
    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertConflict();

    $this->travel(3)->seconds();
    qapiHostState($host, $sessionId)->assertOk()->assertJsonPath('data.current_run.state', 'reveal');
    $revealed = qapiEvents('slide.revealed')->sole()->broadcastWith();
    expect($revealed['spin'])->toBe(['option_id' => $spin['option_id'], 'target_angle' => $spin['target_angle']])
        ->and($revealed['aggregate']['spin'])->toBe($revealed['spin'])
        ->and($revealed['leaderboard_delta'])->toBe([]);
});

it('lets the host stop the wheel early with reveal', function () {
    $host = qapiOwner();
    $deck = qsessDeck($host, [['spinner_wheel', ['options' => ['A', 'B']]]]);
    [$state] = qsessLive($host, $deck, []);

    qapiAdvance($host, $state['session_id'], ['action' => 'start_voting'])->assertOk();
    qapiAdvance($host, $state['session_id'], ['action' => 'reveal'])->assertOk()->assertJsonPath('data.current_run.state', 'reveal');
    expect(qapiEvents('slide.revealed'))->toHaveCount(1);
});

// --- leaderboard ------------------------------------------------------------------------

it('broadcasts the leaderboard when its slide comes up and serves it to the host and participants', function () {
    $host = qapiOwner();
    $deck = qsessDeck($host, [
        qsessPick(['speed_bonus_enabled' => false]),
        ['leaderboard', ['config' => ['top_n' => 2, 'show_all_participants' => false]]],
    ]);
    [$state, $people] = qsessLive($host, $deck);
    $sessionId = $state['session_id'];
    $run = qsessRun($sessionId, 1);
    $ids = qsessOptionIds($run);

    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    qapiSubmit($sessionId, $run->id, $people[2]['token'], ['option_id' => $ids['Paris']])->assertNoContent();
    qapiSubmit($sessionId, $run->id, $people[1]['token'], ['option_id' => $ids['Paris']])->assertNoContent();
    qapiSubmit($sessionId, $run->id, $people[0]['token'], ['option_id' => $ids['Nice']])->assertNoContent();

    $from = qapiEvents()->count();
    $moved = qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk()->json('data');
    expect(qsessPublic($from))->toBe(['slide.changed', 'slide.state.changed', 'leaderboard.updated']);

    $board = qapiEvents('leaderboard.updated')->sole()->broadcastWith();
    $expectedRows = [
        ['rank' => 1, 'participant_id' => $people[1]['id'], 'display_name' => 'Grace', 'emoji_avatar' => $people[1]['emoji'], 'total_points' => 100, 'points_delta' => 100],
        ['rank' => 1, 'participant_id' => $people[2]['id'], 'display_name' => 'Linus', 'emoji_avatar' => $people[2]['emoji'], 'total_points' => 100, 'points_delta' => 100],
    ];
    expect($board['top_n'])->toBe(2)
        ->and($board['refetch'])->toBeFalse()
        ->and($board['leaderboard'])->toBe($expectedRows)
        ->and($moved['quiz']['leaderboard'])->toBe($expectedRows);

    qapiState($sessionId, $people[0]['token'])->assertOk()->assertJsonPath('data.quiz.leaderboard', $expectedRows)
        ->assertJsonPath('data.standing.rank', 3);

    qapiLeaderboard($sessionId, host: $host)->assertOk()
        ->assertJsonPath('data.top_n', 10)
        ->assertJsonPath('data.participant_count', 3)
        ->assertJsonPath('data.me', null)
        ->assertJsonCount(3, 'data.leaderboard');
    qapiLeaderboard($sessionId, $people[0]['token'], query: ['limit' => 1])->assertOk()
        ->assertJsonCount(1, 'data.leaderboard')
        ->assertJsonPath('data.me', ['participant_id' => $people[0]['id'], 'total_points' => 0, 'rank' => 3, 'points_delta' => 0]);
    qapiLeaderboard($sessionId, $people[0]['token'], query: ['limit' => 0])->assertStatus(422);
    qapiLeaderboard($sessionId, 'not-a-real-token-' . str_repeat('x', 47))->assertUnauthorized();
    qapiLeaderboard($sessionId)->assertUnauthorized();
    qapiLeaderboard($sessionId, host: qapiOwner())->assertNotFound();

    // Still readable for the review after the end.
    qapiAsHost($host);
    $this->postJson(QAPI_SESSIONS . "/{$sessionId}/end")->assertOk();
    qapiLeaderboard($sessionId, $people[1]['token'])->assertOk()->assertJsonPath('data.status', 'ended')->assertJsonPath('data.me.rank', 1);
});

it('sends a slim leaderboard.updated when the rows would not fit one Reverb publish', function () {
    $host = qapiOwner();
    $deck = qsessDeck($host, [['heading', []], ['leaderboard', ['config' => ['top_n' => 10, 'show_all_participants' => true]]]]);
    [$state] = qsessLive($host, $deck, []);
    $sessionId = $state['session_id'];

    foreach (range(1, 50) as $i) {
        DeckParticipant::factory()->create(['deck_session_id' => $sessionId, 'display_name' => str_repeat('名', 38) . sprintf('%02d', $i), 'total_points' => $i]);
    }

    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk();

    $board = qapiEvents('leaderboard.updated')->sole()->broadcastWith();
    expect($board['refetch'])->toBeTrue()
        ->and($board['leaderboard'])->toBeNull()
        ->and($board['top_n'])->toBe(50);

    qapiLeaderboard($sessionId, host: $host, query: ['limit' => 50])->assertOk()
        ->assertJsonCount(50, 'data.leaderboard')
        ->assertJsonPath('data.leaderboard.0.total_points', 50);
    qapiHostState($host, $sessionId)->assertOk()->assertJsonCount(50, 'data.quiz.leaderboard');
});

it('shows quiz correctness in the post-session review', function () {
    $host = qapiOwner();
    $deck = qsessDeck($host, [qsessPick(['speed_bonus_enabled' => false]), qsessPick()]);
    [$state, $people] = qsessLive($host, $deck, ['Ada']);
    $sessionId = $state['session_id'];
    $run = qsessRun($sessionId, 1);

    qapiAdvance($host, $sessionId, ['action' => 'start_voting'])->assertOk();
    qapiSubmit($sessionId, $run->id, $people[0]['token'], ['option_id' => qsessOptionIds($run)['Paris']])->assertNoContent();
    qapiAsHost($host);
    $this->postJson(QAPI_SESSIONS . "/{$sessionId}/end")->assertOk();

    qapiAsGuest();
    $review = $this->getJson(QAPI_SESSIONS . "/{$sessionId}/review", qapiHeaders($people[0]['token']))->assertOk()->json('data');
    expect($review['runs'][0]['state'])->toBe('reveal')
        ->and($review['runs'][0]['my_answer']['is_correct'])->toBeTrue()
        ->and($review['runs'][0]['my_answer']['points_awarded'])->toBe(100)
        ->and($review['runs'][0]['my_answer']['rank'])->toBe(1)
        ->and($review['runs'][0]['aggregate']['correct_responses'])->toBe(1)
        // Never started: still hidden.
        ->and($review['runs'][1]['state'])->toBe('waiting')
        ->and($review['runs'][1]['aggregate'])->toBeNull();
    qapiAssertNoSecrets($review['runs'][1], 'unplayed run');
});
