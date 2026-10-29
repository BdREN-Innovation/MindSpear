<?php

use App\Models\File;
use App\Models\Quiz\BankQuestion;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

beforeEach(function () {
    Storage::fake('local');
    config([
        'cache.default' => 'array',
        'file_library.disk' => 'local',
        'file_library.default_quota_mb' => 100,
        'file_library.max_image_mb' => 10,
        'file_library.max_document_mb' => 25,
    ]);
});

function libUser(?int $quotaBytes = null): User
{
    return User::create([
        'first_name' => 'Lib',
        'last_name' => 'User',
        'email' => 'lib-' . str()->uuid() . '@example.test',
        'email_verified_at' => now(),
        'is_verified' => true,
        'password' => Hash::make('password'),
        'storage_quota_bytes' => $quotaBytes,
    ]);
}

function libUpload(UploadedFile $file, ?string $name = null)
{
    return test()->post('/api/v1/library/files', array_filter(['file' => $file, 'name' => $name]), ['Accept' => 'application/json']);
}

it('stores images publicly and documents privately in the user library', function () {
    $user = libUser();
    Sanctum::actingAs($user);

    $image = libUpload(UploadedFile::fake()->image('diagram.png', 40, 40))->assertCreated();
    $image->assertJsonPath('data.file.category', 'image')
        ->assertJsonPath('data.file.name', 'diagram')
        ->assertJsonPath('data.file.isPublic', true);
    $imageRow = File::find($image->json('data.file.id'));
    expect($imageRow->disk_path)->toStartWith("public/library/{$user->id}/images/")
        ->and($imageRow->getRawOriginal('path'))->toStartWith("storage/library/{$user->id}/images/");
    Storage::disk('local')->assertExists($imageRow->disk_path);

    $doc = libUpload(UploadedFile::fake()->create('Lecture 1.pdf', 200, 'application/pdf'), 'Week 1 lecture')->assertCreated();
    $doc->assertJsonPath('data.file.category', 'document')
        ->assertJsonPath('data.file.name', 'Week 1 lecture')
        ->assertJsonPath('data.file.isPublic', false)
        ->assertJsonPath('data.file.extractionStatus', 'client');
    $docRow = File::find($doc->json('data.file.id'));
    expect($docRow->disk_path)->toStartWith("private/library/{$user->id}/documents/")
        ->and($docRow->getRawOriginal('path'))->toBeNull()
        ->and($doc->json('data.file.url'))->toEndWith("/api/v1/library/files/{$docRow->id}/content");

    $this->getJson('/api/v1/library/files')
        ->assertOk()
        ->assertJsonCount(2, 'data.files')
        ->assertJsonPath('data.usage.documents.count', 1)
        ->assertJsonPath('data.usage.images.count', 1);

    $this->getJson('/api/v1/library/files?category=image')->assertJsonCount(1, 'data.files');
    $this->getJson('/api/v1/library/files?search=week')->assertJsonCount(1, 'data.files')
        ->assertJsonPath('data.files.0.id', $docRow->id);
});

it('rejects unsupported, disguised and oversized files with clear messages', function () {
    $user = libUser();
    Sanctum::actingAs($user);

    libUpload(UploadedFile::fake()->create('logo.svg', 5, 'image/svg+xml'))
        ->assertStatus(422)->assertJsonPath('data.code', 'invalid_file');
    libUpload(UploadedFile::fake()->create('old.ppt', 5, 'application/vnd.ms-powerpoint'))
        ->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'save it as .pptx'));
    libUpload(UploadedFile::fake()->create('fake.pdf', 5, 'image/png'))
        ->assertStatus(422)->assertJsonPath('data.code', 'invalid_file');

    config(['file_library.max_image_mb' => 1]);
    libUpload(UploadedFile::fake()->create('huge.png', 1500, 'image/png'))
        ->assertStatus(422)
        ->assertJsonPath('data.validation_errors.file.0', fn ($m) => str_contains($m, 'at most 1 MB'));

    expect(File::where('user_id', $user->id)->count())->toBe(0);
});

it('reuses an identical upload without using more storage', function () {
    Sanctum::actingAs(libUser());

    $first = libUpload(UploadedFile::fake()->createWithContent('notes.txt', "Photosynthesis turns light into energy.\n"))->assertCreated();
    $second = libUpload(UploadedFile::fake()->createWithContent('copy of notes.txt', "Photosynthesis turns light into energy.\n"))->assertCreated();

    expect($second->json('data.deduplicated'))->toBeTrue()
        ->and($second->json('data.file.id'))->toBe($first->json('data.file.id'))
        ->and($second->json('data.usage.used'))->toBe($first->json('data.usage.used'));
});

