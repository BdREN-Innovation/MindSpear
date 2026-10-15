<?php

use App\Deck\Http\Controllers\Sessions\AudienceSessionController;
use App\Deck\Http\Controllers\Sessions\HostSessionController;
use App\Deck\Http\Controllers\Sessions\SessionStateController;
use App\Deck\Http\DeckRoutes;
use Illuminate\Support\Facades\Route;

/*
| Live sessions: start, join-code lookup, state resync, host transitions, end.
| Loaded by DeckServiceProvider inside the api group under /api/v1, once per
| product in config('deck.routes') (Quest: /quests/v2 and /quest-sessions/v2).
|
| Host routes use Sanctum + throttle:deck-author + deck.feature (403
| feature_disabled without Quest v2) and answer 404 for anyone but the host.
| by-code is public and throttled per IP (deck-lookup), never per token.
|
| GET {session}/state is the one resync snapshot for both callers: with
| X-Participant-Token the participant's view, otherwise the Sanctum host's
| (the controller decides, like the aggregate and Q&A feed routes; their host
| branch checks the Quest v2 flag). GET {session}/participant-state is a
| participant-only alias.
*/

DeckRoutes::authoring(function () {
    Route::middleware(['auth:sanctum', 'throttle:deck-author', 'deck.feature'])->group(function () {
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

    Route::middleware(['auth:sanctum', 'throttle:deck-author', 'deck.feature'])->group(function () {
        Route::post('{session}/advance', [HostSessionController::class, 'advance'])->whereNumber('session')->name('advance');
        Route::post('{session}/end', [HostSessionController::class, 'end'])->whereNumber('session')->name('end');
    });

    Route::get('{session}/participant-state', [SessionStateController::class, 'participantState'])
        ->whereNumber('session')
        ->middleware(['throttle:deck-participant', 'deck.participant'])
        ->name('participant-state');
});
