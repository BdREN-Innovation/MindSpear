<?php

use App\Http\Controllers\api\v1\Quest\QuestController;
use App\Http\Controllers\api\v1\Live\LiveSessionController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function () {
    Route::prefix('quests')->group(function () {
        Route::get('/', [QuestController::class, 'index'])->name('quests.index');
        Route::get('/show/{id}', [QuestController::class, 'show'])->name('quests.show');
        Route::get('start-by-admin/{joinLink}', [QuestController::class, 'getQuestDetailsByJoinLink'])->name('quests.details.start.by.admin');
        Route::post('/store', [QuestController::class, 'store'])->name('quests.store');
        Route::post('/update/{id}', [QuestController::class, 'update'])->name('quests.update');
        Route::delete('/delete/{id}', [QuestController::class, 'destroy'])->name('quests.delete');

        // Quest copy route
        Route::post('/copy-with-tasks/{id}', [QuestController::class, 'copyWithTasks'])->name('quests.copy.with.tasks');
        Route::post('/add-my-library/{id}', [QuestController::class, 'addMyLibrary'])->name('quests.add.my.library');

        Route::post('/host-live/{id}', [QuestController::class, 'hostLive'])->name('quests.host.live');
        Route::get('/{id}/host-live-session', [LiveSessionController::class, 'questHostSession'])->name('quests.host.live.session');
        Route::get('/{id}/sessions/{sessionId}/tasks/{taskId}/form-responses', [LiveSessionController::class, 'questFormResponses'])
            ->whereNumber(['id', 'sessionId', 'taskId'])
            ->name('quests.host.live.form.responses');
        Route::post('/update-host-live/{id}', [QuestController::class, 'updateHostLive'])->name('quests.update.host.live');
        Route::post('/end-host-live/{id}', [QuestController::class, 'endLive'])->name('quests.end.live');
        Route::post('/status-host-live/{id}', [QuestController::class, 'statusLive'])->name('quests.status.live');
        Route::get('host-live-check/{userId}', [QuestController::class, 'checkHostLive'])->name('quests.check.host.live');

        Route::get('start-by-admin/{joinLink}', [QuestController::class, 'getQuestDetailsByJoinLink'])->name('quests.details.start.by.admin');
    });
});

Route::prefix('quest-sessions')->group(function () {
    Route::get('/{sessionId}/state', [LiveSessionController::class, 'questState'])->name('quest.sessions.state');
    Route::middleware('auth:sanctum')->post('/{sessionId}/change-task', [LiveSessionController::class, 'changeQuestTask'])->name('quest.sessions.change.task');
});

Route::middleware('auth:sanctum')->prefix('quests-public')->group(function () {
    Route::get('/', [QuestController::class, 'publicIndex'])->name('quests.public.index');
    Route::get('/show/{id}', [QuestController::class, 'publicShow'])->name('quests.public.show');
});

Route::prefix('quests-check')->group(function () {
    Route::get('/id/{id}', [QuestController::class, 'checkQuestById'])->name('quests.check.id');
    Route::get('/join-link/{joinLink}', [QuestController::class, 'checkQuestByJoinLink'])->name('quests.check.join.link');
    Route::get('/join-code/{joinCode}', [QuestController::class, 'checkQuestByJoinCode'])->name('quests.check.join.code');
    Route::get('/session-latest-creator/{userId}', [QuestController::class, 'checkLatestSessionByCreator'])->name('quests.check.session.latest.creator');
});
