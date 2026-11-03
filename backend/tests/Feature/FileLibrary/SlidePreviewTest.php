<?php

use App\Models\File;
use App\Models\User;
use App\Modules\FileLibrary\Jobs\GenerateSlidePreview;
use App\Modules\FileLibrary\Services\FileStorageService;
use App\Modules\FileLibrary\Services\SlidePreviewService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

beforeEach(function () {
    Storage::fake('local');
    config(['cache.default' => 'array', 'file_library.disk' => 'local', 'file_library.default_quota_mb' => 100]);
    $this->user = slideUser();
    Sanctum::actingAs($this->user);
});

function slideUser(): User
{
    return User::create([
        'first_name' => 'Slide',
        'last_name' => 'Owner',
        'email' => 'slides-' . str()->uuid() . '@example.test',
        'email_verified_at' => now(),
        'is_verified' => true,
        'password' => Hash::make('password'),
    ]);
}

/** A two-slide PPTX; $marker makes its bytes (and so its checksum) unique. */
function slidePptx(string $marker = 'one'): UploadedFile
{
    $p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
    $a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    $r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    $rels = 'http://schemas.openxmlformats.org/package/2006/relationships';
    $slide = fn (string $text) => "<?xml version=\"1.0\"?><p:sld xmlns:p=\"{$p}\" xmlns:a=\"{$a}\"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{$text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>";

    $path = tempnam(sys_get_temp_dir(), 'pptx');
    $zip = new ZipArchive;
    $zip->open($path, ZipArchive::OVERWRITE);
    $zip->addFromString('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    $zip->addFromString('ppt/presentation.xml', "<?xml version=\"1.0\"?><p:presentation xmlns:p=\"{$p}\" xmlns:r=\"{$r}\"><p:sldIdLst><p:sldId id=\"256\" r:id=\"rId1\"/><p:sldId id=\"257\" r:id=\"rId2\"/></p:sldIdLst></p:presentation>");
    $zip->addFromString('ppt/_rels/presentation.xml.rels', "<?xml version=\"1.0\"?><Relationships xmlns=\"{$rels}\"><Relationship Id=\"rId1\" Type=\"{$r}/slide\" Target=\"slides/slide1.xml\"/><Relationship Id=\"rId2\" Type=\"{$r}/slide\" Target=\"slides/slide2.xml\"/></Relationships>");
    $zip->addFromString('ppt/slides/slide1.xml', $slide('First ' . $marker));
    $zip->addFromString('ppt/slides/slide2.xml', $slide('Second'));
    $zip->close();

    return new UploadedFile($path, 'deck.pptx', null, null, true);
}

function uploadedPptx(string $marker = 'one'): File
{
    test()->post('/api/v1/library/files', ['file' => slidePptx($marker)], ['Accept' => 'application/json'])->assertCreated();

    return File::latest('id')->firstOrFail();
}

/** LibreOffice, faked: writes the PDF where the command says it should go. */
function fakeSoffice(): void
{
    Process::fake(function (PendingProcess $process) {
        $outdir = $process->command[array_search('--outdir', $process->command, true) + 1];
        file_put_contents($outdir . '/slides.pdf', '%PDF-1.7 slides');

        return Process::result();
    });
}

it('queues the slide preview on the documents queue when a PPTX is uploaded', function () {
    Bus::fake();

    $file = uploadedPptx();

    Bus::assertDispatched(GenerateSlidePreview::class, fn ($job) => $job->fileId === $file->id && $job->queue === 'documents');
    $this->getJson("/api/v1/library/files/{$file->id}/slide-preview")->assertOk()->assertJsonPath('data.status', 'processing');
    Bus::assertDispatchedTimes(GenerateSlidePreview::class, 1); // Asking again doesn't queue a second one.
});

it('does not queue a preview for other documents', function () {
    Bus::fake();

    $this->post('/api/v1/library/files', ['file' => UploadedFile::fake()->createWithContent('notes.txt', 'Some notes')], ['Accept' => 'application/json'])->assertCreated();

    Bus::assertNotDispatched(GenerateSlidePreview::class);
    $txt = File::latest('id')->firstOrFail();
    $this->getJson("/api/v1/library/files/{$txt->id}/slide-preview")->assertStatus(422);
});

it('converts the PPTX and serves the PDF to its owner', function () {
    Bus::fake();
    $file = uploadedPptx();
    $this->getJson("/api/v1/library/files/{$file->id}/slide-preview/content")->assertNotFound();

    fakeSoffice();
    app(FileStorageService::class)->renderSlidePreview($file);

    Process::assertRan(function (PendingProcess $process) {
        $command = $process->command;

        return collect($command)->contains(fn ($arg) => str_contains($arg, 'ExportHiddenSlides')) // PDF page N must stay slide N.
            && collect($command)->contains(fn ($arg) => str_starts_with($arg, '-env:UserInstallation=file://')); // A profile of its own, with active content off.
    });
    $this->getJson("/api/v1/library/files/{$file->id}/slide-preview")->assertJsonPath('data.status', 'ready');

    $response = $this->get("/api/v1/library/files/{$file->id}/slide-preview/content")->assertOk();
    expect($response->headers->get('Content-Type'))->toBe('application/pdf');
    expect($response->streamedContent())->toBe('%PDF-1.7 slides');
});

it('does not count the preview toward the quota', function () {
    Bus::fake();
    $file = uploadedPptx();
    $before = $this->getJson('/api/v1/library/usage')->json('data.used');

    fakeSoffice();
    app(FileStorageService::class)->renderSlidePreview($file);

    expect($this->getJson('/api/v1/library/usage')->json('data.used'))->toBe($before);
});

it('hides the preview from other users', function () {
    Bus::fake();
    $file = uploadedPptx();
    fakeSoffice();
    app(FileStorageService::class)->renderSlidePreview($file);

    Sanctum::actingAs(slideUser());

    $this->getJson("/api/v1/library/files/{$file->id}/slide-preview")->assertNotFound();
    $this->getJson("/api/v1/library/files/{$file->id}/slide-preview/content")->assertNotFound();
});

it('reports a failed conversion and does not retry it straight away', function () {
    Bus::fake();
    $file = uploadedPptx();
    Process::fake(fn () => Process::result(errorOutput: 'cannot convert', exitCode: 1));

    app(FileStorageService::class)->renderSlidePreview($file);

    $this->getJson("/api/v1/library/files/{$file->id}/slide-preview")->assertOk()->assertJsonPath('data.status', 'failed');
    Bus::assertDispatchedTimes(GenerateSlidePreview::class, 1);
});

it('keeps the upload when the preview cannot be queued', function () {
    Bus::shouldReceive('dispatch')->andThrow(new RuntimeException('redis is down'));

    $file = app(FileStorageService::class)->store($this->user, slidePptx('queue-down'))['file'];

    expect($file->exists)->toBeTrue();
    expect(app(SlidePreviewService::class)->exists($file))->toBeFalse();
});

it('makes a new preview when the file is replaced', function () {
    Bus::fake();
    $file = uploadedPptx('before');
    fakeSoffice();
    app(FileStorageService::class)->renderSlidePreview($file);
    $slides = app(SlidePreviewService::class);
    $oldPreview = $slides->path($file);
    Storage::disk('local')->assertExists($oldPreview);

    $replaced = app(FileStorageService::class)->replace($this->user, $file->fresh(), slidePptx('after'));

    Storage::disk('local')->assertMissing($oldPreview);
    expect($slides->path($replaced))->not->toBe($oldPreview);
    expect($slides->exists($replaced))->toBeFalse();
    Bus::assertDispatchedTimes(GenerateSlidePreview::class, 2);
});
