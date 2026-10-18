<?php

use App\Deck\Http\Controllers\LeaderboardController;
use App\Deck\Http\Controllers\Sessions\AudienceSessionController;
use App\Deck\Http\Controllers\Sessions\HostSessionController;
use App\Deck\Http\Controllers\Sessions\SessionStateController;
use App\Deck\Http\DeckRoutes;
use App\Deck\Participants\ParticipantReadAccess;
use Illuminate\Support\Facades\Route;

/*
| Quiz v2 live sessions (mirrors quest_sessions.php): start under
| /api/v1/quizzes, everything else under /api/v1/quiz-sessions/v2 (legacy
| Quiz v1 keeps /api/v1/quiz-sessions/{id}/state). Names deck.quiz.* and
| deck.quiz.sessions.*.
|
| advance also takes `reveal` and `insert_leaderboard` (SessionStateMachine). Host routes need Quiz v2
| (deck.feature, 403 feature_disabled). GET {session}/state and
| GET {session}/leaderboard serve the host (Sanctum) or a participant
| (X-Participant-Token, also after the end for the leaderboard); the
| controller decides by the header.
*/

DeckRoutes::authoring(function () {
    Route::middleware(['auth:sanctum', 'throttle:deck-author', 'deck.feature'])->group(function () {
        Route::post('{deck}/sessions', [HostSessionController::class, 'start'])
            ->whereNumber('deck')
            ->name('decks.sessions.store');
    });
}, ['quiz']);

DeckRoutes::sessions(function () {
    Route::get('by-code/{code}', [AudienceSessionController::class, 'byCode'])
        ->where('code', '[A-Za-z0-9 -]{1,32}')
        ->middleware('throttle:deck-lookup')
        ->name('by-code');

    // Host (Sanctum) or participant (X-Participant-Token); the controller decides.
    Route::get('{session}/state', [SessionStateController::class, 'show'])
        ->whereNumber('session')
        ->middleware('throttle:deck-participant')
        ->name('state');

    Route::middleware(['auth:sanctum', 'throttle:deck-author', 'deck.feature'])->group(function () {
        Route::post('{session}/advance', [HostSessionController::class, 'advance'])->whereNumber('session')->name('advance');
        Route::post('{session}/end', [HostSessionController::class, 'end'])->whereNumber('session')->name('end');
    });

    Route::get('{session}/participant-state', [SessionStateController::class, 'participantState'])
        ->whereNumber('session')
        ->middleware(['throttle:deck-participant', 'deck.participant'])
        ->name('participant-state');

    // Top N by total_points (?limit=1..100). Host (Sanctum) or participant (token; also after the end).
    Route::get('{session}/leaderboard', [LeaderboardController::class, 'show'])
        ->whereNumber('session')
        ->middleware([ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant'])
        ->name('leaderboard');
}, ['quiz']);
