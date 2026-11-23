<?php

use App\Http\Controllers\api\v1\PreferenceController;
use Illuminate\Support\Facades\Route;

// Global site settings: the Super Admin only (the public endpoints below stay for the website).
Route::middleware(['auth:sanctum', 'super-admin'])->group(function () {
    Route::prefix('preferences')->group(function () {
        Route::get('/', [PreferenceController::class, 'index'])->name('preferences.index');
        Route::get('/grouped/{filter}', [PreferenceController::class, 'grouped'])->name('preferences.grouped');
        Route::post('/store', [PreferenceController::class, 'store'])->name('preferences.store');
        Route::post('/bulk-store', [PreferenceController::class, 'bulkStore'])->name('preferences.bulkStore');
        Route::get('/show/{category}/{field}', [PreferenceController::class, 'show'])->name('preferences.show');
        Route::post('/update/{category}/{field}', [PreferenceController::class, 'update'])->name('preferences.update');
        Route::post('/bulk-update', [PreferenceController::class, 'bulkUpdate'])->name('preferences.bulkUpdate');
        Route::delete('/delete/{category}/{field}', [PreferenceController::class, 'destroy'])->name('preferences.delete');
        Route::post('/bulk-delete', [PreferenceController::class, 'bulkDelete'])->name('preferences.bulkDelete');
    });
});

// Add this outside the auth:sanctum group
Route::prefix('public/preferences')->group(function () {
    // Get a single preference value by category and field
    Route::get('/{category}/{field}', [PreferenceController::class, 'showPublic'])->name('preferences.public.show');

    // Get all preferences in a category
    Route::get('/category/{category}', [PreferenceController::class, 'byCategory'])->name('preferences.public.byCategory');

    // Get specific fields from a category (comma-separated)
    Route::get('/category/{category}/fields/{fields}', [PreferenceController::class, 'specificFields'])
        ->name('preferences.public.specificFields');
});
