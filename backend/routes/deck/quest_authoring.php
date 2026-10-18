<?php

use App\Deck\Http\Controllers\Authoring\DeckAuthoringController;
use App\Deck\Http\Controllers\Authoring\SlideAuthoringController;
use App\Deck\Http\Controllers\Authoring\SlideOptionController;
use App\Deck\Http\DeckRoutes;
use Illuminate\Support\Facades\Route;

/*
| Deck authoring API (plan §2.1, §5.7 bulk) for Quest: /api/v1/quests/v2/...
| with names deck.quest.*. The controllers read the product from the route;
| Quiz v2 mirrors these routes in quiz_authoring.php. Media / cover / option-image attach routes
| live in their own route file. `deck.feature`: 403 feature_disabled unless
| the user has the product's v2 (App\Deck\Support\DeckFeature).
*/

DeckRoutes::authoring(function (string $product) {
    Route::middleware(['auth:sanctum', 'throttle:deck-author', 'deck.feature'])->group(function () {
        Route::get('/', [DeckAuthoringController::class, 'index'])->name('decks.index');
        Route::post('/', [DeckAuthoringController::class, 'store'])->name('decks.store');
        Route::get('{deck}', [DeckAuthoringController::class, 'show'])->whereNumber('deck')->name('decks.show');
        Route::patch('{deck}', [DeckAuthoringController::class, 'update'])->whereNumber('deck')->name('decks.update');
        Route::delete('{deck}', [DeckAuthoringController::class, 'destroy'])->whereNumber('deck')->name('decks.destroy');
        Route::post('{deck}/duplicate', [DeckAuthoringController::class, 'duplicate'])->whereNumber('deck')->name('decks.duplicate');

        Route::post('{deck}/slides', [SlideAuthoringController::class, 'store'])->whereNumber('deck')->name('slides.store');
        Route::post('{deck}/slides/reorder', [SlideAuthoringController::class, 'reorder'])->whereNumber('deck')->name('slides.reorder');
        Route::post('{deck}/slides/bulk', [SlideAuthoringController::class, 'bulk'])->whereNumber('deck')->name('slides.bulk');
        Route::get('{deck}/slides/{slide}', [SlideAuthoringController::class, 'show'])->whereNumber(['deck', 'slide'])->name('slides.show');
        Route::patch('{deck}/slides/{slide}', [SlideAuthoringController::class, 'update'])->whereNumber(['deck', 'slide'])->name('slides.update');
        Route::delete('{deck}/slides/{slide}', [SlideAuthoringController::class, 'destroy'])->whereNumber(['deck', 'slide'])->name('slides.destroy');
        Route::post('{deck}/slides/{slide}/duplicate', [SlideAuthoringController::class, 'duplicate'])->whereNumber(['deck', 'slide'])->name('slides.duplicate');

        Route::post('{deck}/slides/{slide}/options', [SlideOptionController::class, 'store'])->whereNumber(['deck', 'slide'])->name('options.store');
        Route::post('{deck}/slides/{slide}/options/reorder', [SlideOptionController::class, 'reorder'])->whereNumber(['deck', 'slide'])->name('options.reorder');
        Route::patch('{deck}/slides/{slide}/options/{option}', [SlideOptionController::class, 'update'])->whereNumber(['deck', 'slide', 'option'])->name('options.update');
        Route::delete('{deck}/slides/{slide}/options/{option}', [SlideOptionController::class, 'destroy'])->whereNumber(['deck', 'slide', 'option'])->name('options.destroy');
    });
}, ['quest']);
