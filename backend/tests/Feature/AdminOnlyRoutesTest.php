<?php

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Spatie\Permission\Models\Role;

// Server logs and the OAuth client secrets in .env are for the Super Admin only.

uses(DatabaseTransactions::class);

beforeEach(function () {
    config(['cache.default' => 'array']);
});

it('refuses server logs and OAuth secrets to ordinary signed-in users', function () {
    Sanctum::actingAs(User::factory()->create());

    $this->getJson('/api/v1/logs/list-files')->assertForbidden();
    $this->getJson('/api/v1/social-auth-config/google')->assertForbidden();
    $this->postJson('/api/v1/social-auth-config/save', ['provider' => 'google'])->assertForbidden();
});

it('lets the Super Admin through', function () {
    $admin = User::factory()->create();
    $admin->assignRole(Role::firstOrCreate(['name' => 'Super Admin', 'guard_name' => 'web']));
    Sanctum::actingAs($admin);

    $this->getJson('/api/v1/social-auth-config/google')->assertSuccessful();
    expect($this->getJson('/api/v1/logs/list-files')->status())->not->toBe(403);
});

it('tells the sign-in page which social logins are configured', function () {
    config([
        'services.google.client_id' => '', 'services.google.client_secret' => '',
        'services.microsoft.client_id' => 'ms-client',
    ]);

    $this->getJson('/api/v1/sso/config')->assertOk()
        ->assertJsonPath('data.social.google', false)
        ->assertJsonPath('data.social.microsoft', true);
});
