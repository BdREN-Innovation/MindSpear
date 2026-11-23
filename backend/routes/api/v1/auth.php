<?php

use App\Http\Controllers\api\v1\AuthenticationController;
use Illuminate\Support\Facades\Route;

// 🔐 Public routes
Route::post('/register', [AuthenticationController::class, 'register']);
Route::post('/login', [AuthenticationController::class, 'login'])->middleware('throttle:login');
Route::post('/forgot-password', [AuthenticationController::class, 'forgotPassword'])->middleware('throttle:password-reset');
Route::post('/forgot-password-resend', [AuthenticationController::class, 'forgotPasswordResend'])->middleware('throttle:password-reset');
Route::post('/reset-password', [AuthenticationController::class, 'resetPassword'])->middleware('throttle:password-reset');
Route::post('/verify-email', [AuthenticationController::class, 'verifyEmail'])->middleware('throttle:password-reset');
Route::post('/resend-verification', [AuthenticationController::class, 'resendVerificationEmail'])->middleware('throttle:resend-verification');

// 🔒 Protected routes using Sanctum tokens
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/user-check', [AuthenticationController::class, 'user']);
    Route::post('/logout', [AuthenticationController::class, 'logout']);
});

