<?php

use App\Models\User;
use App\Modules\Sso\Models\SsoIdentity;
use App\Modules\Sso\Services\EntitlementsClient;
use App\Modules\Sso\Services\SsoHttp;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

const SSO_ISSUER = 'https://auth.sso.test';
const SSO_API = 'https://api.sso.test/api/v1';
const SSO_CLIENT = 'mindspear-client';

/** An RSA key pair as [private PEM, public JWK]. */
function ssoKeyPair(string $kid): array
{
    $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    openssl_pkey_export($key, $pem);
    $rsa = openssl_pkey_get_details($key)['rsa'];
    $b64 = fn (string $bin) => rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');

    return [$pem, ['kty' => 'RSA', 'use' => 'sig', 'alg' => 'RS256', 'kid' => $kid, 'n' => $b64($rsa['n']), 'e' => $b64($rsa['e'])]];
}

beforeEach(function () {
    // The sso rate limiter keeps its counts in Redis across tests.
    $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);
    config([
        'cache.default' => 'array',
        'sso.enabled' => true,
        'sso.issuer' => SSO_ISSUER,
        'sso.client_id' => SSO_CLIENT,
        'sso.client_secret' => 'client-secret',
        'sso.redirect_uri' => 'http://localhost:3001/auth/sso/callback',
        'sso.post_logout_redirect_uri' => 'http://localhost:3001/auth/sign-in',
        'sso.connect_url' => null,
        'sso.link_by_verified_email' => true,
        'sso.auto_create_users' => true,
        'sso.api_url' => SSO_API,
        'sso.product' => 'mindspear',
        'sso.product_api_key' => 'product-key',
        'sso.platform_url' => 'https://bdren.sso.test',
        'sso.app_url' => 'http://localhost:3001',
        'sso.features' => ['ai_requests'],
        'sso.enforce_entitlements' => true,
        'sso.fail_open' => true,
    ]);

    [$this->pem, $this->jwk] = ssoKeyPair('key-1');
    $this->jwks = ['keys' => [$this->jwk]];
    $this->subject = 'zitadel-' . str()->random(12);
    $this->email = 'sso-' . strtolower(str()->random(10)) . '@example.test';
    // What the next token response's ID token says; tests change it before the callback.
    $this->claims = fn (string $nonce) => [
        'iss' => SSO_ISSUER,
        'aud' => [SSO_CLIENT, 'project-id'],
        'azp' => SSO_CLIENT,
        'sub' => $this->subject,
        'nonce' => $nonce,
        'iat' => time(),
        'exp' => time() + 300,
        'email' => $this->email,
        'email_verified' => true,
        'given_name' => 'Ada',
        'family_name' => 'Lovelace',
    ];
    $this->signWith = fn (array $claims) => JWT::encode($claims, $this->pem, 'RS256', 'key-1');
    $this->nonce = null;

    Http::fake(function (HttpRequest $request) {
        $url = $request->url();

        return match (true) {
            str_ends_with($url, '/.well-known/openid-configuration') => Http::response([
                'issuer' => SSO_ISSUER,
                'authorization_endpoint' => SSO_ISSUER . '/oauth/v2/authorize',
                'token_endpoint' => SSO_ISSUER . '/oauth/v2/token',
                'jwks_uri' => SSO_ISSUER . '/oauth/v2/keys',
                'userinfo_endpoint' => SSO_ISSUER . '/oidc/v1/userinfo',
                'end_session_endpoint' => SSO_ISSUER . '/oidc/v1/end_session',
            ]),
            $url === SSO_ISSUER . '/oauth/v2/keys' => Http::response($this->jwks),
            $url === SSO_ISSUER . '/oauth/v2/token' => Http::response([
                'access_token' => 'access-token',
                'token_type' => 'Bearer',
                'id_token' => ($this->signWith)(($this->claims)($this->nonce)),
            ]),
            default => Http::response(['detail' => 'unexpected ' . $url], 500),
        };
    });
});

