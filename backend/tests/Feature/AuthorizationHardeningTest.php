<?php

use App\Models\Institution;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Spatie\Permission\Models\Role;

// Shared records (institutions, site preferences) are admin-only to change; private bank
// items stay private; a changed email must be verified again.

uses(DatabaseTransactions::class);

beforeEach(function () {
    config(['cache.default' => 'array']);
    Mail::fake();
});

it('lets ordinary users read institutions but not change them', function () {
    Sanctum::actingAs(User::factory()->create());
    $institution = Institution::create(['name' => 'Test University']);

    $this->getJson('/api/v1/institutions')->assertOk();
    $this->postJson('/api/v1/institutions/store', ['name' => 'Fake'])->assertForbidden();
    $this->postJson("/api/v1/institutions/update/{$institution->id}", ['name' => 'Defaced'])->assertForbidden();
    $this->deleteJson("/api/v1/institutions/delete/{$institution->id}")->assertForbidden();
    expect(Institution::find($institution->id)->name)->toBe('Test University');
});

it('keeps site preferences for the Super Admin only', function () {
    Sanctum::actingAs(User::factory()->create());
    $this->getJson('/api/v1/preferences')->assertForbidden();
    $this->postJson('/api/v1/preferences/store', ['category' => 'site', 'field' => 'title', 'value' => 'x'])->assertForbidden();
    $this->deleteJson('/api/v1/preferences/delete/site/title')->assertForbidden();

    $admin = User::factory()->create();
    $admin->assignRole(Role::firstOrCreate(['name' => 'Super Admin', 'guard_name' => 'web']));
    Sanctum::actingAs($admin);
    $this->getJson('/api/v1/preferences')->assertOk();
});

it('hides other people\'s private bank questions', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $category = DB::table('quiz_q_bank_categories')->insertGetId(['name' => 'Cat ' . str()->random(5), 'created_by' => $owner->id, 'created_at' => now(), 'updated_at' => now()]);
    $private = DB::table('quiz_bank_questions')->insertGetId([
        'owner_id' => $owner->id, 'q_bank_category_id' => $category, 'question_text' => 'Secret?', 'question_type' => 'single_choice',
        'options' => json_encode(['choices' => ['a', 'b'], 'correct_answer' => 0]), 'visibility' => 'private', 'created_at' => now(), 'updated_at' => now(),
    ]);

    Sanctum::actingAs($other);
    $this->getJson("/api/v1/quiz/question-bank/show/{$private}")->assertNotFound();

    Sanctum::actingAs($owner);
    $response = $this->getJson("/api/v1/quiz/question-bank/show/{$private}")->assertOk();
    expect($response->json('data.question.owner'))->not->toHaveKey('email');
});

it('holds a changed email as pending until the link sent to it is used', function () {
    $user = User::factory()->create(['is_verified' => true, 'email_verified_at' => now()]);
    $old = $user->email;
    Sanctum::actingAs($user);
    $new = 'changed-' . strtolower(str()->random(8)) . '@example.test';

    $this->putJson('/api/v1/profile/update', ['first_name' => $user->first_name, 'last_name' => $user->last_name, 'email' => $new])->assertOk();

    $user->refresh();
    // The real address is untouched: nobody can park someone else's address on their account.
    expect($user->email)->toBe($old)
        ->and($user->pending_email)->toBe($new)
        ->and($user->is_verified)->toBeTrue();
    Mail::assertSent(\App\Mail\VerifyEmailMail::class, fn ($mail) => $mail->hasTo($new));

    // Someone else's address can't even be requested.
    $taken = User::factory()->create();
    $this->putJson('/api/v1/profile/update', ['first_name' => 'x', 'last_name' => 'y', 'email' => strtoupper($taken->email)])->assertStatus(422);

    // The link from the new inbox completes the change and signs out every device.
    $this->postJson('/api/v1/verify-email', ['email' => $new, 'token' => $user->pending_email_token])->assertOk();
    $user->refresh();
    expect($user->email)->toBe($new)->and($user->pending_email)->toBeNull()->and($user->tokens()->count())->toBe(0);
});
