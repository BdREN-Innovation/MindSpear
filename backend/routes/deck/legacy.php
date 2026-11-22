<?php

use App\Deck\Legacy\LegacyResults;
use App\Deck\Legacy\LegacyResultsController;
use Illuminate\Support\Facades\Route;

/*
| Past results: /api/v1/legacy-results/... (names legacy-results.*). Read-only results of
| the previous version's quizzes and quests for their owner; see App\Deck\Legacy\LegacyResults.
*/

Route::middleware('auth:sanctum')->prefix('legacy-results')->name('legacy-results.')->group(function () {
    $source = implode('|', LegacyResults::sources());

    Route::get('/', [LegacyResultsController::class, 'index'])->name('index');
    Route::get('{source}/{id}', [LegacyResultsController::class, 'show'])
        ->where(['source' => $source, 'id' => '[0-9]+'])->name('show');
    Route::get('{source}/{id}/sessions/{session}', [LegacyResultsController::class, 'session'])
        ->where(['source' => $source, 'id' => '[0-9]+', 'session' => '[0-9]+|' . LegacyResults::NO_SESSION])->name('session');
    Route::get('{source}/{id}/sessions/{session}/export', [LegacyResultsController::class, 'export'])
        ->where(['source' => $source, 'id' => '[0-9]+', 'session' => '[0-9]+|' . LegacyResults::NO_SESSION])->name('export');
});