/** Starts a login (or link) and returns the state, remembering the nonce for the fake token endpoint. */
function ssoStart($test, string $path = '/api/v1/sso/login'): string
{
    $url = $test->postJson($path)->assertOk()->json('data.redirect_url');
    parse_str(parse_url($url, PHP_URL_QUERY), $query);
    $test->nonce = $query['nonce'];

    return $query['state'];
}

function ssoUser(string $email): User
{
    return User::create([
        'first_name' => 'Existing',
        'last_name' => 'User',
        'email' => $email,
        'password' => Hash::make('secret-password'),
        'is_verified' => true,
        'email_verified_at' => now(),
    ]);
}

it('stays off and invisible while SSO_ENABLED is false', function () {
    config(['sso.enabled' => false]);

    $this->getJson('/api/v1/sso/config')->assertOk()->assertJsonPath('data.enabled', false);
    $this->postJson('/api/v1/sso/login')->assertNotFound()->assertJsonPath('data.code', 'sso_disabled');
});

it('publishes the config with ZITADEL logout page', function () {
    $this->getJson('/api/v1/sso/config')
        ->assertOk()
        ->assertJsonPath('data.enabled', true)
        ->assertJsonPath('data.logout_url', SSO_ISSUER . '/oidc/v1/end_session?client_id=' . SSO_CLIENT . '&post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fauth%2Fsign-in');
});

it('starts a login with code + PKCE S256', function () {
    $url = $this->postJson('/api/v1/sso/login')->assertOk()->json('data.redirect_url');
    parse_str(parse_url($url, PHP_URL_QUERY), $query);

    expect($url)->toStartWith(SSO_ISSUER . '/oauth/v2/authorize?')
        ->and($query)->toMatchArray([
            'client_id' => SSO_CLIENT,
            'response_type' => 'code',
            'scope' => 'openid profile email',
            'code_challenge_method' => 'S256',
            'redirect_uri' => 'http://localhost:3001/auth/sso/callback',
        ])
        ->and(strlen($query['code_challenge']))->toBe(43)
        ->and($query['state'])->not->toBeEmpty()
        ->and($query['nonce'])->not->toBeEmpty()
        ->and($query)->not->toHaveKey('prompt');
});

it('asks BDREN silently (prompt=none) only when silent is requested', function () {
    $url = $this->postJson('/api/v1/sso/login', ['silent' => true])->assertOk()->json('data.redirect_url');
    parse_str(parse_url($url, PHP_URL_QUERY), $query);
    expect($query['prompt'] ?? null)->toBe('none');

    $url = $this->postJson('/api/v1/sso/login', ['silent' => false])->assertOk()->json('data.redirect_url');
    parse_str(parse_url($url, PHP_URL_QUERY), $query);
    expect($query)->not->toHaveKey('prompt');
});

it('creates a new user on the first login and reuses it after', function () {
    $state = ssoStart($this);
    $response = $this->postJson('/api/v1/sso/callback', ['code' => 'code-1', 'state' => $state])
        ->assertOk()
        ->assertJsonPath('data.mode', 'login')
        ->assertJsonPath('data.provider', 'bdren')
        ->assertJsonPath('data.sso.created', true)
        ->assertJsonPath('data.user.email', $this->email)
        ->assertJsonPath('data.user.first_name', 'Ada');

    $userId = $response->json('data.user.id');
    expect(SsoIdentity::where('subject', $this->subject)->value('user_id'))->toBe($userId);

    // The token is an ordinary Sanctum token.
    $this->withToken($response->json('data.token'))->getJson('/api/v1/user-check')->assertOk()->assertJsonPath('data.user.id', $userId);

    // Token exchange used client_secret_basic and the PKCE verifier.
    Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/oauth/v2/token')
        && $r->hasHeader('Authorization', 'Basic ' . base64_encode(SSO_CLIENT . ':client-secret'))
        && strlen($r['code_verifier']) === 96);

    app('auth')->forgetGuards();
    $again = $this->postJson('/api/v1/sso/callback', ['code' => 'code-2', 'state' => ssoStart($this)])->assertOk();
    expect($again->json('data.user.id'))->toBe($userId)
        ->and($again->json('data.sso.created'))->toBeFalse()
        ->and(User::where('email', $this->email)->count())->toBe(1);
});

