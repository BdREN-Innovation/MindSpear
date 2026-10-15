<?php

use App\Deck\Http\Controllers\DeckMediaController;
use App\Deck\Http\DeckRoutes;
use Illuminate\Support\Facades\Route;

/*
| Deck media (plan §1.9, §2.1, §2.3): attach / detach My Files items.
|   PUT /api/v1/quests/v2/{deck}/cover                                  {file_id|null}
|   PUT /api/v1/quests/v2/{deck}/slides/{slide}/media                   {file_id|null} | {video_url|null}
|   PUT /api/v1/quests/v2/{deck}/slides/{slide}/options/{option}/image  {file_id|null}
| Registered for every product in config('deck.routes'), so Quiz v2 gets
| them under its own prefix without changes here.
*/

DeckRoutes::authoring(function (string $product) {
    Route::middleware(['auth:sanctum', 'throttle:deck-author', 'deck.feature'])->group(function () {
        Route::put('{deck}/cover', [DeckMediaController::class, 'cover'])
            ->whereNumber('deck')
            ->name('decks.cover');

        Route::put('{deck}/slides/{slide}/media', [DeckMediaController::class, 'slideMedia'])
            ->whereNumber(['deck', 'slide'])
            ->name('slides.media');

        Route::put('{deck}/slides/{slide}/options/{option}/image', [DeckMediaController::class, 'optionImage'])
            ->whereNumber(['deck', 'slide', 'option'])
            ->name('slides.options.image');
    });
});
