<?php

use App\Deck\Http\Controllers\ParticipantReviewController;
use App\Deck\Http\DeckRoutes;
use App\Deck\Participants\ParticipantReadAccess;
use Illuminate\Support\Facades\Route;

/*
| Post-session review for participants (plan §7.5), under the product's
| sessions prefix: GET /api/v1/quest-sessions/v2/{session}/review, named
| deck.{product}.sessions.review. X-Participant-Token, resolved like
| my-answer / aggregate (ParticipantReadAccess: also the token the session
| end revoked). Ended sessions only.
*/

DeckRoutes::sessions(function (string $product) {
    Route::get('{session}/review', [ParticipantReviewController::class, 'show'])
        ->whereNumber('session')
        ->middleware([ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant'])
        ->name('review');
}, ['quest']);
