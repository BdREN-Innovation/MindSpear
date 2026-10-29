<?php

use App\Deck\Http\Controllers\DeckMediaController;
use App\Deck\Http\DeckRoutes;
use Illuminate\Support\Facades\Route;

/*
| Attach / detach My Files items (an image, or a video link):
|   PUT {authoring prefix}/{deck}/cover                                  {file_id|null}
|   PUT {authoring prefix}/{deck}/slides/{slide}/media                   {file_id|null} | {video_url|null}
|   PUT {authoring prefix}/{deck}/slides/{slide}/options/{option}/image  {file_id|null}
*/

DeckRoutes::authoring(function (string $product) {
    Route::middleware(['auth:sanctum', 'throttle:deck-author'])->group(function () {
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
