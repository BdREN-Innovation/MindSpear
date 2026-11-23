<?php

use App\Http\Controllers\api\v1\LogController;
use Illuminate\Support\Facades\Route;

// Server log files: Super Admin only (any signed-in user could call these before).
Route::middleware(['auth:sanctum', 'super-admin'])->group(function () {
    Route::prefix('logs')->group(function () {
        Route::get('/', [LogController::class, 'index'])->name('logs.index');
        Route::get('/files/{filename}', [LogController::class, 'fileLogs'])->name('logs.files');
        Route::get('/daily', [LogController::class, 'dailyLogs'])->name('logs.daily');
        Route::get('/channels/{channel}', [LogController::class, 'channelLogs'])->name('logs.channels');
        Route::get('/list-files', [LogController::class, 'listLogFiles'])->name('logs.listFiles');
        Route::get('/download/{filename}', [LogController::class, 'download'])->name('logs.download');
        Route::get('/latest', [LogController::class, 'latestLogs'])->name('logs.latest');
    });
});