it('links an existing user by verified email, keeping their account', function () {
    $user = ssoUser(strtoupper($this->email));

    $this->postJson('/api/v1/sso/callback', ['code' => 'c', 'state' => ssoStart($this)])
        ->assertOk()
        ->assertJsonPath('data.user.id', $user->id)
        ->assertJsonPath('data.sso.linked_via', 'email');

    expect(Hash::check('secret-password', $user->fresh()->password))->toBeTrue();
});

it('does not link by email when BDREN has not verified it', function () {
    ssoUser($this->email);
    $claims = $this->claims;
    $this->claims = fn (string $nonce) => ['email_verified' => false] + $claims($nonce);

    $this->postJson('/api/v1/sso/callback', ['code' => 'c', 'state' => ssoStart($this)])
        ->assertStatus(409)
        ->assertJsonPath('data.code', 'email_in_use');
    expect(SsoIdentity::where('subject', $this->subject)->exists())->toBeFalse();
});

it('refuses unknown people when auto-create is off', function () {
    config(['sso.auto_create_users' => false]);

    $this->postJson('/api/v1/sso/callback', ['code' => 'c', 'state' => ssoStart($this)])
        ->assertForbidden()
        ->assertJsonPath('data.code', 'no_account');
});

it('accepts a state only once', function () {
    $state = ssoStart($this);
    $this->postJson('/api/v1/sso/callback', ['code' => 'c', 'state' => $state])->assertOk();
    app('auth')->forgetGuards();
    $this->postJson('/api/v1/sso/callback', ['code' => 'c', 'state' => $state])
        ->assertStatus(400)
        ->assertJsonPath('data.code', 'invalid_state');
});

it('rejects an ID token that fails a check', function (Closure $tamper) {
    $claims = $this->claims;
    $this->claims = fn (string $nonce) => $tamper($claims($nonce));

    $this->postJson('/api/v1/sso/callback', ['code' => 'c', 'state' => ssoStart($this)])
        ->assertStatus(400)
        ->assertJsonPath('data.code', 'invalid_token');
    expect(User::where('email', $this->email)->exists())->toBeFalse();
})->with([
    'wrong nonce' => [fn (array $c) => ['nonce' => 'other'] + $c],
    'wrong issuer' => [fn (array $c) => ['iss' => 'https://evil.test'] + $c],
    'wrong audience' => [fn (array $c) => ['aud' => 'someone-else'] + $c],
    'wrong azp' => [fn (array $c) => ['azp' => 'someone-else'] + $c],
    'expired' => [fn (array $c) => ['exp' => time() - 3600, 'iat' => time() - 7200] + $c],
]);

it('rejects an ID token not signed with RS256 by the issuer', function (string $how) {
    $sign = $this->signWith;
    $this->signWith = match ($how) {
        'hs256' => fn (array $c) => JWT::encode($c, 'shared-secret-shared-secret-1234', 'HS256', 'key-1'),
        'other key' => fn (array $c) => JWT::encode($c, ssoKeyPair('key-1')[0], 'RS256', 'key-1'),
    };

    $this->postJson('/api/v1/sso/callback', ['code' => 'c', 'state' => ssoStart($this)])
        ->assertStatus(400)
        ->assertJsonPath('data.code', 'invalid_token');
})->with(['hs256', 'other key']);

it('fetches the key set again when ZITADEL rotated its signing key', function () {
    // Cache the old key set first.
    $this->postJson('/api/v1/sso/callback', ['code' => 'c', 'state' => ssoStart($this)])->assertOk();
    app('auth')->forgetGuards();

    [$this->pem, $newJwk] = ssoKeyPair('key-2');
    $this->jwks = ['keys' => [$this->jwk, $newJwk]];
    $this->signWith = fn (array $c) => JWT::encode($c, $this->pem, 'RS256', 'key-2');

    $this->postJson('/api/v1/sso/callback', ['code' => 'c', 'state' => ssoStart($this)])->assertOk();
});

it('reports ZITADEL being down as unavailable, not as a bad login', function () {
    Http::swap(new \Illuminate\Http\Client\Factory());
    Http::fake(['*' => Http::response('', 503)]);

    $this->postJson('/api/v1/sso/login')->assertStatus(502)->assertJsonPath('data.code', 'provider_unavailable');
});

