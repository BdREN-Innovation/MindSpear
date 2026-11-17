<?php

use App\Http\Controllers\api\v1\Quiz\QuestionBankController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->prefix('quiz/question-bank')->group(function () {
    Route::get('/my', [QuestionBankController::class, 'my'])->name('quiz.question-bank.my');
    Route::get('/public', [QuestionBankController::class, 'public'])->name('quiz.question-bank.public');
    Route::post('/check-duplicate', [QuestionBankController::class, 'checkDuplicate'])->name('quiz.question-bank.check-duplicate');
    Route::post('/store', [QuestionBankController::class, 'store'])->name('quiz.question-bank.store');
    Route::get('/show/{id}', [QuestionBankController::class, 'show'])->name('quiz.question-bank.show');
    Route::post('/update/{id}', [QuestionBankController::class, 'update'])->name('quiz.question-bank.update');
    Route::delete('/delete/{id}', [QuestionBankController::class, 'destroy'])->name('quiz.question-bank.delete');
    Route::post('/restore/{id}', [QuestionBankController::class, 'restore'])->name('quiz.question-bank.restore');
});
