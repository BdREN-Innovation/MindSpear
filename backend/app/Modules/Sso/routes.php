<?php

use App\Modules\Sso\Http\Controllers\SsoController;
use Illuminate\Support\Facades\Route;

// Mounted at /api/v1/sso by SsoServiceProvider.

Route::name('sso.')->group(function () {
    Route::get('config', [SsoController::class, 'config'])->name('config');
    Route::post('login', [SsoController::class, 'login'])->middleware('throttle:sso')->name('login');
    Route::post('callback', [SsoController::class, 'callback'])->middleware('throttle:sso')->name('callback');
    // Not throttled: every notice comes from BDREN's server, and a dropped one would leave a sign-in open.
    Route::post('backchannel-logout', [SsoController::class, 'backchannelLogout'])->name('backchannel-logout');

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('status', [SsoController::class, 'status'])->name('status');
        Route::post('link', [SsoController::class, 'link'])->middleware('throttle:sso')->name('link');
        Route::delete('link', [SsoController::class, 'unlink'])->name('unlink');
        Route::get('entitlements', [SsoController::class, 'entitlements'])->name('entitlements');
    });
});