it('enforces the default quota and a per-user override', function () {
    config(['file_library.default_quota_mb' => 1]);
    Sanctum::actingAs(libUser());

    libUpload(libSized('a.pdf', 700))->assertCreated();
    $full = libUpload(libSized('b.pdf', 700))->assertStatus(422);
    $full->assertJsonPath('data.code', 'quota_exceeded')
        ->assertJsonPath('data.limit', 1024 * 1024)
        ->assertJsonPath('data.used', 700 * 1024)
        ->assertJsonPath('data.required', 700 * 1024);
    expect($full->json('message'))->toContain('Not enough storage');
    // The rejected file was not left behind on disk.
    expect(Storage::disk('local')->allFiles('private'))->toHaveCount(1);

    Sanctum::actingAs(libUser(5 * 1024 * 1024));
    libUpload(libSized('a.pdf', 700))->assertCreated();
    libUpload(libSized('b.pdf', 700))->assertCreated();
    $this->getJson('/api/v1/library/usage')->assertJsonPath('data.usage.limit', 5 * 1024 * 1024)
        ->assertJsonPath('data.usage.used', 1400 * 1024);
});

it('soft deletes files, keeps them on disk and frees their quota', function () {
    config(['file_library.default_quota_mb' => 1]);
    $user = libUser();
    Sanctum::actingAs($user);

    $id = libUpload(libSized('a.pdf', 800))->assertCreated()->json('data.file.id');
    libUpload(libSized('b.pdf', 800))->assertStatus(422);

    $this->deleteJson("/api/v1/library/files/{$id}")->assertOk()->assertJsonPath('data.usage.used', 0);

    $trashed = File::withTrashed()->find($id);
    expect($trashed->trashed())->toBeTrue()
        ->and($trashed->is_deleted)->toBeTrue()
        ->and($trashed->deleted_by)->toBe($user->id);
    Storage::disk('local')->assertExists($trashed->disk_path);

    $this->getJson("/api/v1/library/files/{$id}")->assertNotFound();
    $this->getJson('/api/v1/library/files')->assertJsonCount(0, 'data.files');
    libUpload(libSized('b.pdf', 800))->assertCreated();
});

it('hides other users files', function () {
    $owner = libUser();
    Sanctum::actingAs($owner);
    $id = libUpload(UploadedFile::fake()->create('secret.pdf', 10, 'application/pdf'))->json('data.file.id');

    Sanctum::actingAs(libUser());
    $this->getJson("/api/v1/library/files/{$id}")->assertNotFound();
    $this->getJson("/api/v1/library/files/{$id}/content")->assertNotFound();
    $this->getJson("/api/v1/library/files/{$id}/pages")->assertNotFound();
    $this->patchJson("/api/v1/library/files/{$id}", ['name' => 'mine'])->assertNotFound();
    $this->deleteJson("/api/v1/library/files/{$id}")->assertNotFound();
    $this->getJson('/api/v1/library/files')->assertJsonCount(0, 'data.files');

    expect(File::find($id)->name)->toBe('secret');
});

it('renames files and streams their content to the owner', function () {
    Sanctum::actingAs(libUser());
    $id = libUpload(UploadedFile::fake()->createWithContent('notes.txt', 'Hello world'))->json('data.file.id');

    $this->patchJson("/api/v1/library/files/{$id}", ['name' => '  '])->assertStatus(422);
    $this->patchJson("/api/v1/library/files/{$id}", ['name' => 'Biology notes'])->assertOk()
        ->assertJsonPath('data.file.name', 'Biology notes');

    $content = $this->get("/api/v1/library/files/{$id}/content");
    $content->assertOk();
    expect($content->streamedContent())->toBe('Hello world');

    $this->get("/api/v1/library/files/{$id}/content?download=1")
        ->assertHeader('content-disposition', 'attachment; filename="Biology notes.txt"');
});

it('warns before deleting an image that bank questions still use', function () {
    $user = libUser();
    Sanctum::actingAs($user);
    $upload = libUpload(UploadedFile::fake()->image('cell.png', 20, 20))->assertCreated();
    $id = $upload->json('data.file.id');

    BankQuestion::create([
        'owner_id' => $user->id,
        'question_type' => 'quiz_single_choice',
        'question_text' => 'What is shown?',
        'options' => ['choices' => ['A', 'B'], 'correct_answer' => 0],
        'source_content_url' => $upload->json('data.file.url'),
        'visibility' => 'private',
    ]);

    $this->deleteJson("/api/v1/library/files/{$id}")
        ->assertStatus(409)
        ->assertJsonPath('data.code', 'file_in_use')
        ->assertJsonPath('data.references.question bank', 1);
    expect(File::find($id))->not->toBeNull();

    $this->deleteJson("/api/v1/library/files/{$id}?force=1")->assertOk();
    expect(File::find($id))->toBeNull();
});
