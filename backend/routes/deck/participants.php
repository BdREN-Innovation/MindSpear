<?php

use App\Deck\Http\Controllers\ParticipantAnswerController;
use App\Deck\Http\Controllers\ParticipantJoinController;
use App\Deck\Http\Controllers\SlideRunAggregateController;
use App\Deck\Http\DeckRoutes;
use App\Deck\Http\Middleware\LimitAnswerBodySize;
use App\Deck\Http\Middleware\ResolveDeckParticipant;
use App\Deck\Participants\ParticipantReadAccess;
use Illuminate\Support\Facades\Route;

/*
| Participant side of a live session, under the product's sessions prefix
| (/api/v1/quiz-sessions, /api/v1/quest-sessions). Names:
| deck.{product}.sessions.participants.join, .participants.leave,
| .runs.answers.store, .runs.my-answer, .runs.aggregate. A join that carries
| a valid X-Participant-Token of the session is a same-device rejoin (the
| same participant, 200 rejoined: true).
|
| Token routes carry two throttles: `deck-participant` (per token hash) and
| a per-IP cap (ParticipantReadAccess::IP_THROTTLE), so a client that sends
| a fresh made-up token on every request still runs into a limit.
*/

DeckRoutes::sessions(function (string $product) {
    // Anonymous join: {join_code, display_name, emoji_avatar} → participant token.
    Route::post('{session}/participants/join', [ParticipantJoinController::class, 'store'])
        ->whereNumber('session')
        ->middleware('throttle:deck-join')
        ->name('participants.join');

    // Leave (sets left_at; the token stays valid for a same-device rejoin). Token in the header or, for sendBeacon, the body.
    Route::post('{session}/participants/leave', [ParticipantJoinController::class, 'leave'])
        ->whereNumber('session')
        ->middleware([ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant'])
        ->name('participants.leave');

    // Size cap first: an oversized body never reaches the token lookup or the validator.
    Route::post('{session}/slide-runs/{run}/answers', [ParticipantAnswerController::class, 'store'])
        ->whereNumber(['session', 'run'])
        ->middleware([ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant', LimitAnswerBodySize::class, ResolveDeckParticipant::ALIAS])
        ->name('runs.answers.store');

    // Read-only: also answers a participant of an ended session (review screen, plan §7.5).
    Route::get('{session}/slide-runs/{run}/my-answer', [ParticipantAnswerController::class, 'show'])
        ->whereNumber(['session', 'run'])
        ->middleware([ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant'])
        ->name('runs.my-answer');

    // Host (Sanctum) or participant (X-Participant-Token, also after the end); the controller decides.
    Route::get('{session}/slide-runs/{run}/aggregate', [SlideRunAggregateController::class, 'show'])
        ->whereNumber(['session', 'run'])
        ->middleware([ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant'])
        ->name('runs.aggregate');
});
