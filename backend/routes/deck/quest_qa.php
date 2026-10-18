<?php

use App\Deck\Http\Controllers\QaController;
use App\Deck\Http\DeckRoutes;
use App\Deck\Participants\ParticipantReadAccess;
use Illuminate\Support\Facades\Route;

/*
| Live audience Q&A (plan §3.1 Q&A rows, §3.4), under
| /api/v1/quest-sessions/v2 (names deck.{product}.sessions.qa.*).
|
| Participant routes authenticate with X-Participant-Token (deck.participant).
| Moderation is host-only (Sanctum). The feed serves both: with a participant
| token it is that participant's feed (also after the session ended, for the
| review screen, like my-answer and aggregate), without one the signed-in host's.
| Token routes also carry the per-IP cap (ParticipantReadAccess::IP_THROTTLE),
| since `deck-participant` keys on whatever token a request sends.
*/

DeckRoutes::sessions(function (string $product) {
    Route::middleware([ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant', 'deck.participant'])->group(function () {
        Route::post('{session}/slide-runs/{run}/qa/questions', [QaController::class, 'store'])
            ->whereNumber(['session', 'run'])
            ->name('qa.questions.store');

        Route::post('{session}/qa/questions/{question}/upvote', [QaController::class, 'upvote'])
            ->whereNumber(['session', 'question'])
            ->name('qa.questions.upvote');

        Route::delete('{session}/qa/questions/{question}/upvote', [QaController::class, 'removeUpvote'])
            ->whereNumber(['session', 'question'])
            ->name('qa.questions.upvote.destroy');
    });

    // Participant (token) or host (Sanctum); the controller picks by the X-Participant-Token header.
    Route::get('{session}/slide-runs/{run}/qa/questions', [QaController::class, 'index'])
        ->middleware([ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant'])
        ->whereNumber(['session', 'run'])
        ->name('qa.questions.index');

    Route::patch('{session}/qa/questions/{question}', [QaController::class, 'moderate'])
        ->middleware(['auth:sanctum', 'throttle:deck-author', 'deck.feature'])
        ->whereNumber(['session', 'question'])
        ->name('qa.questions.moderate');
}, ['quest']);
