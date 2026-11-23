<?php

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Mail;

// Password guessing and reset-token guessing are slowed down per account and per address.

uses(DatabaseTransactions::class);

beforeEach(function () {
    config(['cache.default' => 'array']);
    Mail::fake();
});

it('limits password attempts per account', function () {
    $email = 'limit-' . strtolower(str()->random(8)) . '@example.test';
    $tries = fn () => $this->postJson('/api/v1/login', ['email' => $email, 'password' => 'wrong-password'])->status();

    $seen = collect(range(1, 11))->map(fn () => $tries());

    // Unknown address and wrong password answer alike (401), so the form can't list customers.
    expect($seen->take(10)->unique()->all())->toBe([401])
        ->and($seen->last())->toBe(429);
});

it('limits forgot-password requests per address', function () {
    $email = 'reset-' . strtolower(str()->random(8)) . '@example.test';
    $statuses = collect(range(1, 6))->map(fn () => $this->postJson('/api/v1/forgot-password', ['email' => $email])->status());

    expect($statuses->last())->toBe(429)->and($statuses->first())->not->toBe(429);
});
