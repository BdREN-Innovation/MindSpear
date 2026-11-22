<?php

namespace App\Http\Controllers\api\v1;

use App\Models\User;
use App\Modules\Sso\Services\SsoSignup;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Laravel\Socialite\Facades\Socialite;

class SocialAuthController extends ApiBaseController
{
    // Supported providers
    protected $supportedProviders = ['google', 'facebook', 'microsoft'];

    /**
     * Redirect to provider for authentication
     */
    public function redirectToProvider(string $provider): JsonResponse
    {
        $validated = $this->validateProvider($provider);
        if (! is_null($validated)) {
            return $validated;
        }

        try {
            // Handle Microsoft with PKCE
            if ($provider === 'microsoft') {
                return $this->generateMicrosoftRedirectUrlWithPkce();
            }

            $socialite = Socialite::driver($provider)->stateless();

            switch ($provider) {
                case 'google':
                    $socialite->scopes(['openid', 'profile', 'email']);
                    break;

                case 'facebook':
                    $socialite->scopes(['email', 'public_profile']);
                    break;
            }

            $redirectUrl = $socialite->redirect()->getTargetUrl();

            return $this->okResponse([
                'redirect_url' => $redirectUrl,
                'provider' => $provider,
            ], __('Redirect URL generated successfully'));

        } catch (Exception $e) {
            Log::error('Socialite redirect error', [
                'provider' => $provider,
                'message' => $e->getMessage(),
            ]);

            return $this->serverErrorResponse([
                'provider' => $provider,
            ], __('Failed to generate redirect URL'));
        }
    }

    /**
     * Generate Microsoft redirect URL with PKCE
     */
    protected function generateMicrosoftRedirectUrlWithPkce(): JsonResponse
    {
        $config = config('services.microsoft');
        $tenant = $config['tenant'] ?? 'consumers';

        // Generate PKCE code verifier and challenge
        $codeVerifier = $this->generateCodeVerifier();
        $codeChallenge = $this->generateCodeChallenge($codeVerifier);
        $state = Str::random(40);

        // Store code verifier in cache for later use
        Cache::put('microsoft_pkce_' . $state, $codeVerifier, now()->addMinutes(10));

        // Use consumers endpoint if tenant is consumers, otherwise use common
        if ($tenant === 'consumers') {
            $authEndpoint = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
        } else {
            $authEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
        }

        $params = [
            'client_id' => $config['client_id'],
            'redirect_uri' => $config['redirect'],
            'response_type' => 'code',
            'response_mode' => 'query',
            'scope' => 'openid profile email User.Read',
            'state' => $state,
            'code_challenge' => $codeChallenge,
            'code_challenge_method' => 'S256',
        ];

        $authUrl = $authEndpoint . '?' . http_build_query($params);

        return $this->okResponse([
            'redirect_url' => $authUrl,
            'provider' => 'microsoft',
            'tenant' => $tenant,
        ], __('Redirect URL generated successfully'));
    }

    /**
     * Generate PKCE code verifier
     */
    protected function generateCodeVerifier(): string
    {
        return Str::random(128);
    }

    /**
     * Generate PKCE code challenge from verifier
     */
    protected function generateCodeChallenge(string $codeVerifier): string
    {
        $hash = hash('sha256', $codeVerifier, true);

        return rtrim(strtr(base64_encode($hash), '+/', '-_'), '=');
    }

    /**
     * Handle provider callback
     */
    public function handleProviderCallback(string $provider): JsonResponse
    {
        $validated = $this->validateProvider($provider);
        if (! is_null($validated)) {
            return $validated;
        }

        try {
            if ($provider === 'microsoft') {
                return $this->handleMicrosoftCallbackWithPkce();
            }

            $socialUser = Socialite::driver($provider)->stateless()->user();

            return $this->processSocialUser($socialUser, $provider);

        } catch (Exception $e) {
            Log::error('Socialite callback error', [
                'provider' => $provider,
                'message' => $e->getMessage(),
                'error' => request('error'),
                'error_description' => request('error_description'),
            ]);

            return $this->serverErrorResponse([
                'provider' => $provider,
                'error' => request('error'),
                'error_description' => request('error_description'),
            ], __('Authentication failed'));
        }
    }

