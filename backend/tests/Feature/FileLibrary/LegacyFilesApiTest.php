<?php

use App\Models\File;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

beforeEach(function () {
    Storage::fake('local');
    config(['cache.default' => 'array', 'file_library.disk' => 'local', 'file_library.default_quota_mb' => 100]);
});

function legacyUser(): User
{
    return User::create([
        'first_name' => 'Legacy',
        'last_name' => 'Editor',
        'email' => 'legacy-' . str()->uuid() . '@example.test',
        'email_verified_at' => now(),
        'is_verified' => true,
        'password' => Hash::make('password'),
    ]);
}

it('keeps the /files/store response shape used by the question editors', function () {
    $user = legacyUser();
    Sanctum::actingAs($user);

    $response = $this->post('/api/v1/files/store', [
        'file' => UploadedFile::fake()->image('q1.png', 30, 30),
        'name' => 'q1.png',
    ], ['Accept' => 'application/json'])->assertCreated();

    $path = $response->json('data.file.path');
    expect($response->json('data.file.id'))->toBeInt()
        ->and($path)->toStartWith('http')
        ->and($path)->toContain("/storage/library/{$user->id}/images/");

    $this->getJson('/api/v1/library/usage')->assertJsonPath('data.usage.images.count', 1);
});

it('applies the quota to legacy uploads', function () {
    config(['file_library.default_quota_mb' => 1]);
    Sanctum::actingAs(legacyUser());

    $this->post('/api/v1/files/store', ['file' => libSized('a.png', 900)], ['Accept' => 'application/json'])->assertCreated();
    $this->post('/api/v1/files/store', ['file' => libSized('b.png', 900)], ['Accept' => 'application/json'])
        ->assertStatus(422)
        ->assertJsonPath('data.code', 'quota_exceeded');
});

it('scopes the legacy endpoints to the owner and never deletes on unlink', function () {
    $owner = legacyUser();
    Sanctum::actingAs($owner);
    $id = $this->post('/api/v1/files/store', ['file' => UploadedFile::fake()->image('a.png', 10, 10)], ['Accept' => 'application/json'])->json('data.file.id');

    Sanctum::actingAs(legacyUser());
    $this->getJson("/api/v1/files/show/{$id}")->assertNotFound();
    $this->deleteJson("/api/v1/files/delete/{$id}")->assertNotFound();
    $this->post("/api/v1/files/update/{$id}", ['file' => UploadedFile::fake()->image('b.png', 10, 10)], ['Accept' => 'application/json'])->assertNotFound();
    $this->getJson("/api/v1/files?user_id={$owner->id}")->assertOk()->assertJsonPath('data.files.total', 0);

    Sanctum::actingAs($owner);
    $this->getJson('/api/v1/files')->assertJsonPath('data.files.total', 1);
    $this->deleteJson("/api/v1/files/delete/{$id}")->assertOk()->assertJsonPath('data.retained', true);
    $file = File::find($id);
    expect($file)->not->toBeNull();
    Storage::disk('local')->assertExists($file->disk_path);
});

it('replaces a file in place through /files/update', function () {
    Sanctum::actingAs(legacyUser());
    $id = $this->post('/api/v1/files/store', ['file' => UploadedFile::fake()->image('a.png', 10, 10)], ['Accept' => 'application/json'])->json('data.file.id');
    $old = File::find($id)->disk_path;

    $this->post("/api/v1/files/update/{$id}", ['file' => UploadedFile::fake()->image('b.png', 20, 20), 'name' => 'b'], ['Accept' => 'application/json'])
        ->assertOk()
        ->assertJsonPath('data.file.id', $id)
        ->assertJsonPath('data.file.name', 'b');

    Storage::disk('local')->assertMissing($old);
    Storage::disk('local')->assertExists(File::find($id)->disk_path);
});
