<?php

use App\Http\Controllers\api\v1\SocialAuthConfigController;
use Illuminate\Support\Facades\Route;

// OAuth client ids and secrets in .env: Super Admin only (any signed-in user could call these before).
Route::middleware(['auth:sanctum', 'super-admin'])->group(function () {
    Route::prefix('social-auth-config')->group(function () {
        // Show routes
        Route::get('google', [SocialAuthConfigController::class, 'showGoogleConfig']);
        Route::get('facebook', [SocialAuthConfigController::class, 'showFacebookConfig']);
        Route::get('microsoft', [SocialAuthConfigController::class, 'showMicrosoftConfig']);

        // Single update route
        Route::post('save', [SocialAuthConfigController::class, 'updateSocialConfig']);
    });
});
