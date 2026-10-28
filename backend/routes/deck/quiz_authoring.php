<?php

use App\Deck\Http\Controllers\Authoring\DeckAuthoringController;
use App\Deck\Http\Controllers\Authoring\PublicDeckController;
use App\Deck\Http\Controllers\Authoring\SlideAuthoringController;
use App\Deck\Http\Controllers\Authoring\SlideOptionController;
use App\Deck\Http\DeckRoutes;
use Illuminate\Support\Facades\Route;

/*
| Quiz v2 authoring API (QUIZ_REDESIGN_PLAN.md §2.1): the Quest authoring
| routes (quest_authoring.php) under /api/v1/quizzes with names deck.quiz.*
| and product = quiz. Same controllers; the product decides the slide types
| on offer and the quiz-only fields (slides: points_min, points_max,
| speed_bonus_enabled; options: is_correct), which quest routes refuse.
| `deck.feature`: 403 feature_disabled unless the user has Quiz v2
| (users.quiz_v2_enabled or QUIZ_V2_DEFAULT_ENABLED).
*/

DeckRoutes::authoring(function (string $product) {
    Route::middleware(['auth:sanctum', 'throttle:deck-author', 'deck.feature'])->group(function () {
        Route::get('/', [DeckAuthoringController::class, 'index'])->name('decks.index');
        Route::post('/', [DeckAuthoringController::class, 'store'])->name('decks.store');
        Route::get('{deck}', [DeckAuthoringController::class, 'show'])->whereNumber('deck')->name('decks.show');
        Route::patch('{deck}', [DeckAuthoringController::class, 'update'])->whereNumber('deck')->name('decks.update');
        Route::delete('{deck}', [DeckAuthoringController::class, 'destroy'])->whereNumber('deck')->name('decks.destroy');
        Route::post('{deck}/duplicate', [DeckAuthoringController::class, 'duplicate'])->whereNumber('deck')->name('decks.duplicate');

        // Discover: everyone's public decks, a preview, and copying one into your library.
        Route::get('public', [PublicDeckController::class, 'index'])->name('decks.public.index');
        Route::get('public/{deck}', [PublicDeckController::class, 'show'])->whereNumber('deck')->name('decks.public.show');
        Route::post('public/{deck}/copy', [PublicDeckController::class, 'copy'])->whereNumber('deck')->name('decks.public.copy');

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
}, ['quiz']);
