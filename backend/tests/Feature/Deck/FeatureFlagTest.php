<?php

use App\Deck\Sessions\SessionStateMachine;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Support\DeckFeature;
use App\Events\Live\LiveBroadcastEvent;
use App\Filament\Resources\UserResource;
use App\Jobs\Deck\BroadcastDeckAggregate;
use App\Jobs\Deck\TransitionSlideRunJob;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use App\Models\User;
use App\Services\Live\ParticipantTokenService;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Cache\RateLimiter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter as RateLimiterFacade;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

/*
 * Quest v2 rollout flag (plan §8.3): users.quest_v2_enabled gates authoring
 * and hosting (403 feature_disabled); participants, by-code, emoji meta and
 * review are never gated. config('deck.quest_v2_default_enabled') turns it on
 * for everyone.
 */

uses(DatabaseTransactions::class);

beforeEach(function () {
    config([
        'broadcasting.default' => 'null',
        'cache.default' => 'array',
        'queue.default' => 'sync',
        'deck.quest_v2_default_enabled' => false,
    ]);

    Event::fake([LiveBroadcastEvent::class]);
    Queue::fake([TransitionSlideRunJob::class, BroadcastDeckAggregate::class]);
    flagArrayRateLimiter();
});

// --- helpers (prefixed: Pest helpers are global) ---------------------------------

/** Array-backed copy of the registered limiters, so throttle counters stay out of the dev Redis. */
function flagArrayRateLimiter(): void
{
    $current = app(RateLimiter::class);
    $limiters = (fn () => $this->limiters)->call($current);
    $fresh = new RateLimiter(app('cache')->store('array'));

    foreach ($limiters as $name => $callback) {
        $fresh->for($name, $callback);
    }

    RateLimiterFacade::swap($fresh);
}

/** A quest deck of $owner: a public-results poll, then a Q&A slide. */
function flagDeck(User $owner): Deck
{
    $deck = Deck::factory()->ownedBy($owner)->create();
    $registry = app(SlideTypeRegistry::class);

    $poll = Slide::factory()->ofType('poll_single', ['show_results_to_participants' => true] + $registry->for('poll_single')->defaultConfig())
        ->create(['deck_id' => $deck->id, 'position' => 1]);
    foreach (['Yes', 'No'] as $index => $label) {
        SlideOption::factory()->create(['slide_id' => $poll->id, 'position' => $index + 1, 'label' => $label]);
    }

    Slide::factory()->ofType('qa_audience', $registry->for('qa_audience')->defaultConfig())->create(['deck_id' => $deck->id, 'position' => 2]);

    return $deck;
}

function flagForbidden(TestResponse $response): TestResponse
{
    return $response->assertForbidden()
        ->assertJsonPath('status', false)
        ->assertJsonPath('message', 'Quest v2 is not enabled for your account.')
        ->assertJsonPath('data.code', 'feature_disabled');
}

function flagSignOut(): void
{
    app('auth')->forgetGuards();
}

// --- gating ---------------------------------------------------------------------------

