<?php

use App\Modules\FunGame\Http\Controllers\HostGameController;
use App\Modules\FunGame\Http\Controllers\HostImportController;
use App\Modules\FunGame\Http\Controllers\HostQuestionController;
use App\Modules\FunGame\Http\Controllers\HostSessionController;
use App\Modules\FunGame\Http\Controllers\ParticipantSessionController;
use App\Modules\FunGame\Http\Controllers\PublicJoinController;
use Illuminate\Support\Facades\Route;

// Mounted at /api/v1/fun-games by FunGameServiceProvider.

Route::middleware('auth:sanctum')->prefix('host')->name('fungames.host.')->group(function () {
    Route::get('games', [HostGameController::class, 'index'])->name('games.index');
    Route::post('games', [HostGameController::class, 'store'])->name('games.store');
    Route::get('games/{game}', [HostGameController::class, 'show'])->whereNumber('game')->name('games.show');
    Route::patch('games/{game}', [HostGameController::class, 'update'])->whereNumber('game')->name('games.update');
    Route::delete('games/{game}', [HostGameController::class, 'destroy'])->whereNumber('game')->name('games.destroy');
    Route::post('games/{game}/duplicate', [HostGameController::class, 'duplicate'])->whereNumber('game')->name('games.duplicate');
    Route::post('games/{game}/publish', [HostGameController::class, 'publish'])->whereNumber('game')->name('games.publish');

    Route::get('library-quizzes', [HostImportController::class, 'libraryQuizzes'])->name('library.index');
    Route::get('library-quizzes/{quiz}/preview', [HostImportController::class, 'libraryPreview'])->whereNumber('quiz')->name('library.preview');
    Route::post('games/from-library', [HostImportController::class, 'createFromLibrary'])->name('games.from_library');
    Route::post('games/{game}/import', [HostImportController::class, 'store'])->whereNumber('game')->name('games.import');
    Route::post('imports/{import}/undo', [HostImportController::class, 'undo'])->whereNumber('import')->name('imports.undo');

    Route::post('games/{game}/questions', [HostQuestionController::class, 'store'])->whereNumber('game')->name('questions.store');
    Route::put('games/{game}/questions/order', [HostQuestionController::class, 'reorder'])->whereNumber('game')->name('questions.reorder');
    Route::patch('games/{game}/questions/{question}', [HostQuestionController::class, 'update'])->whereNumber(['game', 'question'])->name('questions.update');
    Route::delete('games/{game}/questions/{question}', [HostQuestionController::class, 'destroy'])->whereNumber(['game', 'question'])->name('questions.destroy');

    Route::post('games/{game}/sessions', [HostSessionController::class, 'store'])->whereNumber('game')->name('sessions.store');
    Route::get('sessions', [HostSessionController::class, 'index'])->name('sessions.index');
    Route::get('sessions/{session}', [HostSessionController::class, 'show'])->whereNumber('session')->name('sessions.show');
    Route::post('sessions/{session}/start', [HostSessionController::class, 'start'])->whereNumber('session')->name('sessions.start');
    Route::post('sessions/{session}/end', [HostSessionController::class, 'end'])->whereNumber('session')->name('sessions.end');
    Route::get('sessions/{session}/leaderboard', [HostSessionController::class, 'leaderboard'])->whereNumber('session')->name('sessions.leaderboard');
    Route::get('sessions/{session}/participants', [HostSessionController::class, 'participants'])->whereNumber('session')->name('sessions.participants');
});

// Participants: no login. Join with name + email, then use the returned X-Participant-Token.
Route::get('join/{joinCode}', [PublicJoinController::class, 'show'])
    ->middleware('throttle:fungame-participant')->name('fungames.join.show');
Route::post('join/{joinCode}', [PublicJoinController::class, 'join'])
    ->middleware('throttle:fungame-join')->name('fungames.join');

Route::prefix('sessions/{session}')->whereNumber('session')
    ->middleware('throttle:fungame-participant')
    ->name('fungames.participant.')
    ->group(function () {
        Route::get('state', [ParticipantSessionController::class, 'state'])->name('state');
        Route::get('current', [ParticipantSessionController::class, 'current'])->name('current');
        Route::post('answers', [ParticipantSessionController::class, 'answer'])->name('answer');
        Route::get('results/me', [ParticipantSessionController::class, 'myResult'])->name('result');
        Route::get('leaderboard', [ParticipantSessionController::class, 'leaderboard'])->name('leaderboard');
    });
