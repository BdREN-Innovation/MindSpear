<?php

use App\Deck\Http\Controllers\MetaController;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;

/*
| Deck API route files: DeckServiceProvider loads every routes/deck/*.php
| (sorted by name) inside Route::middleware('api')->prefix('api/v1'). Quiz and
| quest routes go through App\Deck\Http\DeckRoutes (authoring() → /quizzes,
| /quests; sessions() → /quiz-sessions, /quest-sessions). This file holds the
| product-neutral /meta lookups.
*/

// Public and cacheable: no session, so no Set-Cookie on a shared-cache response.
Route::get('meta/emoji-avatars', [MetaController::class, 'emojiAvatars'])
    ->withoutMiddleware(EnsureFrontendRequestsAreStateful::class)
    ->middleware('cache.headers:public;max_age=86400;etag')
    ->name('deck.meta.emoji-avatars');