it('answers 403 feature_disabled on every authoring and hosting route, and never gates participants', function () {
    $host = DeckFactory::newOwner();
    $deck = flagDeck($host);
    $poll = $deck->slides()->orderBy('position')->first();
    $option = $poll->options()->first();

    // While the flag is on, the host starts a session.
    Sanctum::actingAs($host);
    $sessionId = $this->postJson("/api/v1/quests/v2/{$deck->id}/sessions")->assertCreated()->json('data.session_id');
    $session = DeckSession::findOrFail($sessionId);
    $machine = app(SessionStateMachine::class);
    $session = $machine->advance($session, 'start_voting');
    $pollRun = DeckSessionSlideRun::findOrFail($session->current_slide_run_id);

    // Then it is turned off.
    $host->forceFill(['quest_v2_enabled' => false])->save();
    expect(DeckFeature::enabled($host->fresh(), Deck::PRODUCT_QUEST))->toBeFalse();
    flagSignOut();
    Sanctum::actingAs($host->fresh());

    $a = '/api/v1/quests/v2';
    $s = "/api/v1/quest-sessions/v2/{$session->id}";
    $gated = [
        ['GET', "{$a}"], ['POST', "{$a}"], ['GET', "{$a}/{$deck->id}"], ['PATCH', "{$a}/{$deck->id}"],
        ['DELETE', "{$a}/{$deck->id}"], ['POST', "{$a}/{$deck->id}/duplicate"],
        ['POST', "{$a}/{$deck->id}/slides"], ['POST', "{$a}/{$deck->id}/slides/reorder"], ['POST', "{$a}/{$deck->id}/slides/bulk"],
        ['GET', "{$a}/{$deck->id}/slides/{$poll->id}"], ['PATCH', "{$a}/{$deck->id}/slides/{$poll->id}"],
        ['DELETE', "{$a}/{$deck->id}/slides/{$poll->id}"], ['POST', "{$a}/{$deck->id}/slides/{$poll->id}/duplicate"],
        ['POST', "{$a}/{$deck->id}/slides/{$poll->id}/options"], ['POST', "{$a}/{$deck->id}/slides/{$poll->id}/options/reorder"],
        ['PATCH', "{$a}/{$deck->id}/slides/{$poll->id}/options/{$option->id}"],
        ['DELETE', "{$a}/{$deck->id}/slides/{$poll->id}/options/{$option->id}"],
        ['PUT', "{$a}/{$deck->id}/slides/{$poll->id}/options/{$option->id}/image"],
        ['PUT', "{$a}/{$deck->id}/slides/{$poll->id}/media"], ['PUT', "{$a}/{$deck->id}/cover"],
        ['POST', "{$a}/{$deck->id}/sessions"],
        ['GET', "{$s}/state"], ['POST', "{$s}/advance"], ['POST', "{$s}/end"],
        ['GET', "{$s}/slide-runs/{$pollRun->id}/aggregate"], ['GET', "{$s}/slide-runs/{$pollRun->id}/qa/questions"],
        ['PATCH', "{$s}/qa/questions/1"],
    ];

    foreach ($gated as [$method, $uri]) {
        // Refused before validation: an invalid body still gets the 403.
        flagForbidden($this->json($method, $uri, ['title' => str_repeat('x', 999), 'action' => 'nope']));
    }

    // Nothing moved.
    expect(Deck::find($deck->id))->not->toBeNull()
        ->and(Slide::find($poll->id))->not->toBeNull()
        ->and($session->fresh()->status)->toBe('live')
        ->and($pollRun->fresh()->state)->toBe('voting');

    // Signed out is still 401, not 403.
    flagSignOut();
    $this->getJson($a)->assertUnauthorized();
    $this->getJson("{$s}/state")->assertUnauthorized();

    // Participants are anonymous and never gated.
    $this->getJson("/api/v1/quest-sessions/v2/by-code/{$session->join_code}")->assertOk()->assertJsonPath('data.session_id', $session->id);
    $this->getJson('/api/v1/meta/emoji-avatars')->assertOk();
    $token = $this->postJson("{$s}/participants/join", ['join_code' => $session->join_code, 'display_name' => 'Ada', 'emoji_avatar' => '🦊'])
        ->assertCreated()->json('data.participant_token');
    $header = [ParticipantTokenService::HEADER => $token];

    $this->getJson("{$s}/state", $header)->assertOk()->assertJsonPath('data.current_slide_run.id', $pollRun->id);
    $this->getJson("{$s}/participant-state", $header)->assertOk();
    $this->postJson("{$s}/slide-runs/{$pollRun->id}/answers", ['answer_payload' => ['option_id' => $option->id]], $header)->assertNoContent();
    $this->getJson("{$s}/slide-runs/{$pollRun->id}/my-answer", $header)->assertOk();
    $this->getJson("{$s}/slide-runs/{$pollRun->id}/aggregate", $header)->assertOk()->assertJsonPath('data.total_responses', 1);

    // The flag-less host reading with a participant token gets the participant view; without one, 403.
    Sanctum::actingAs($host->fresh());
    $this->getJson("{$s}/slide-runs/{$pollRun->id}/aggregate", $header)->assertOk()->assertJsonPath('data.slide_run_id', $pollRun->id);
    flagForbidden($this->getJson("{$s}/slide-runs/{$pollRun->id}/aggregate"));
    flagSignOut();

    // Q&A, once the host side (here the state machine) has moved on.
    $session = $machine->advance($session->fresh(), 'next_slide');
    $session = $machine->advance($session, 'start_voting');
    $qaRun = $session->current_slide_run_id;
    $questionId = $this->postJson("{$s}/slide-runs/{$qaRun}/qa/questions", ['body' => 'Why?'], $header)->assertCreated()->json('data.question.question_id');
    $this->postJson("{$s}/qa/questions/{$questionId}/upvote", [], $header)->assertOk();
    $this->deleteJson("{$s}/qa/questions/{$questionId}/upvote", [], $header)->assertOk();
    $this->getJson("{$s}/slide-runs/{$qaRun}/qa/questions", $header)->assertOk()->assertJsonPath('data.total', 1);

    $machine->end($session->fresh());
    $this->getJson("{$s}/review", $header)->assertOk()->assertJsonPath('data.session.status', 'ended');
});

