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
| Quiz v2 participant routes (mirrors quest_participants.php) under
| /api/v1/quiz-sessions/v2. Answers are final: scored on submit (still 204,
| no correctness), a second one is 409 invalid_state reason already_answered;
| totals move only at the reveal. my-answer adds is_correct, points_awarded,
| correct_answer, total_points and rank once the run is revealed; aggregate
| is host-only until the reveal, then public. Leave / same-device rejoin as
| on Quest.
*/

DeckRoutes::sessions(function (string $product) {
    Route::post('{session}/participants/join', [ParticipantJoinController::class, 'store'])
        ->whereNumber('session')
        ->middleware('throttle:deck-join')
        ->name('participants.join');

    Route::post('{session}/participants/leave', [ParticipantJoinController::class, 'leave'])
        ->whereNumber('session')
        ->middleware([ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant'])
        ->name('participants.leave');

    Route::post('{session}/slide-runs/{run}/answers', [ParticipantAnswerController::class, 'store'])
        ->whereNumber(['session', 'run'])
        ->middleware([ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant', LimitAnswerBodySize::class, ResolveDeckParticipant::ALIAS])
        ->name('runs.answers.store');

    Route::get('{session}/slide-runs/{run}/my-answer', [ParticipantAnswerController::class, 'show'])
        ->whereNumber(['session', 'run'])
        ->middleware([ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant'])
        ->name('runs.my-answer');

    Route::get('{session}/slide-runs/{run}/aggregate', [SlideRunAggregateController::class, 'show'])
        ->whereNumber(['session', 'run'])
        ->middleware([ParticipantReadAccess::IP_THROTTLE, 'throttle:deck-participant'])
        ->name('runs.aggregate');
}, ['quiz']);
