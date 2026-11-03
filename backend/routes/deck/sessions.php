<?php

use App\Deck\Http\Controllers\LeaderboardController;
use App\Deck\Http\Controllers\Sessions\AudienceSessionController;
use App\Deck\Http\Controllers\Sessions\HostSessionController;
use App\Deck\Http\Controllers\Sessions\SessionStateController;
use App\Deck\Http\DeckRoutes;
use App\Deck\Participants\ParticipantReadAccess;
use Illuminate\Support\Facades\Route;

/*
| Live sessions: start (under the authoring prefix), join-code lookup, state
| resync, host transitions, end, who is in the room (host), and the quiz leaderboard. Names
| deck.{product}.decks.sessions.store and deck.{product}.sessions.*.
|
| Host routes use Sanctum + throttle:deck-author and answer 404 for anyone
| but the host. by-code is public and throttled per IP (deck-lookup), never
| per token. advance also takes `reveal` and `insert_leaderboard` on quizzes
| (SessionStateMachine).
|
| GET {session}/state is the one resync snapshot for both callers: with
| X-Participant-Token the participant's view, otherwise the Sanctum host's
| (the controller decides, like the aggregate, leaderboard and Q&A feed
| routes). GET {session}/participant-state is a participant-only alias.
*/

DeckRoutes::authoring(function () {
    Route::middleware(['auth:sanctum', 'throttle:deck-author'])->group(function () {
        Route::post('{deck}/sessions', [HostSessionController::class, 'start'])
            ->whereNumber('deck')
            ->name('decks.sessions.store');
    });
});

DeckRoutes::sessions(function () {
    Route::get('by-code/{code}', [AudienceSessionController::class, 'byCode'])
        ->where('code', '[A-Za-z0-9 -]{1,32}')
        ->middleware('throttle:deck-lookup')
        ->name('by-code');

    // Host (Sanctum) or participant (X-Participant-Token); the controller decides.
    Route::get('{session}/state', [SessionStateController::class, 'show'])
        ->whereNumber('session')
        ->middleware('throttle:deck-participant')
        ->name('state');

    Route::middleware(['auth:sanctum', 'throttle:deck-author'])->group(function () {
        Route::post('{session}/advance', [HostSessionController::class, 'advance'])->whereNumber('session')->name('advance');
        Route::post('{session}/end', [HostSessionController::class, 'end'])->whereNumber('session')->name('end');
        Route::get('{session}/participants', [HostSessionController::class, 'participants'])->whereNumber('session')->name('participants');
    });

    Route::get('{session}/participant-state', [SessionStateController::class, 'participantState'])
        ->whereNumber('session')
        ->middleware(['throttle:deck-participant', 'deck.participant'])
        ->name('participant-state');
});

// Quizzes only: the leaderboard.
DeckRoutes::sessions(function () {
    // Top N by total_points (?limit=1..100). Host (Sanctum) or participant (token; also after the end).
    Route::get('{session}/leaderboard', [LeaderboardController::class, 'show'])
        ->whereNumber('session')
        ->middleware([ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant'])
        ->name('leaderboard');
}, ['quiz']);
