<?php

namespace App\Modules\Sso\Http\Middleware;

use App\Modules\Sso\Exceptions\SsoException;
use App\Modules\Sso\Services\EntitlementResult;
use App\Modules\Sso\Services\EntitlementsClient;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Route middleware `sso.entitlement:{feature},{quantity=1}`: refuses the request
 * when BDREN says the user's plan doesn't allow it. A read-only check; for work
 * that uses quota up, wrap it in EntitlementsClient::metered() instead.
 *
 * Lets the request through when SSO is off, the user has no BDREN identity
 * (existing password users), or SSO_ENFORCE_ENTITLEMENTS=false (then it only logs).
 */
class RequireEntitlement
{
    public function __construct(private readonly EntitlementsClient $entitlements) {}

    public function handle(Request $request, Closure $next, string $feature, string $quantity = '1'): Response
    {
        $user = $request->user();
        if (! $user || ! config('sso.enabled')) {
            return $next($request);
        }

        $result = $this->entitlements->check($user, $feature, max(1, (int) $quantity));
        $refusal = match ($result->status) {
            EntitlementResult::OK => $result->allowed ? null : $this->entitlements->quotaExceeded($feature),
            EntitlementResult::NOT_PROVISIONED => $this->entitlements->notProvisioned(),
            EntitlementResult::UNAVAILABLE, EntitlementResult::NOT_CONFIGURED => config('sso.fail_open')
                ? null
                : new SsoException('Usage limits can\'t be checked right now. Please try again later.', 503, 'entitlements_unavailable'),
            default => null,
        };
        if ($result->status === EntitlementResult::UNAVAILABLE) {
            Log::warning('sso.entitlements.unavailable', ['user_id' => $user->id, 'feature' => $feature, 'error' => $result->error]);
        }

        if ($refusal === null) {
            return $next($request);
        }
        if (! config('sso.enforce_entitlements')) {
            Log::info('sso.entitlements.would_refuse', ['user_id' => $user->id, 'feature' => $feature, 'code' => $refusal->errorCode]);

            return $next($request);
        }

        return $refusal->render();
    }
}
