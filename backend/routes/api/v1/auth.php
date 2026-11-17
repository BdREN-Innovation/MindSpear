<?php

use App\Http\Controllers\api\v1\AuthenticationController;
use Illuminate\Support\Facades\Route;

// 🔐 Public routes
Route::post('/register', [AuthenticationController::class, 'register']);
Route::post('/login', [AuthenticationController::class, 'login']);
Route::post('/forgot-password', [AuthenticationController::class, 'forgotPassword']);
Route::post('/forgot-password-resend', [AuthenticationController::class, 'forgotPasswordResend']);
Route::post('/reset-password', [AuthenticationController::class, 'resetPassword']);
Route::post('/verify-email', [AuthenticationController::class, 'verifyEmail']);
Route::post('/resend-verification', [AuthenticationController::class, 'resendVerificationEmail'])->middleware('throttle:resend-verification');

// 🔒 Protected routes using Sanctum tokens
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/user-check', [AuthenticationController::class, 'user']);
    Route::post('/logout', [AuthenticationController::class, 'logout']);
});

