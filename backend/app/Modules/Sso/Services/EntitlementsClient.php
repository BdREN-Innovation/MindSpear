<?php

namespace App\Modules\Sso\Services;

use App\Models\User;
use App\Modules\Sso\Exceptions\SsoException;
use App\Modules\Sso\Models\SsoIdentity;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * "What may this user use, and how much?" — the BDREN entitlement API, server to
 * server with the product API key, the user named by (issuer, zitadel_subject).
 * Users without a linked BDREN identity get NOT_LINKED and are never limited here,
 * so existing password users keep working exactly as before.
 */
class EntitlementsClient
{
    public function __construct(private readonly SsoHttp $http) {}

    public function isConfigured(): bool
    {
        return config('sso.enabled') && config('sso.api_url') && config('sso.product_api_key');
    }

    /** Read-only: would `$quantity` units of `$feature` be allowed now? */
    public function check(User $user, string $feature, int $quantity = 1): EntitlementResult
    {
        $identity = SsoIdentity::forUser($user);
        if (! $identity) {
            return new EntitlementResult($feature, EntitlementResult::NOT_LINKED, allowed: true);
        }
        if (! $this->isConfigured()) {
            return new EntitlementResult($feature, EntitlementResult::NOT_CONFIGURED);
        }

        $response = $this->post('/entitlements/check/', $this->body($identity, $feature, $quantity));
        if ($response === null) {
            return new EntitlementResult($feature, EntitlementResult::UNAVAILABLE, error: 'unreachable');
        }
        if ($this->isUnknownUser($response)) {
            return new EntitlementResult($feature, EntitlementResult::NOT_PROVISIONED, error: 'user_not_found');
        }
        if (! $response->successful() && $response->status() !== 429) {
            return new EntitlementResult($feature, EntitlementResult::UNAVAILABLE, error: 'http_' . $response->status());
        }

        return EntitlementResult::fromResponse($feature, (array) $response->json());
    }

    /**
     * Runs `$work` inside a quota reservation: reserve → work → commit, or release
     * when the work throws. Users without a BDREN identity run it unmetered, and so
     * does everyone over their limit while SSO_ENFORCE_ENTITLEMENTS=false (logged).
     *
     * @template T
     *
     * @param  callable(): T  $work
     * @return T
     */
    public function metered(User $user, string $feature, int $quantity, callable $work, ?string $idempotencyKey = null): mixed
    {
        $identity = SsoIdentity::forUser($user);
        if (! $identity || ! $this->isConfigured()) {
            return $work();
        }

        $response = $this->post('/usage/reservations/', $this->body($identity, $feature, $quantity) + [
            'idempotency_key' => $idempotencyKey ?? (string) Str::uuid(),
        ]);
        if ($response === null || $response->serverError()) {
            if (config('sso.fail_open')) {
                Log::warning('sso.entitlements.unavailable', ['user_id' => $user->id, 'feature' => $feature]);

                return $work();
            }
            throw new SsoException('Usage limits can\'t be checked right now. Please try again later.', 503, 'entitlements_unavailable');
        }
        $reservationId = $response->json('reservation_id');
        if (! $response->successful() || ! is_string($reservationId)) {
            $refusal = match (true) {
                $response->status() === 429 => $this->quotaExceeded($feature),
                $this->isUnknownUser($response) => $this->notProvisioned(),
                default => new SsoException('Usage limits refused this request.', 403, 'entitlement_refused', ['http_status' => $response->status()]),
            };
            if (config('sso.enforce_entitlements')) {
                throw $refusal;
            }
            // Not enforcing yet: let the work run, unmetered, and record what would have happened.
            Log::info('sso.entitlements.would_refuse', ['user_id' => $user->id, 'feature' => $feature, 'code' => $refusal->errorCode]);

            return $work();
        }

        try {
            $result = $work();
        } catch (\Throwable $e) {
            $this->post('/usage/reservations/' . rawurlencode($reservationId) . '/release/', []);
            throw $e;
        }
        // Uncommitted reservations expire on BDREN's side, so a lost commit costs nothing.
        $this->post('/usage/reservations/' . rawurlencode($reservationId) . '/commit/', []);

        return $result;
    }

    public function quotaExceeded(string $feature): SsoException
    {
        return new SsoException('You have reached your plan\'s limit for this. Upgrade your BDREN plan to continue.', 429, 'quota_exceeded', [
            'feature' => $feature,
            'upgrade_url' => config('sso.platform_url') . '/',
        ]);
    }

    public function notProvisioned(): SsoException
    {
        return new SsoException('Activate your BDREN account once to use this.', 403, 'not_provisioned', ['activate_url' => $this->activationUrl()]);
    }

    /** One sign-in on the BDREN website creates the person there (seamless thanks to SSO). */
    public function activationUrl(): string
    {
        return config('sso.platform_url') . '/api/v1/auth/login/?' . http_build_query(['next' => config('sso.app_url') . '/profile']);
    }

    private function body(SsoIdentity $identity, string $feature, int $quantity): array
    {
        return [
            'product' => config('sso.product'),
            'feature' => $feature,
            'quantity' => $quantity,
            'issuer' => $identity->issuer,
            'zitadel_subject' => $identity->subject,
        ];
    }

    private function post(string $path, array $body): ?Response
    {
        [$request, $url] = $this->http->to(config('sso.api_url') . $path);
        try {
            return $request->withHeaders(['X-Product-Api-Key' => config('sso.product_api_key')])->asJson()->post($url, $body);
        } catch (ConnectionException $e) {
            Log::warning('sso.entitlements.unreachable', ['path' => $path, 'error' => $e->getMessage()]);

            return null;
        }
    }

    private function isUnknownUser(Response $response): bool
    {
        return $response->status() === 403 && str_contains(strtolower($response->body()), 'user not found');
    }
}
