<?php

use App\Http\Controllers\api\v1\InstitutionController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function () {
    Route::prefix('institutions')->group(function () {
        Route::get('/', [InstitutionController::class, 'index'])->name('institutions.index');
        Route::get('/show/{id}', [InstitutionController::class, 'show'])->name('institutions.show');
        // Institutions are shared, admin-managed records: only the Super Admin changes them.
        Route::middleware('super-admin')->group(function () {
            Route::post('/store', [InstitutionController::class, 'store'])->name('institutions.store');
            Route::post('/update/{id}', [InstitutionController::class, 'update'])->name('institutions.update');
            Route::delete('/delete/{id}', [InstitutionController::class, 'destroy'])->name('institutions.delete');
        });
    });
});