it('lets everyone author and host while QUEST_V2_DEFAULT_ENABLED is on', function () {
    $user = DeckFactory::newOwner(false);
    Sanctum::actingAs($user);

    flagForbidden($this->getJson('/api/v1/quests/v2'));
    $this->getJson('/api/v1/profile/show')->assertOk()->assertJsonPath('data.profile.quest_v2_enabled', false);

    config(['deck.quest_v2_default_enabled' => true]);
    expect(DeckFeature::enabled($user, Deck::PRODUCT_QUEST))->toBeTrue()
        ->and(DeckFeature::enabled(null, Deck::PRODUCT_QUEST))->toBeTrue();

    $deck = $this->postJson('/api/v1/quests/v2', ['title' => 'Open to all'])->assertCreated()->json('data.deck');
    $this->getJson('/api/v1/quests/v2')->assertOk()->assertJsonPath('data.meta.total', 1);
    $this->postJson("/api/v1/quests/v2/{$deck['id']}/slides", ['type' => 'poll_single'])->assertCreated();
    $sessionId = $this->postJson("/api/v1/quests/v2/{$deck['id']}/sessions")->assertCreated()->json('data.session_id');
    $this->getJson("/api/v1/quest-sessions/v2/{$sessionId}/state")->assertOk()->assertJsonPath('data.session_id', $sessionId);
    $this->postJson("/api/v1/quest-sessions/v2/{$sessionId}/advance", ['action' => 'next_slide'])->assertOk();

    // The profile reports the effective flag; the stored column is untouched.
    $this->getJson('/api/v1/profile/show')->assertOk()->assertJsonPath('data.profile.quest_v2_enabled', true);
    expect($user->fresh()->quest_v2_enabled)->toBeFalse()
        ->and(UserResource::questV2Summary($user->fresh()))->toBe('Enabled for everyone (QUEST_V2_DEFAULT_ENABLED)');

    config(['deck.quest_v2_default_enabled' => false]);
    flagForbidden($this->postJson("/api/v1/quest-sessions/v2/{$sessionId}/end"));
    expect(DeckFeature::enabled(null, Deck::PRODUCT_QUEST))->toBeFalse()
        ->and(UserResource::questV2Summary($user->fresh()))->toBe('Disabled')
        ->and(UserResource::questV2Summary(DeckFactory::newOwner()))->toBe('Enabled');
});

it('reads the default from config and has no flag for products without one', function () {
    expect(config('deck.quest_v2_default_enabled'))->toBeFalse()
        ->and(DeckFeature::enabled(null, Deck::PRODUCT_QUIZ))->toBeTrue()
        ->and(DeckFeature::enabled(DeckFactory::newOwner(false), Deck::PRODUCT_QUIZ))->toBeTrue()
        ->and(DeckFeature::enabled(DeckFactory::newOwner(null)->refresh(), Deck::PRODUCT_QUEST))->toBeFalse()
        ->and(fn () => DeckFeature::assertEnabled(null, Deck::PRODUCT_QUEST))->toThrow(App\Deck\Exceptions\DeckException::class, 'Quest v2 is not enabled for your account.');
});
