<?php

use App\Mail\VerifyEmailMail;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;

uses(DatabaseTransactions::class);

function unverifiedUser(): User
{
    return User::create([
        'first_name' => 'Un',
        'last_name' => 'Verified',
        'email' => 'unverified-' . str()->uuid() . '@example.test',
        'email_verification_token' => 'secret-token',
        'password' => Hash::make('password'),
    ]);
}

it('keeps the verification token out of the register response', function () {
    Mail::fake();
    $email = 'register-' . str()->uuid() . '@example.test';

    $this->postJson('/api/v1/register', [
        'first_name' => 'New',
        'last_name' => 'User',
        'email' => $email,
        'password' => 'secret-password',
        'password_confirmation' => 'secret-password',
    ])
        ->assertCreated()
        ->assertJsonPath('data.user.email', $email)
        ->assertJsonMissingPath('data.user.email_verification_token');

    expect(User::where('email', $email)->value('email_verification_token'))->toHaveLength(60);
});

it('allows five resends an hour per address, whatever its case', function () {
    Mail::fake();
    $user = unverifiedUser();
    $other = unverifiedUser();

    foreach (range(1, 5) as $attempt) {
        $this->postJson('/api/v1/resend-verification', ['email' => $user->email])->assertOk();
    }

    $this->postJson('/api/v1/resend-verification', ['email' => strtoupper($user->email)])->assertStatus(429);
    Mail::assertSent(VerifyEmailMail::class, 5);

    $this->postJson('/api/v1/resend-verification', ['email' => $other->email])->assertOk();
});