    /**
     * Handle Microsoft callback with PKCE
     */
    protected function handleMicrosoftCallbackWithPkce(): JsonResponse
    {
        try {
            $code = request('code');
            $state = request('state');
            $error = request('error');

            if ($error) {
                // Check if it's the userAudience configuration error
                if (str_contains(request('error_description'), 'userAudience')) {
                    return $this->handleUserAudienceError();
                }
                throw new Exception('Microsoft authentication error: ' . request('error_description'));
            }

            if (! $code) {
                return $this->badRequestResponse([], __('Authorization code not found'));
            }

            if (! $state) {
                return $this->badRequestResponse([], __('State parameter missing'));
            }

            // Retrieve code verifier from cache
            $codeVerifier = Cache::get('microsoft_pkce_' . $state);
            if (! $codeVerifier) {
                throw new Exception('PKCE code verifier not found or expired');
            }

            $config = config('services.microsoft');
            $tenant = $config['tenant'] ?? 'common';

            // Try common endpoint first, fallback to consumers if needed
            $tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

            // Exchange code for token with PKCE (include client_secret if configured)
            $tokenParams = [
                'client_id' => $config['client_id'],
                'code' => $code,
                'redirect_uri' => $config['redirect'],
                'grant_type' => 'authorization_code',
                'code_verifier' => $codeVerifier,
                'scope' => 'openid profile email User.Read',
            ];
            if (! empty($config['client_secret'])) {
                $tokenParams['client_secret'] = $config['client_secret'];
            }

            $response = Http::asForm()->post($tokenEndpoint, $tokenParams);

            // If common endpoint fails with userAudience error, try consumers endpoint
            if (! $response->successful() && str_contains($response->body(), 'userAudience')) {
                $tokenEndpoint = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
                $response = Http::asForm()->post($tokenEndpoint, $tokenParams);
            }

            if (! $response->successful()) {
                Log::error('Microsoft token exchange failed', [
                    'response' => $response->body(),
                    'status' => $response->status(),
                ]);
                throw new Exception('Token exchange failed: ' . $response->body());
            }

            $tokenData = $response->json();
            $accessToken = $tokenData['access_token'];

            // Get user info from Microsoft Graph
            $userResponse = Http::withToken($accessToken)
                ->get('https://graph.microsoft.com/v1.0/me');

            if (! $userResponse->successful()) {
                throw new Exception('User info fetch failed: ' . $userResponse->body());
            }

            $userData = $userResponse->json();

            // Create social user object (no direct photo URL from Graph without token)
            $socialUser = (object) [
                'id' => $userData['id'],
                'name' => $userData['displayName'],
                'email' => $userData['mail'] ?? $userData['userPrincipalName'],
                'avatar' => null,
                'user' => $userData,
            ];

            // Clean up PKCE data
            Cache::forget('microsoft_pkce_' . $state);

            return $this->processSocialUser($socialUser, 'microsoft');

        } catch (Exception $e) {
            Log::error('Microsoft callback with PKCE error', [
                'message' => $e->getMessage(),
                'error' => request('error'),
                'error_description' => request('error_description'),
            ]);

            return $this->serverErrorResponse([
                'error' => request('error'),
                'error_description' => request('error_description'),
            ], __('Microsoft authentication failed: ' . $e->getMessage()));
        }
    }

    /**
     * Handle userAudience configuration error
     */
    protected function handleUserAudienceError(): JsonResponse
    {
        $config = config('services.microsoft');

        return $this->badRequestResponse([
            'error' => 'azure_config_mismatch',
            'error_description' => 'Your Azure app is configured for Consumer accounts only but you are using the common endpoint.',
            'solution' => 'Either change your Azure app to support "All" account types or use the consumers endpoint.',
            'azure_portal_url' => 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/Authentication/appId/' . $config['client_id'] . '/isMSAApp/',
            'config_suggestion' => [
                'current_tenant' => $config['tenant'] ?? 'common',
                'suggested_tenant' => 'consumers',
                'env_config' => 'MICROSOFT_TENANT=consumers',
            ],
        ], __('Azure application configuration mismatch. Please check your Azure app settings.'));
    }