it('links a BDREN identity to the signed-in user from the profile', function () {
    $user = ssoUser('someone-else-' . str()->random(8) . '@example.test');
    Sanctum::actingAs($user);

    $this->getJson('/api/v1/sso/status')->assertOk()->assertJsonPath('data.linked', false);
    $state = ssoStart($this, '/api/v1/sso/link');
    $this->postJson('/api/v1/sso/callback', ['code' => 'c', 'state' => $state])
        ->assertOk()
        ->assertJsonPath('data.mode', 'link')
        ->assertJsonPath('data.identity.linked_via', 'link');

    $this->getJson('/api/v1/sso/status')->assertJsonPath('data.linked', true)->assertJsonPath('data.identity.subject', $this->subject);

    // From now on, SSO logins land in this account (not a new one for the BDREN email).
    app('auth')->forgetGuards();
    $this->app['auth']->guard('sanctum')->forgetUser();
    $this->postJson('/api/v1/sso/callback', ['code' => 'c', 'state' => ssoStart($this)])->assertOk()->assertJsonPath('data.user.id', $user->id);

    Sanctum::actingAs($user);
    $this->deleteJson('/api/v1/sso/link')->assertOk()->assertJsonPath('data.unlinked', true);
    expect(SsoIdentity::forUser($user))->toBeNull();
});

it('refuses a link callback completed by a different user', function () {
    Sanctum::actingAs(ssoUser('a-' . str()->random(8) . '@example.test'));
    $state = ssoStart($this, '/api/v1/sso/link');

    Sanctum::actingAs(ssoUser('b-' . str()->random(8) . '@example.test'));
    $this->postJson('/api/v1/sso/callback', ['code' => 'c', 'state' => $state])
        ->assertForbidden()
        ->assertJsonPath('data.code', 'link_user_mismatch');
});

it('refuses to link an identity that belongs to another user', function () {
    $owner = ssoUser('owner-' . str()->random(8) . '@example.test');
    SsoIdentity::create(['user_id' => $owner->id, 'issuer' => SSO_ISSUER, 'subject' => $this->subject, 'linked_via' => 'link']);

    Sanctum::actingAs(ssoUser('other-' . str()->random(8) . '@example.test'));
    $this->postJson('/api/v1/sso/callback', ['code' => 'c', 'state' => ssoStart($this, '/api/v1/sso/link')])
        ->assertStatus(409)
        ->assertJsonPath('data.code', 'identity_in_use');
});

