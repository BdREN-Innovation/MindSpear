<?php

use App\Deck\Support\DeckFeature;
use App\Filament\Resources\UserResource;
use App\Models\Deck\Deck;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Testing\TestResponse;

require_once __DIR__ . '/QuizApiHelpers.php';

/*
 * Quiz v2 rollout flag (QUIZ_REDESIGN_PLAN.md §2.4, Amendments): gated
 * exactly like Quest v2. users.quiz_v2_enabled or QUIZ_V2_DEFAULT_ENABLED
 * (config deck.quiz_v2_default_enabled) for authoring and hosting; 403
 * feature_disabled otherwise. Participants are never gated.
 */

uses(DatabaseTransactions::class);

beforeEach(fn () => qapiSetUp());

function qflagForbidden(TestResponse $response): void
{
    $response->assertForbidden()
        ->assertJsonPath('data.code', 'feature_disabled')
        ->assertJsonPath('message', 'Quiz v2 is not enabled for your account.');
}

it('refuses authoring and hosting without Quiz v2 and keeps signed-out at 401', function () {
    $user = qapiOwner(quiz: false);
    $deck = Deck::factory()->quiz()->ownedBy($user)->create();

    qapiAsGuest();
    $this->getJson(QAPI_AUTHOR)->assertUnauthorized();

    qapiAsHost($user);
    qflagForbidden($this->getJson(QAPI_AUTHOR));
    qflagForbidden($this->postJson(QAPI_AUTHOR, ['title' => 'Nope']));
    qflagForbidden($this->getJson(QAPI_AUTHOR . "/{$deck->id}"));
    qflagForbidden($this->postJson(QAPI_AUTHOR . "/{$deck->id}/slides", ['type' => 'pick_answer_single']));
    qflagForbidden($this->postJson(QAPI_AUTHOR . "/{$deck->id}/slides/bulk", ['slides' => [['type' => 'pick_answer_single']]]));
    qflagForbidden($this->putJson(QAPI_AUTHOR . "/{$deck->id}/cover", ['file_id' => null]));
    qflagForbidden($this->postJson(QAPI_AUTHOR . "/{$deck->id}/sessions"));
    // Checked before any lookup: a deck that does not exist is still 403.
    qflagForbidden($this->getJson(QAPI_AUTHOR . '/999999999'));

    expect(Deck::query()->where('owner_id', $user->id)->count())->toBe(1);
});

it('gates the host side of a live quiz session but never its participants', function () {
    $host = qapiOwner();
    $deck = qapiCreateQuiz($host);
    qapiAppend($host, $deck['id'], 'pick_answer_single');
    $state = qapiStart($host, $deck['id']);
    $sessionId = $state['session_id'];
    [$player] = qapiJoin($state, ['Ada']);

    // The flag is switched off mid-session.
    $host->forceFill(['quiz_v2_enabled' => false])->save();

    qapiAsHost($host);
    qflagForbidden($this->postJson(QAPI_SESSIONS . "/{$sessionId}/advance", ['action' => 'next_slide']));
    qflagForbidden($this->getJson(QAPI_SESSIONS . "/{$sessionId}/state"));
    qflagForbidden($this->getJson(QAPI_SESSIONS . "/{$sessionId}/leaderboard"));
    qflagForbidden($this->getJson(QAPI_SESSIONS . "/{$sessionId}/slide-runs/{$state['session']['current_slide_run_id']}/aggregate"));
    qflagForbidden($this->postJson(QAPI_SESSIONS . "/{$sessionId}/end"));

    // Participants: by-code, join, state, leaderboard.
    qapiAsGuest();
    $this->getJson(QAPI_SESSIONS . '/by-code/' . $state['join_code'])->assertOk();
    qapiJoin($state, ['Grace']);
    qapiState($sessionId, $player['token'])->assertOk()->assertJsonPath('data.participant.id', $player['id']);
    qapiLeaderboard($sessionId, $player['token'])->assertOk()->assertJsonPath('data.me.participant_id', $player['id']);

    // Back on: the host carries on.
    $host->forceFill(['quiz_v2_enabled' => true])->save();
    qapiAdvance($host, $sessionId, ['action' => 'next_slide'])->assertOk();
});

it('keeps the Quest and Quiz flags apart', function () {
    $questOnly = qapiOwner(quiz: false);
    qapiAsHost($questOnly);
    $this->getJson('/api/v1/quests/v2')->assertOk();
    qflagForbidden($this->getJson(QAPI_AUTHOR));

    $quizOnly = DeckFactory::newOwner(false);
    $quizOnly->forceFill(['quiz_v2_enabled' => true])->save();
    qapiAsHost($quizOnly->refresh());
    $this->getJson(QAPI_AUTHOR)->assertOk();
    $this->getJson('/api/v1/quests/v2')->assertForbidden()
        ->assertJsonPath('data.code', 'feature_disabled')
        ->assertJsonPath('message', 'Quest v2 is not enabled for your account.');
});

it('turns Quiz v2 on for everyone with the config default and reports the effective flag', function () {
    $user = qapiOwner(quiz: false);
    qapiAsHost($user);

    $this->getJson('/api/v1/profile/show')->assertOk()
        ->assertJsonPath('data.profile.quiz_v2_enabled', false)
        ->assertJsonPath('data.profile.quest_v2_enabled', true);
    expect(UserResource::quizV2Summary($user))->toBe('Disabled')
        ->and(DeckFeature::enabled($user, Deck::PRODUCT_QUIZ))->toBeFalse();

    config(['deck.quiz_v2_default_enabled' => true]);

    $this->getJson(QAPI_AUTHOR)->assertOk();
    $this->postJson(QAPI_AUTHOR, ['title' => 'Everyone'])->assertCreated();
    $this->getJson('/api/v1/profile/show')->assertOk()->assertJsonPath('data.profile.quiz_v2_enabled', true);

    // The stored column is untouched; the summary explains why it is on.
    expect($user->fresh()->quiz_v2_enabled)->toBeFalse()
        ->and(UserResource::quizV2Summary($user->fresh()))->toBe('Enabled for everyone (QUIZ_V2_DEFAULT_ENABLED)')
        ->and(UserResource::quizV2Summary(qapiOwner()))->toBe('Enabled')
        ->and(DeckFeature::enabled(null, Deck::PRODUCT_QUIZ))->toBeTrue();
});

it('stores the flag as a boolean column defaulting to false and never takes it from profile input', function () {
    $user = DeckFactory::newOwner(null)->refresh();
    expect($user->quiz_v2_enabled)->toBeFalse();

    qapiAsHost($user);
    $this->putJson('/api/v1/profile/update', ['first_name' => 'Still', 'quiz_v2_enabled' => true]);

    expect($user->fresh()->quiz_v2_enabled)->toBeFalse();
});
