<?php

namespace App\Modules\Sso\Services;

use App\Modules\Sso\Exceptions\SsoException;
use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * The OpenID Connect protocol against ZITADEL: discovery, the authorization URL
 * (code + PKCE S256), the code exchange (confidential client) and the checks on
 * the ID token (RS256 only, signature from JWKS, iss, aud/azp, exp, nonce).
 * Tokens never leave the server and are not stored.
 */
class OidcClient
{
    private const DISCOVERY_TTL = 3600;

    public function __construct(private readonly SsoHttp $http) {}

    public function discovery(bool $fresh = false): array
    {
        $key = 'sso:discovery:' . md5(config('sso.issuer'));
        if (! $fresh && is_array($cached = Cache::get($key))) {
            return $cached;
        }

        $document = $this->getJson(config('sso.issuer') . '/.well-known/openid-configuration', 'discovery');
        if (($document['issuer'] ?? null) !== config('sso.issuer')) {
            throw SsoException::providerUnavailable('discovery issuer does not match SSO_ISSUER');
        }
        foreach (['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as $field) {
            if (empty($document[$field])) {
                throw SsoException::providerUnavailable("discovery has no {$field}");
            }
        }
        Cache::put($key, $document, self::DISCOVERY_TTL);

        return $document;
    }

    public function authorizationUrl(string $state, string $nonce, string $codeChallenge, ?string $loginHint = null): string
    {
        $params = array_filter([
            'client_id' => config('sso.client_id'),
            'redirect_uri' => config('sso.redirect_uri'),
            'response_type' => 'code',
            'scope' => config('sso.scopes'),
            'state' => $state,
            'nonce' => $nonce,
            'code_challenge' => $codeChallenge,
            'code_challenge_method' => 'S256',
            'login_hint' => $loginHint,
        ]);

        return $this->discovery()['authorization_endpoint'] . '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    }

    /** @return array{id_token: string, access_token: ?string} */
    public function exchangeCode(string $code, string $codeVerifier): array
    {
        [$request, $url] = $this->http->to($this->discovery()['token_endpoint']);
        $form = [
            'grant_type' => 'authorization_code',
            'code' => $code,
            'redirect_uri' => config('sso.redirect_uri'),
            'code_verifier' => $codeVerifier,
        ];
        if (config('sso.token_auth_method') === 'client_secret_post') {
            $form += ['client_id' => config('sso.client_id'), 'client_secret' => config('sso.client_secret')];
        } else {
            // RFC 6749 2.3.1: form-encode the id and secret before the Basic header.
            $request = $request->withBasicAuth(urlencode(config('sso.client_id')), urlencode(config('sso.client_secret')));
        }

        try {
            $response = $request->asForm()->post($url, $form);
        } catch (ConnectionException $e) {
            throw SsoException::providerUnavailable('token endpoint: ' . $e->getMessage());
        }
        if ($response->clientError()) {
            throw SsoException::invalidToken('token exchange refused: ' . ($response->json('error') ?? $response->status()));
        }
        $this->ensureOk($response, 'token endpoint');

        $idToken = $response->json('id_token');
        if (! is_string($idToken) || $idToken === '') {
            throw SsoException::invalidToken('no id_token in the token response');
        }

        return ['id_token' => $idToken, 'access_token' => $response->json('access_token')];
    }

    /** The ID token's claims after every check; throws SsoException::invalidToken otherwise. */
    public function verifyIdToken(string $jwt, string $nonce): array
    {
        $segments = explode('.', $jwt);
        if (count($segments) !== 3) {
            throw SsoException::invalidToken('malformed id_token');
        }
        $header = json_decode(JWT::urlsafeB64Decode($segments[0]), true);
        if (! is_array($header) || ($header['alg'] ?? null) !== 'RS256') {
            throw SsoException::invalidToken('id_token must be signed with RS256');
        }

        // A key ZITADEL rotated in since the last fetch: fetch the key set again once.
        $keys = $this->signingKeys(false);
        if (isset($header['kid']) && ! isset($keys[$header['kid']])) {
            $keys = $this->signingKeys(true);
        }

        $previousLeeway = JWT::$leeway;
        JWT::$leeway = config('sso.leeway');
        try {
            $claims = json_decode(json_encode(JWT::decode($jwt, $keys)), true);
        } catch (Throwable $e) {
            throw SsoException::invalidToken($e->getMessage());
        } finally {
            JWT::$leeway = $previousLeeway;
        }

        $clientId = config('sso.client_id');
        $audience = (array) ($claims['aud'] ?? []);
        $checks = [
            'iss' => ($claims['iss'] ?? null) === config('sso.issuer'),
            'aud' => in_array($clientId, $audience, true),
            'azp' => count($audience) <= 1 || ($claims['azp'] ?? null) === $clientId,
            'nonce' => is_string($claims['nonce'] ?? null) && hash_equals($nonce, $claims['nonce']),
            'sub' => is_string($claims['sub'] ?? null) && $claims['sub'] !== '',
            'exp' => isset($claims['exp'], $claims['iat']),
        ];
        foreach ($checks as $claim => $ok) {
            if (! $ok) {
                throw SsoException::invalidToken("{$claim} check failed");
            }
        }

        return $claims;
    }

    public function userinfo(string $accessToken): array
    {
        $endpoint = $this->discovery()['userinfo_endpoint'] ?? null;
        if (! $endpoint) {
            return [];
        }
        [$request, $url] = $this->http->to($endpoint);
        try {
            $response = $request->withToken($accessToken)->get($url);
        } catch (ConnectionException $e) {
            throw SsoException::providerUnavailable('userinfo: ' . $e->getMessage());
        }
        $this->ensureOk($response, 'userinfo');

        return (array) $response->json();
    }

    /**
     * ZITADEL's logout page for this client (RP-initiated logout with client_id), or null
     * when discovery has no end_session_endpoint. Ends the central SSO session too.
     */
    public function endSessionUrl(): ?string
    {
        $endpoint = $this->discovery()['end_session_endpoint'] ?? null;
        if (! $endpoint) {
            return null;
        }

        return $endpoint . '?' . http_build_query([
            'client_id' => config('sso.client_id'),
            'post_logout_redirect_uri' => config('sso.post_logout_redirect_uri'),
        ], '', '&', PHP_QUERY_RFC3986);
    }

    /** @return array<string, \Firebase\JWT\Key> by kid */
    private function signingKeys(bool $fresh): array
    {
        $key = 'sso:jwks:' . md5(config('sso.issuer'));
        $jwks = $fresh ? null : Cache::get($key);
        if (! is_array($jwks)) {
            $jwks = $this->getJson($this->discovery()['jwks_uri'], 'jwks');
            Cache::put($key, $jwks, self::DISCOVERY_TTL);
        }

        try {
            return JWK::parseKeySet($jwks, 'RS256');
        } catch (Throwable $e) {
            throw SsoException::providerUnavailable('unusable JWKS: ' . $e->getMessage());
        }
    }

    private function getJson(string $endpoint, string $what): array
    {
        [$request, $url] = $this->http->to($endpoint);
        try {
            $response = $request->get($url);
        } catch (ConnectionException $e) {
            throw SsoException::providerUnavailable("{$what}: " . $e->getMessage());
        }
        $this->ensureOk($response, $what);

        $json = $response->json();
        if (! is_array($json)) {
            throw SsoException::providerUnavailable("{$what} is not JSON");
        }

        return $json;
    }

    private function ensureOk(Response $response, string $what): void
    {
        if (! $response->successful()) {
            throw SsoException::providerUnavailable("{$what} answered HTTP {$response->status()}");
        }
    }
}
