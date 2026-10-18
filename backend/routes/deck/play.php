<?php

use App\Deck\Http\Controllers\Sessions\AudienceSessionController;
use Illuminate\Support\Facades\Route;

/*
| Product-neutral participant entry (loaded by DeckServiceProvider inside
| api + /api/v1). The join page looks a code up once and gets the product
| (quest | quiz) back, then uses that product's session routes.
| Public, throttled per IP like the per-product by-code routes.
*/

Route::get('play/by-code/{code}', [AudienceSessionController::class, 'byCodeAnyProduct'])
    ->where('code', '[A-Za-z0-9 -]{1,32}')
    ->middleware('throttle:deck-lookup')
    ->name('deck.play.by-code');