describe('entitlements', function () {
    beforeEach(function () {
        $this->linked = ssoUser('ent-' . str()->random(8) . '@example.test');
        SsoIdentity::create(['user_id' => $this->linked->id, 'issuer' => SSO_ISSUER, 'subject' => $this->subject, 'linked_via' => 'link']);
        $this->api = [];
        Http::swap(new \Illuminate\Http\Client\Factory());
        Http::fake(function (HttpRequest $request) {
            $path = substr($request->url(), strlen(SSO_API));
            $this->api[] = $path;
            $answer = $this->apiAnswers[$path] ?? null;

            return $answer ? Http::response(...$answer) : Http::response(['detail' => 'not found'], 404);
        });
        $this->apiAnswers = [];
    });

    it('lists the limits of a linked user', function () {
        $this->apiAnswers['/entitlements/check/'] = [['allowed' => true, 'limit' => 50, 'used' => 3, 'reserved' => 1, 'remaining' => 46, 'reset_at' => '2026-12-01T00:00:00Z']];
        Sanctum::actingAs($this->linked);

        $this->getJson('/api/v1/sso/entitlements')
            ->assertOk()
            ->assertJsonPath('data.features.0.status', 'ok')
            ->assertJsonPath('data.features.0.remaining', 46)
            ->assertJsonPath('data.activate_url', null);

        Http::assertSent(fn (HttpRequest $r) => $r->hasHeader('X-Product-Api-Key', 'product-key')
            && $r['issuer'] === SSO_ISSUER && $r['zitadel_subject'] === $this->subject && $r['product'] === 'mindspear');
    });

    it('asks a person BDREN does not know yet to activate once', function () {
        $this->apiAnswers['/entitlements/check/'] = [['detail' => 'Target user not found or inactive'], 403];
        Sanctum::actingAs($this->linked);

        $this->getJson('/api/v1/sso/entitlements')
            ->assertOk()
            ->assertJsonPath('data.features.0.status', 'not_provisioned')
            ->assertJsonPath('data.activate_url', 'https://bdren.sso.test/api/v1/auth/login/?next=http%3A%2F%2Flocalhost%3A3001%2Fprofile');
    });

    it('never limits users without a BDREN identity', function () {
        Sanctum::actingAs(ssoUser('plain-' . str()->random(8) . '@example.test'));

        $this->getJson('/api/v1/sso/entitlements')->assertOk()->assertJsonPath('data.features.0.status', 'not_linked');
        expect($this->api)->toBeEmpty();
    });

    it('enforces a limit with the sso.entitlement middleware', function () {
        Route::middleware(['api', 'auth:sanctum', 'sso.entitlement:ai_requests'])->get('/api/v1/sso-test/ai', fn () => ['ran' => true]);
        $this->apiAnswers['/entitlements/check/'] = [['allowed' => false, 'limit' => 5, 'used' => 5, 'remaining' => 0]];

        Sanctum::actingAs($this->linked);
        $this->getJson('/api/v1/sso-test/ai')->assertStatus(429)->assertJsonPath('data.code', 'quota_exceeded');

        config(['sso.enforce_entitlements' => false]);
        $this->getJson('/api/v1/sso-test/ai')->assertOk();

        config(['sso.enforce_entitlements' => true]);
        Sanctum::actingAs(ssoUser('plain-' . str()->random(8) . '@example.test'));
        $this->getJson('/api/v1/sso-test/ai')->assertOk();
    });

    it('meters work: reserve, then commit, or release when it fails', function () {
        $this->apiAnswers['/usage/reservations/'] = [['reservation_id' => 'r-1', 'status' => 'reserved'], 201];
        $this->apiAnswers['/usage/reservations/r-1/commit/'] = [['status' => 'committed']];
        $this->apiAnswers['/usage/reservations/r-1/release/'] = [['status' => 'released']];
        $client = app(EntitlementsClient::class);

        expect($client->metered($this->linked, 'ai_requests', 1, fn () => 'done'))->toBe('done')
            ->and($this->api)->toBe(['/usage/reservations/', '/usage/reservations/r-1/commit/']);

        $this->api = [];
        expect(fn () => $client->metered($this->linked, 'ai_requests', 1, fn () => throw new RuntimeException('LLM failed')))
            ->toThrow(RuntimeException::class, 'LLM failed');
        expect($this->api)->toBe(['/usage/reservations/', '/usage/reservations/r-1/release/']);

        $this->apiAnswers['/usage/reservations/'] = [['allowed' => false, 'error' => 'quota_exceeded'], 429];
        expect(fn () => $client->metered($this->linked, 'ai_requests', 1, fn () => 'never'))->toThrow(\App\Modules\Sso\Exceptions\SsoException::class);
    });
});

it('sends server calls through SSO_CONNECT_URL with the public Host header', function () {
    config(['sso.connect_url' => 'http://host.docker.internal:8080', 'sso.issuer' => 'http://auth.bdren.localhost:8080']);
    Http::swap(new \Illuminate\Http\Client\Factory());
    Http::fake(['*' => Http::response(['ok' => true])]);

    [$request, $url] = app(SsoHttp::class)->to('http://auth.bdren.localhost:8080/.well-known/openid-configuration?x=1');
    $request->get($url);
    [$other, $otherUrl] = app(SsoHttp::class)->to('https://elsewhere.test/path');

    expect($url)->toBe('http://host.docker.internal:8080/.well-known/openid-configuration?x=1')
        ->and($otherUrl)->toBe('https://elsewhere.test/path');
    Http::assertSent(fn (HttpRequest $r) => $r->hasHeader('Host', 'auth.bdren.localhost:8080'));
});
