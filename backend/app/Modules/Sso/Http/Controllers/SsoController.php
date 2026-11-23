<?php

namespace App\Modules\Sso\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modules\Sso\Exceptions\SsoException;
use App\Modules\Sso\Models\SsoIdentity;
use App\Modules\Sso\Services\EntitlementResult;
use App\Modules\Sso\Services\EntitlementsClient;
use App\Modules\Sso\Services\OidcClient;
use App\Modules\Sso\Services\SsoAccountLinker;
use App\Modules\Sso\Services\SsoLoginService;
use App\Modules\Sso\Services\SsoSignup;
use App\Traits\ApiResponseTrait;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;
use Throwable;

/** /api/v1/sso: BDREN single sign-on and entitlements. See SSO_INTEGRATION.md. */
class SsoController extends Controller
{
    use ApiResponseTrait;

    public function __construct(
        private readonly SsoLoginService $login,
        private readonly SsoAccountLinker $linker,
        private readonly EntitlementsClient $entitlements,
        private readonly OidcClient $oidc,
    ) {}

    /** Public: whether to show the SSO button, and the central logout page. */
    public function config(): JsonResponse
    {
        $enabled = (bool) config('sso.enabled');
        $logoutUrl = null;
        if ($enabled) {
            try {
                $logoutUrl = $this->oidc->endSessionUrl();
            } catch (Throwable) {
                // ZITADEL unreachable: the button still shows, logout stays local.
            }
        }

        return $this->okResponse([
            'enabled' => $enabled,
            'provider_name' => config('sso.provider_name'),
            'logout_url' => $logoutUrl,
            // false: the sign-up page offers only `signup_url` (BDREN's sign-up), see SsoSignup.
            'local_signup' => SsoSignup::localAllowed(),
            'signup_url' => SsoSignup::bdrenSignupUrl(),
            // Which direct social logins have credentials; the sign-in page hides the others,
            // so nobody clicks a button that can only fail.
            'social' => [
                'google' => filled(config('services.google.client_id')) && filled(config('services.google.client_secret')),
                'microsoft' => filled(config('services.microsoft.client_id')),
            ],
        ]);
    }

    /** Public: starts a login; the browser goes to `redirect_url`. */
    /** Public. `silent: true` = prompt=none: sign in whoever is signed in to BDREN, without any BDREN page. */
    public function login(Request $request): JsonResponse
    {
        $silent = $request->boolean('silent');

        return $this->okResponse($this->login->start(SsoLoginService::MODE_LOGIN, null, $silent));
    }

    /**
     * Public, server to server: BDREN posts a signed logout_token when a BDREN session ends anywhere
     * (logging out of bdren.ai, Synapse or here), and the Mindspear sign-ins of that session end too.
     */
    public function backchannelLogout(Request $request, OidcClient $oidc): SymfonyResponse
    {
        try {
            $claims = $oidc->verifyLogoutToken((string) $request->input('logout_token', ''));
        } catch (SsoException $e) {
            Log::warning('sso.backchannel_logout.rejected', ['reason' => $e->getMessage()]);

            return response()->json(['error' => 'invalid_request'], 400)->header('Cache-Control', 'no-store');
        }
        $revoked = $this->login->endSessions($claims);
        Log::info('sso.backchannel_logout', ['revoked' => $revoked]);

        return response()->noContent(200)->header('Cache-Control', 'no-store');
    }

    /** Public: the frontend callback page posts ZITADEL's code and state here. */
    public function callback(Request $request): JsonResponse
    {
        $data = $request->validate([
            'code' => ['required', 'string', 'max:4096'],
            'state' => ['required', 'string', 'max:255'],
        ]);
        $result = $this->login->complete($data['code'], $data['state'], auth('sanctum')->user());

        return $this->okResponse($result, $result['mode'] === SsoLoginService::MODE_LINK ? __('BDREN account connected') : __('Login successful'));
    }

    public function status(Request $request): JsonResponse
    {
        $identity = config('sso.enabled') ? SsoIdentity::forUser($request->user()) : null;

        return $this->okResponse([
            'enabled' => (bool) config('sso.enabled'),
            'provider_name' => config('sso.provider_name'),
            'linked' => $identity !== null,
            'identity' => $identity?->toSummary(),
        ]);
    }

    /** Starts connecting the signed-in user's BDREN identity. */
    public function link(Request $request): JsonResponse
    {
        return $this->okResponse($this->login->start(SsoLoginService::MODE_LINK, $request->user()));
    }

    public function unlink(Request $request): JsonResponse
    {
        $this->ensureEnabled();

        return $this->okResponse(['unlinked' => $this->linker->unlink($request->user())], __('BDREN account disconnected'));
    }

    /** The user's limits for the features in BDREN_FEATURES, for the profile page. */
    public function entitlements(Request $request): JsonResponse
    {
        $this->ensureEnabled();
        $results = array_map(fn (string $feature) => $this->entitlements->check($request->user(), $feature), config('sso.features'));
        $notProvisioned = collect($results)->contains(fn (EntitlementResult $r) => $r->status === EntitlementResult::NOT_PROVISIONED);

        return $this->okResponse([
            'product' => config('sso.product'),
            'features' => array_map(fn (EntitlementResult $r) => $r->toArray(), $results),
            'activate_url' => $notProvisioned ? $this->entitlements->activationUrl() : null,
        ]);
    }

    private function ensureEnabled(): void
    {
        if (! config('sso.enabled')) {
            throw SsoException::disabled();
        }
    }
}
