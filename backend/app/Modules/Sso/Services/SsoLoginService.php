<?php

namespace App\Modules\Sso\Services;

use App\Models\User;
use App\Modules\Sso\Exceptions\SsoException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * The two browser flows, both ending on the frontend page /auth/sso/callback:
 *  - login: ZITADEL → this server checks everything → a normal Sanctum token,
 *    the same kind password and Google logins get;
 *  - link: a signed-in user connects their BDREN identity from the profile page.
 * state, nonce and the PKCE verifier stay in the cache, single use.
 */
class SsoLoginService
{
    public const MODE_LOGIN = 'login';

    public const MODE_LINK = 'link';

    public function __construct(
        private readonly OidcClient $oidc,
        private readonly SsoAccountLinker $linker,
    ) {}

    /** @return array{redirect_url: string, state: string} */
    /** `$silent`: ask BDREN with prompt=none (no page), to sign in whoever is already signed in to BDREN. */
    public function start(string $mode, ?User $user = null, bool $silent = false): array
    {
        $this->ensureConfigured();

        $state = Str::random(48);
        $nonce = Str::random(48);
        $verifier = Str::random(96);
        Cache::put(self::stateKey($state), [
            'mode' => $mode,
            'user_id' => $user?->id,
            'nonce' => $nonce,
            'verifier' => $verifier,
        ], config('sso.state_ttl'));

        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');

        return [
            'redirect_url' => $this->oidc->authorizationUrl(
                $state, $nonce, $challenge,
                $mode === self::MODE_LINK ? $user?->email : null,
                $silent && $mode === self::MODE_LOGIN ? 'none' : null,
            ),
            'state' => $state,
        ];
    }

    /**
     * Finishes a flow started by start(). `$current` is the user signed in on the
     * callback page (required for, and must match, a link flow).
     */
    public function complete(string $code, string $state, ?User $current): array
    {
        $this->ensureConfigured();

        $pending = Cache::pull(self::stateKey($state));
        if (! is_array($pending)) {
            throw SsoException::invalidState();
        }
        if ($pending['mode'] === self::MODE_LINK && (! $current || $current->id !== $pending['user_id'])) {
            throw new SsoException('Sign in to Mindspear with the account you want to connect, then try again.', 403, 'link_user_mismatch');
        }

        $tokens = $this->oidc->exchangeCode($code, $pending['verifier']);
        $claims = $this->oidc->verifyIdToken($tokens['id_token'], $pending['nonce']);
        // The BDREN clients put the profile in the ID token; ask userinfo only if it isn't there.
        if (empty($claims['email']) && ! empty($tokens['access_token'])) {
            $info = $this->oidc->userinfo($tokens['access_token']);
            if (($info['sub'] ?? null) === $claims['sub']) {
                $claims += $info;
            }
        }
        $profile = SsoProfile::fromClaims($claims);

        if ($pending['mode'] === self::MODE_LINK) {
            $identity = $this->linker->link($current, $profile);

            return ['mode' => self::MODE_LINK, 'identity' => $identity->toSummary()];
        }

        ['user' => $user, 'linked_via' => $via, 'created' => $created] = $this->linker->resolve($profile);
        $token = $user->createToken(config('app.name') . '-sso')->plainTextToken;
        Log::info('sso.login', ['user_id' => $user->id, 'linked_via' => $via, 'created' => $created]);

        return [
            'mode' => self::MODE_LOGIN,
            // The same user shape as the Google / Microsoft callbacks, so the frontend stores it the same way.
            'user' => [
                'id' => $user->id,
                'first_name' => $user->first_name,
                'last_name' => $user->last_name,
                'email' => $user->email,
                'profile_picture' => $user->profile_picture,
                'provider' => 'bdren',
            ],
            'token' => $token,
            'token_type' => 'Bearer',
            'provider' => 'bdren',
            'sso' => ['linked_via' => $via, 'created' => $created],
        ];
    }

    public function ensureConfigured(): void
    {
        if (! config('sso.enabled')) {
            throw SsoException::disabled();
        }
        foreach (['issuer' => 'SSO_ISSUER', 'client_id' => 'SSO_CLIENT_ID', 'client_secret' => 'SSO_CLIENT_SECRET', 'redirect_uri' => 'SSO_REDIRECT_URI'] as $key => $env) {
            if (empty(config("sso.{$key}"))) {
                throw SsoException::notConfigured($env);
            }
        }
    }

    private static function stateKey(string $state): string
    {
        return 'sso:state:' . hash('sha256', $state);
    }
}
