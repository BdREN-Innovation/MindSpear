<?php

namespace App\Http\Controllers\api\v1;

use App\Http\Requests\Authentication\ForgotPasswordRequest;
use App\Http\Requests\Authentication\LoginRequest;
use App\Http\Requests\Authentication\RegisterRequest;
use App\Http\Requests\Authentication\ResendVerificationEmailRequest;
use App\Http\Requests\Authentication\ResetPasswordRequest;
use App\Http\Requests\Authentication\VerifyEmailRequest;
use App\Mail\PasswordResetMail;
use App\Mail\VerifyEmailMail;
use App\Models\PasswordResetToken;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class AuthenticationController extends ApiBaseController
{
    /**
     * Register a new user.
     */
    public function register(RegisterRequest $request): JsonResponse
    {
        DB::beginTransaction();

        try {
            $validatedData = $request->validated();
            $existingUser = User::where('email', $validatedData['email'])->first();

            if ($existingUser) {
                return $this->badRequestResponse([], __('User already exists'));
            }

            $verificationToken = Str::random(60);
            $user = User::create([
                'first_name' => $validatedData['first_name'],
                'last_name' => $validatedData['last_name'],
                'email' => $validatedData['email'],
                'password' => bcrypt($validatedData['password']),
                'email_verification_token' => $verificationToken,
            ]);

            // Send the verification email in try-catch
            try {
                Mail::to($user->email)->send(new VerifyEmailMail($verificationToken, $user->email));
                $emailSent = true;
            } catch (\Exception $emailException) {
                // Log email sending error but don't throw it
                try {
                    Log::error('Email sending failed for user registration: ' . $emailException->getMessage());
                } catch (\Exception $logException) {
                    // Silently fail if logging also fails
                }
                $emailSent = false;
            }

            // Commit the transaction
            DB::commit();

            // Return success response even if email failed
            $message = $emailSent
                ? __('User registered successfully. Please check your email to verify your account.')
                : __('User registered successfully. However, we could not send the verification email. Please contact support.');

            return $this->createdResponse([
                'user' => $user,
                'email_sent' => $emailSent,
            ], $message);

        } catch (\Exception $e) {
            // Rollback the transaction in case of an error
            DB::rollBack();

            // Try to log the error, but don't let logging failure break the response
            try {
                Log::error('User registration error: ' . $e->getMessage());
            } catch (\Exception $logException) {
                // Silently fail if logging doesn't work
            }

            // Return a server error response
            return $this->serverErrorResponse(
                ['error' => 'Registration failed. Please try again or contact support.'],
                __('User registration failed')
            );
        }
    }

    /**
     * Login a user.
     */
    public function login(LoginRequest $request): JsonResponse
    {
        try {
            $validatedData = $request->validated();
            $user = User::where('email', $validatedData['email'])->first();

            if (! $user) {
                return $this->notFoundResponse([], __('User not found'));
            }

            if (! $user->is_verified || ! $user->email_verified_at) {
                return $this->forbiddenResponse([], __('User is not verified'));
            }

            if (! Hash::check($validatedData['password'], $user->password)) {
                return $this->unauthorizedResponse([], __('Invalid credentials'));
            }

            // Generate a new token for the user
            $token = $user->createToken(config('app.name'))->plainTextToken;

            // Return a success response
            return $this->okResponse(['user' => $user, 'token' => $token], __('User logged in successfully'));
        } catch (\Exception $e) {
            // Log the error message
            Log::error('User login error: ' . $e->getMessage());

            // Return a server error response
            return $this->serverErrorResponse(['error' => $e->getMessage()], __('User login failed'));
        }
    }

    /**
     * Handle password reset request.
     */
    public function forgotPassword(ForgotPasswordRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $user = User::where('email', $validated['email'])->first();

        if (! $user) {
            return $this->okResponse([], __('User not found'));
        }

        $token = Str::random(60);

        PasswordResetToken::updateOrCreate(
            ['email' => $validated['email']],
            [
                'token' => $token,
                'created_at' => now(),
            ]
        );

        try {
            // Send the password reset email
            Mail::to($validated['email'])->send(new PasswordResetMail($token));

            // Return a success response
            return $this->okResponse([], __('Password reset link sent successfully'));
        } catch (\Exception $e) {
            // Log the error message
            Log::error('Password reset error: ' . $e->getMessage());

            // Return a server error response
            return $this->serverErrorResponse(['error' => $e->getMessage()], __('Failed to send reset link. Please try again later.'));
        }
    }

    /**
     * Handle password reset resend request.
     */
    public function forgotPasswordResend(ForgotPasswordRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $user = User::where('email', $validated['email'])->first();

        if (! $user) {
            return $this->okResponse([], __('User not found'));
        }

        $token = Str::random(60);

        PasswordResetToken::updateOrCreate(
            ['email' => $validated['email']],
            [
                'token' => $token,
                'created_at' => now(),
            ]
        );

        try {
            // Send the password reset email
            Mail::to($validated['email'])->send(new PasswordResetMail($token));

            // Return a success response
            return $this->okResponse([], __('Password reset link resent successfully'));
        } catch (\Exception $e) {
            // Log the error message
            Log::error('Password reset resend error: ' . $e->getMessage());

            // Return a server error response
            return $this->serverErrorResponse(['error' => $e->getMessage()], __('Failed to resend reset link. Please try again later.'));
        }
    }

    /**
     * Reset the user's password.
     */
    public function resetPassword(ResetPasswordRequest $request): JsonResponse
    {
        try {
            $validatedData = $request->validated();
            $passwordResetToken = PasswordResetToken::where('email', $validatedData['email'])->where('token', $validatedData['token'])->first();

            if (! $passwordResetToken) {
                return $this->badRequestResponse([], __('Invalid token'));
            }

            $user = User::where('email', $validatedData['email'])->first();

            if (! $user) {
                return $this->notFoundResponse([], __('User not found'));
            }

            $user->password = bcrypt($validatedData['password']);
            $user->save();
            // Delete the password reset token after successful reset
            $passwordResetToken->delete();

            return $this->okResponse([], __('Password reset successfully'));
        } catch (\Exception $e) {
            // Log the error message
            Log::error('Password reset error: ' . $e->getMessage());

            // Return a server error response
            return $this->serverErrorResponse(['error' => $e->getMessage()], __('Password reset failed'));
        }
    }

    /**
     * Verify the user's email.
     */
    public function verifyEmail(VerifyEmailRequest $request): JsonResponse
    {
        try {
            $validatedData = $request->validated();
            $user = User::where('email', $validatedData['email'])->first();

            if (! $user) {
                return $this->notFoundResponse([], __('User not found'));
            }

            if ($user->email_verification_token !== $validatedData['token']) {
                return $this->badRequestResponse([], __('Invalid token'));
            }

            $user->email_verified_at = now();
            $user->email_verification_token = null;
            $user->is_verified = true;
            $user->save();
            // Generate a new token for the user
            $token = $user->createToken(config('app.name'))->plainTextToken;

            // Return a success response
            return $this->okResponse(['user' => $user, 'token' => $token], __('Email verified successfully'));
        } catch (\Exception $e) {
            // Log the error message
            Log::error('Email verification error: ' . $e->getMessage());

            // Return a server error response
            return $this->serverErrorResponse(['error' => $e->getMessage()], __('Email verification failed'));
        }
    }

    /**
     * Resend the email verification link.
     */
    public function resendVerificationEmail(ResendVerificationEmailRequest $request): JsonResponse
    {
        $validatedData = $request->validated();

        try {
            $user = User::where('email', $validatedData['email'])->first();

            if (! $user) {
                return $this->notFoundResponse([], __('User not found'));
            }

            if ($user->email_verified_at) {
                return $this->badRequestResponse([], __('Email already verified'));
            }

            if (! $user->email_verification_token) {
                $user->email_verification_token = Str::random(60);
                $user->save();
            }
            // Send the verification email
            Mail::to($user->email)->send(new VerifyEmailMail($user->email_verification_token, $user->email));

            // Return a success response
            return $this->okResponse([], __('Verification email resent successfully'));
        } catch (\Exception $e) {
            // Log the error message
            Log::error('Failed to resend verification email', [
                'email' => $validatedData['email'] ?? null,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);

            // return a server error response
            return $this->serverErrorResponse([], __('Failed to resend verification email. Please try again later.'));
        }
    }

    /**
     * Get the authenticated user.
     */
    public function user(Request $request): JsonResponse
    {
        try {
            // Check if the user is authenticated
            if (! $request->user()) {
                return $this->unauthorizedResponse([], __('Unauthenticated'));
            }
            // Retrieve the authenticated user
            $user = $request->user();

            // return the user data
            return $this->okResponse(['user' => $user], __('User retrieved successfully'));
        } catch (\Exception $e) {
            Log::error('Failed to retrieve user data', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'ip' => $request->ip(),
                'user_agent' => $request->userAgent(),
            ]);

            // return a server error response
            return $this->serverErrorResponse([], __('Failed to retrieve user data. Please try again later.'));
        }
    }

    public function logout(Request $request): JsonResponse
    {
        try {
            if (! $request->user()) {
                return $this->unauthorizedResponse([], __('Unauthenticated'));
            }

            $request->user()->currentAccessToken()->delete();

            return $this->okResponse([], __('User logged out successfully'));
        } catch (\Exception $e) {
            // Log the error message
            Log::error('Logout error: ' . $e->getMessage());

            // Return a server error response
            return $this->serverErrorResponse([], __('Logout failed'));
        }
    }
}
