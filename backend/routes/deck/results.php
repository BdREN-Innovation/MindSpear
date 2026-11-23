<?php

use App\Deck\Http\Controllers\Sessions\SessionResultsController;
use App\Deck\Http\DeckRoutes;
use Illuminate\Support\Facades\Route;

/*
| My Library > a quiz / quest > its past sessions and their results (deck owner who
| hosted them; everyone else 404). Names deck.{product}.decks.sessions.index and
| deck.{product}.sessions.results(.export).
*/

DeckRoutes::authoring(function () {
    Route::middleware(['auth:sanctum', 'throttle:deck-author'])->group(function () {
        Route::get('{deck}/sessions', [SessionResultsController::class, 'index'])
            ->whereNumber('deck')
            ->name('decks.sessions.index');
    });
});

DeckRoutes::sessions(function () {
    Route::middleware(['auth:sanctum', 'throttle:deck-author'])->group(function () {
        Route::get('{session}/results', [SessionResultsController::class, 'show'])
            ->whereNumber('session')
            ->name('results');
        Route::get('{session}/results/export', [SessionResultsController::class, 'export'])
            ->whereNumber('session')
            ->name('results.export');
    });
});
