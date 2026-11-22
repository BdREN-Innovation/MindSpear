<?php

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Mail;
use Laravel\Socialite\Facades\Socialite;

// LOCAL_SIGNUP_ENABLED=false: every new account comes from BDREN. See SSO_INTEGRATION.md §3.

uses(DatabaseTransactions::class);

beforeEach(function () {
    $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);
    Mail::fake();
    config([
        'cache.default' => 'array',
        'sso.enabled' => true,
        'sso.local_signup' => false,
        'sso.platform_url' => 'https://bdren.sso.test',
        'sso.app_url' => 'http://localhost:3001',
        'services.google.client_id' => 'google-client',
        'services.google.redirect' => 'http://localhost:3001/auth/google/callback',
    ]);
    $this->email = 'signup-' . strtolower(str()->random(10)) . '@example.test';
});

function signupPayload(string $email): array
{
    return [
        'first_name' => 'Nadia',
        'last_name' => 'Rahman',
        'email' => $email,
        'password' => 'Secret-password-1',
        'password_confirmation' => 'Secret-password-1',
    ];
}

/** Makes the Google callback return this person without calling Google. */
function fakeGoogleUser(string $email): void
{
    $socialUser = (object) ['id' => 'google-' . str()->random(8), 'name' => 'Nadia Rahman', 'email' => $email, 'avatar' => null, 'user' => []];
    $provider = Mockery::mock();
    $provider->shouldReceive('stateless')->andReturnSelf();
    $provider->shouldReceive('user')->andReturn($socialUser);
    Socialite::shouldReceive('driver')->with('google')->andReturn($provider);
}

const BDREN_SIGNUP_URL = 'https://bdren.sso.test/register?next=http%3A%2F%2Flocalhost%3A3001%2Fauth%2Fsign-in%3Fsso%3Dstart';

it('tells the frontend where new people sign up', function () {
    $this->getJson('/api/v1/sso/config')
        ->assertOk()
        ->assertJsonPath('data.local_signup', false)
        ->assertJsonPath('data.signup_url', BDREN_SIGNUP_URL);

    config(['sso.enabled' => false]);
    $this->getJson('/api/v1/sso/config')->assertOk()->assertJsonPath('data.signup_url', null);
});

it('refuses the sign-up form and points to BDREN', function () {
    $this->postJson('/api/v1/register', signupPayload($this->email))
        ->assertForbidden()
        ->assertJsonPath('data.code', 'signup_disabled')
        ->assertJsonPath('data.signup_url', BDREN_SIGNUP_URL);

    expect(User::where('email', $this->email)->exists())->toBeFalse();
});

it('still creates accounts from the form while local sign-up is on', function () {
    config(['sso.local_signup' => true]);

    $this->postJson('/api/v1/register', signupPayload($this->email))->assertSuccessful();

    expect(User::where('email', $this->email)->exists())->toBeTrue();
});

it('refuses a first-time Google login without creating an account', function () {
    fakeGoogleUser($this->email);

    $this->getJson('/api/v1/auth/google/callback?code=abc')
        ->assertForbidden()
        ->assertJsonPath('data.code', 'signup_disabled');

    expect(User::where('email', $this->email)->exists())->toBeFalse();
});

it('keeps Google login working for an existing account', function () {
    $user = User::create([
        'first_name' => 'Nadia',
        'last_name' => 'Rahman',
        'email' => $this->email,
        'password' => bcrypt('Secret-password-1'),
        'is_verified' => true,
        'email_verified_at' => now(),
    ]);
    fakeGoogleUser($this->email);

    $this->getJson('/api/v1/auth/google/callback?code=abc')
        ->assertOk()
        ->assertJsonPath('data.user.id', $user->id);
});
