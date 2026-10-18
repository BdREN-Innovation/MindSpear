<?php

use App\Deck\Http\Controllers\ParticipantReviewController;
use App\Deck\Http\DeckRoutes;
use App\Deck\Participants\ParticipantReadAccess;
use Illuminate\Support\Facades\Route;

/*
| Quiz v2 post-session review (mirrors quest_review.php):
| GET /api/v1/quiz-sessions/v2/{session}/review, named deck.quiz.sessions.review.
*/

DeckRoutes::sessions(function (string $product) {
    Route::get('{session}/review', [ParticipantReviewController::class, 'show'])
        ->whereNumber('session')
        ->middleware([ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant'])
        ->name('review');
}, ['quiz']);
