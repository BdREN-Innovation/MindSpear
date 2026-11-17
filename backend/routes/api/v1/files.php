<?php

use App\Http\Controllers\api\v1\FilesController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function () {
    Route::prefix('files')->group(function () {
        Route::get('/', [FilesController::class, 'index'])->name('files.index');
        Route::get('/show/{id}', [FilesController::class, 'show'])->name('files.show');
        Route::post('/store', [FilesController::class, 'store'])->middleware('throttle:library-upload')->name('files.store');
        Route::post('/store-multiple', [FilesController::class, 'storeMultiple'])->middleware('throttle:library-upload')->name('files.store.multiple');
        Route::post('/update/{id}', [FilesController::class, 'update'])->middleware('throttle:library-upload')->name('files.update');
        Route::post('/update-multiple', [FilesController::class, 'updateMultiple'])->middleware('throttle:library-upload')->name('files.update.multiple');
        Route::delete('/delete/{id}', [FilesController::class, 'destroy'])->name('files.delete');
    });
});