    /**
     * Process social user
     */
    protected function processSocialUser($socialUser, string $provider): JsonResponse
    {
        // Extract user data based on provider
        $userData = $this->extractUserData($socialUser, $provider);

        // Find or create user
        $user = User::where('email', $userData['email'])->first();

        $profilePictureUrl = $this->resolveProfilePictureUrl($socialUser, $provider);

        if (! $user && ! SsoSignup::localAllowed()) {
            return $this->forbiddenResponse(
                SsoSignup::refusal(),
                __('No Mindspear account uses this email. New accounts are created with a BDREN account: choose Sign Up to create one.'),
            );
        }

        if (! $user) {
            $user = User::create([
                'first_name' => $userData['first_name'],
                'last_name' => $userData['last_name'],
                'email' => $userData['email'],
                'password' => Hash::make(Str::random(24)),
                'email_verified_at' => now(),
                'is_verified' => true,
                'provider_id' => $socialUser->id,
                'provider' => $provider,
                'profile_picture' => $profilePictureUrl,
            ]);
        } else {
            // Update provider details if user exists
            $user->update([
                'provider_id' => $socialUser->id,
                'provider' => $provider,
                'profile_picture' => $profilePictureUrl ?? $user->profile_picture,
            ]);
        }

        // Generate API token
        $token = $user->createToken(config('app.name') . '-' . $provider)->plainTextToken;

        return $this->okResponse([
            'user' => [
                'id' => $user->id,
                'first_name' => $user->first_name,
                'last_name' => $user->last_name,
                'email' => $user->email,
                'profile_picture' => $user->profile_picture,
                'provider' => $user->provider,
            ],
            'token' => $token,
            'token_type' => 'Bearer',
            'expires_in' => config('sanctum.expiration', 525600) * 60,
            'provider' => $provider,
        ], __('Login successful'));
    }

    /**
     * Resolve a profile picture URL from provider avatar or email (Gravatar fallback).
     */
    protected function resolveProfilePictureUrl($socialUser, string $provider): ?string
    {
        // Use provider-provided avatar URL if present (Google/Facebook typically provide this)
        if (! empty($socialUser->avatar) && filter_var($socialUser->avatar, FILTER_VALIDATE_URL)) {
            return $socialUser->avatar;
        }

        // Fallback to Gravatar based on email
        if (! empty($socialUser->email)) {
            $email = strtolower(trim($socialUser->email));
            $hash = md5($email);

            // s: size, d: default image (identicon)
            return 'https://www.gravatar.com/avatar/' . $hash . '?s=256&d=identicon';
        }

        return null;
    }

    /**
     * Extract user data for Microsoft
     */
    protected function extractUserData($socialUser, string $provider): array
    {
        $userData = [
            'first_name' => '',
            'last_name' => '',
            'email' => $socialUser->email,
        ];

        if ($provider === 'microsoft') {
            $userData['first_name'] = $socialUser->user['givenName'] ?? '';
            $userData['last_name'] = $socialUser->user['surname'] ?? '';

            if (empty($userData['first_name']) && ! empty($socialUser->user['displayName'])) {
                $nameParts = $this->splitName($socialUser->user['displayName']);
                $userData['first_name'] = $nameParts['first_name'];
                $userData['last_name'] = $nameParts['last_name'];
            }
        } else {
            $nameParts = $this->splitName($socialUser->name ?? '');
            $userData['first_name'] = $nameParts['first_name'];
            $userData['last_name'] = $nameParts['last_name'];
        }

        if (empty($userData['first_name'])) {
            $userData['first_name'] = explode('@', $userData['email'])[0];
        }

        return $userData;
    }

    /**
     * Validate provider
     */
    protected function validateProvider(string $provider): ?JsonResponse
    {
        if (empty($provider)) {
            return $this->badRequestResponse([], __('Provider must be specified'));
        }

        if (! in_array($provider, $this->supportedProviders)) {
            return $this->badRequestResponse([], __('Unsupported provider'));
        }

        $service = config('services.' . $provider);

        if (is_null($service)) {
            return $this->badRequestResponse([], __('Provider not configured'));
        }

        if (empty($service['client_id'])) {
            return $this->badRequestResponse([], __('Client ID not configured'));
        }

        if (empty($service['redirect'])) {
            return $this->badRequestResponse([], __('Redirect URI not configured'));
        }

        return null;
    }

    /**
     * Split full name into first and last name
     */
    protected function splitName(string $fullName): array
    {
        $name = trim($fullName);
        $parts = explode(' ', $name);

        $firstName = $parts[0] ?? '';
        $lastName = count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : '';

        return [
            'first_name' => $firstName,
            'last_name' => $lastName,
        ];
    }
}
