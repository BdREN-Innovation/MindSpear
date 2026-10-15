<?php

namespace App\Http\Controllers\api\v1;

use App\Deck\Support\DeckFeature;
use App\Http\Requests\Profile\ChangePasswordRequest;
use App\Http\Requests\Profile\UpdateProfilePictureRequest;
use App\Http\Requests\Profile\UpdateProfileRequest;
use App\Models\Deck\Deck;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

class ProfileController extends ApiBaseController
{
    /**
     * Display the authenticated user's profile.
     */
    public function show(Request $request)
    {
        try {
            // Check if the user is authenticated
            if (! $request->user()) {
                return $this->unauthorizedResponse([], __('Unauthorized access.'));
            }

            // Return the user's profile. quest_v2_enabled is the effective flag: the
            // user's own, or true for everyone while QUEST_V2_DEFAULT_ENABLED is on.
            $profile = $request->user()->toArray();
            $profile['quest_v2_enabled'] = DeckFeature::enabled($request->user(), Deck::PRODUCT_QUEST);

            return $this->okResponse(['profile' => $profile], __('Profile retrieved successfully.'));
        } catch (Throwable $e) {
            // Log the error for debugging purposes
            Log::error('Failed to retrieve profile', [
                'error' => $e->getMessage(),
                'user_id' => $request->user() ? $request->user()->id : null,
            ]);

            // Return a server error response
            return $this->serverErrorResponse([], __('Failed to retrieve profile.'));
        }
    }

    /**
     * Update the authenticated user's profile.
     */
    public function update(UpdateProfileRequest $request): JsonResponse
    {
        try {
            $user = $request->user();

            $user->update($request->only([
                'first_name',
                'last_name',
                'email',
                'phone',
                'designation',
                'department',
                'institution_id',
                'institution_name',
            ]));

            // Respond with the updated user profile
            return $this->okResponse(['profile' => $user], __('Profile updated successfully.'));
        } catch (Throwable $e) {
            // Log the error for debugging purposes
            Log::error('Failed to update profile', [
                'error' => $e->getMessage(),
                'user_id' => $request->user() ? $request->user()->id : null,
            ]);

            // Return a server error response
            return $this->serverErrorResponse([], __('Failed to update profile.'));
        }
    }

    /**
     * Change the authenticated user's password.
     */
    public function changePassword(ChangePasswordRequest $request): JsonResponse
    {
        try {
            $user = $request->user();

            if (! password_verify($request->current_password, $user->password)) {
                return $this->forbiddenResponse([], __('Current password is incorrect.'));
            }

            $user->update(['password' => bcrypt($request->new_password)]);

            // Respond with a success message
            return $this->okResponse([], __('Password changed successfully.'));
        } catch (Throwable $e) {
            // Log the error for debugging purposes
            Log::error('Failed to change password', [
                'error' => $e->getMessage(),
                'user_id' => $request->user() ? $request->user()->id : null,
            ]);

            // Return a server error response
            return $this->serverErrorResponse([], __('Failed to change password.'));
        }
    }

    /**
     * Update the authenticated user's profile picture.
     */
    public function updateProfilePicture(UpdateProfilePictureRequest $request): JsonResponse
    {
        try {
            $user = $request->user();
            $validatedData = $request->validated();

            if (! isset($validatedData['profile_picture'])) {
                return $this->badRequestResponse([], __('Profile picture file is required.'));
            }

            $uploadedFile = $request->file('profile_picture');

            if ($uploadedFile) {
                $filePath = $this->uploadFile($uploadedFile, 'profile_pictures_' . $user->id);
                $validatedData['profile_picture'] = $filePath;
                $user->update(['profile_picture' => $filePath]);
            }

            // Respond with the updated user profile
            return $this->okResponse(['profile' => $user], __('Profile picture updated successfully.'));
        } catch (Throwable $e) {
            // Log the error for debugging purposes
            Log::error('Failed to update profile picture', [
                'error' => $e->getMessage(),
                'user_id' => $request->user() ? $request->user()->id : null,
            ]);

            // Return a server error response
            return $this->serverErrorResponse([], __('Failed to update profile picture.'));
        }
    }

    /**
     * Delete the authenticated user's profile picture.
     */
    public function deleteProfilePicture(Request $request): JsonResponse
    {
        try {
            $user = $request->user();

            if (! $user->profile_picture) {
                return $this->badRequestResponse([], __('No profile picture to delete.'));
            }

            $this->removeFile($user->getRawOriginal('profile_picture'));
            $user->update(['profile_picture' => null]);

            // Respond with a success message
            return $this->okResponse([], __('Profile picture deleted successfully.'));
        } catch (Throwable $e) {
            // Log the error for debugging purposes
            Log::error('Failed to delete profile picture', [
                'error' => $e->getMessage(),
                'user_id' => $request->user() ? $request->user()->id : null,
            ]);

            // Return a server error response
            return $this->serverErrorResponse([], __('Failed to delete profile picture.'));
        }
    }
}
