<?php

use App\Http\Controllers\api\v1\Quest\QuestTaskBankController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->prefix('quest/task-bank')->group(function () {
    Route::get('/my', [QuestTaskBankController::class, 'my']);
    Route::get('/public', [QuestTaskBankController::class, 'public']);
    Route::post('/store', [QuestTaskBankController::class, 'store']);
    Route::get('/show/{id}', [QuestTaskBankController::class, 'show']);
    Route::post('/update/{id}', [QuestTaskBankController::class, 'update']);
    Route::delete('/delete/{id}', [QuestTaskBankController::class, 'destroy']);
    Route::post('/restore/{id}', [QuestTaskBankController::class, 'restore']);
});

