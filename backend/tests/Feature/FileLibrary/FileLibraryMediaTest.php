<?php

use App\Models\Deck\Deck;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use App\Models\File;
use App\Models\User;
use App\Modules\FileLibrary\Services\FileReferenceService;
use App\Modules\FileLibrary\Services\FileStorageService;
use App\Modules\FileLibrary\Services\ImageProcessor;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
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
        'file_library.max_video_mb' => 50,
        'file_library.max_image_dimension' => 1024,
    ]);
});

function mediaLibUser(): User
{
    return User::create([
        'first_name' => 'Media',
        'last_name' => 'User',
        'email' => 'media-lib-' . str()->uuid() . '@example.test',
        'email_verified_at' => now(),
        'is_verified' => true,
        'password' => Hash::make('password'),
    ]);
}

function mediaLibUpload(UploadedFile $file)
{
    return test()->post('/api/v1/library/files', ['file' => $file], ['Accept' => 'application/json']);
}

/**
 * A real image drawn with GD: stripes so the bytes compress like a picture, and an
 * optional transparent left edge so we can check alpha survives the resize.
 */
function mediaLibImage(string $name, int $width, int $height, string $format = 'png', bool $transparentEdge = false): UploadedFile
{
    $image = imagecreatetruecolor($width, $height);
    imagealphablending($image, false);
    imagesavealpha($image, true);
    imagefilledrectangle($image, 0, 0, $width - 1, $height - 1, imagecolorallocatealpha($image, 30, 120, 200, 0));
    for ($x = 0; $x < $width; $x += 40) {
        imagefilledrectangle($image, $x, 0, $x + 19, $height - 1, imagecolorallocatealpha($image, ($x * 7) % 256, 200, 90, 0));
    }
    if ($transparentEdge) {
        imagefilledrectangle($image, 0, 0, (int) ($width / 4), $height - 1, imagecolorallocatealpha($image, 0, 0, 0, 127));
    }

    $path = tempnam(sys_get_temp_dir(), 'medialib');
    $mime = match ($format) {
        'png' => imagepng($image, $path) ? 'image/png' : null,
        'jpg' => imagejpeg($image, $path, 90) ? 'image/jpeg' : null,
        'webp' => imagewebp($image, $path, 90) ? 'image/webp' : null,
    };

    return new UploadedFile($path, $name, $mime, null, true);
}

/**
 * A camera-style JPEG: the sensor image is $width × $height with a red left half and
 * a blue right half, plus an EXIF (APP1) segment holding $orientation.
 */
function mediaLibOrientedJpeg(string $name, int $width, int $height, int $orientation, string $byteOrder = 'MM'): UploadedFile
{
    $image = imagecreatetruecolor($width, $height);
    imagefilledrectangle($image, 0, 0, intdiv($width, 2) - 1, $height - 1, imagecolorallocate($image, 255, 0, 0));
    imagefilledrectangle($image, intdiv($width, 2), 0, $width - 1, $height - 1, imagecolorallocate($image, 0, 0, 255));
    ob_start();
    imagejpeg($image, null, 90);
    $jpeg = ob_get_clean();

    // TIFF header, then IFD0 with one entry: Orientation (0x0112), SHORT, count 1.
    [$short, $long] = $byteOrder === 'II' ? ['v', 'V'] : ['n', 'N'];
    $tiff = $byteOrder . pack($short, 42) . pack($long, 8)
        . pack($short, 1)
        . pack($short, 0x0112) . pack($short, 3) . pack($long, 1) . pack($short, $orientation) . "\0\0"
        . pack($long, 0);
    $app1 = "\xFF\xE1" . pack('n', 2 + 6 + strlen($tiff)) . "Exif\0\0" . $tiff;

    $path = tempnam(sys_get_temp_dir(), 'medialib');
    file_put_contents($path, substr($jpeg, 0, 2) . $app1 . substr($jpeg, 2));

    return new UploadedFile($path, $name, 'image/jpeg', null, true);
}

/** [r, g, b] of a pixel in stored image bytes. */
function mediaLibPixel(string $bytes, int $x, int $y): array
{
    $image = imagecreatefromstring($bytes);
    $rgb = imagecolorsforindex($image, imagecolorat($image, $x, $y));

    return [$rgb['red'], $rgb['green'], $rgb['blue']];
}

/** A palette GIF with a transparent colour, optionally repeated into a multi-frame (animated) GIF. */
function mediaLibGif(string $name, int $width, int $height, int $frames = 1): UploadedFile
{
    $image = imagecreate($width, $height);
    $clear = imagecolorallocate($image, 255, 0, 255);
    imagecolortransparent($image, $clear);
    imagefilledrectangle($image, (int) ($width / 2), 0, $width - 1, $height - 1, imagecolorallocate($image, 10, 160, 60));

    ob_start();
    imagegif($image);
    $bytes = ob_get_clean();

    if ($frames > 1) {
        // Header + screen descriptor + global colour table, then the frame (control extension, image), then ';'.
        $tableBytes = (ord($bytes[10]) & 0x80) ? 3 * (2 ** ((ord($bytes[10]) & 0x07) + 1)) : 0;
        $head = substr($bytes, 0, 13 + $tableBytes);
        $frame = substr($bytes, 13 + $tableBytes, -1);
        $bytes = $head . str_repeat($frame, $frames) . ';';
    }

    $path = tempnam(sys_get_temp_dir(), 'medialib');
    file_put_contents($path, $bytes);

    return new UploadedFile($path, $name, 'image/gif', null, true);
}

function mediaLibStoredBytes(File $file): string
{
    return Storage::disk('local')->get($file->disk_path);
}

it('downscales large PNGs to fit 1024px and stores, hashes and counts the resized bytes', function () {
    $user = mediaLibUser();
    Sanctum::actingAs($user);
    $upload = mediaLibImage('wide.png', 2400, 1200, 'png', true);
    $originalSize = $upload->getSize();
    $originalHash = hash_file('sha256', $upload->getRealPath());

    $response = mediaLibUpload($upload)->assertCreated()
        ->assertJsonPath('data.file.width', 1024)
        ->assertJsonPath('data.file.height', 512)
        ->assertJsonPath('data.file.extension', 'png');

    $file = File::find($response->json('data.file.id'));
    $bytes = mediaLibStoredBytes($file);
    [$width, $height, $type] = getimagesizefromstring($bytes);

    expect([$width, $height, $type])->toBe([1024, 512, IMAGETYPE_PNG])
        ->and($file->width)->toBe(1024)
        ->and($file->height)->toBe(512)
        ->and($file->size)->toBe(strlen($bytes))
        ->and($file->size)->not->toBe($originalSize)
        ->and($file->checksum)->toBe(hash('sha256', $bytes))
        ->and($file->checksum)->not->toBe($originalHash)
        ->and($response->json('data.usage.images.bytes'))->toBe(strlen($bytes))
        ->and($response->json('data.usage.used'))->toBe(strlen($bytes));

    // Transparency survives: the left quarter stays fully transparent.
    $stored = imagecreatefromstring($bytes);
    expect(imagecolorsforindex($stored, imagecolorat($stored, 5, 5))['alpha'])->toBe(127)
        ->and(imagecolorsforindex($stored, imagecolorat($stored, 1000, 500))['alpha'])->toBe(0);
});

it('dedupes a re-upload of the same large image on its resized bytes', function () {
    $user = mediaLibUser();
    Sanctum::actingAs($user);
    $upload = mediaLibImage('tall.png', 900, 3000);
    $copy = new UploadedFile($upload->getRealPath(), 'tall copy.png', 'image/png', null, true);

    $first = mediaLibUpload($upload)->assertCreated()->assertJsonPath('data.deduplicated', false)
        ->assertJsonPath('data.file.width', 307)
        ->assertJsonPath('data.file.height', 1024);
    mediaLibUpload($copy)->assertCreated()
        ->assertJsonPath('data.deduplicated', true)
        ->assertJsonPath('data.file.id', $first->json('data.file.id'));

    expect(File::where('user_id', $user->id)->count())->toBe(1);
});

it('downscales large JPEGs', function () {
    $user = mediaLibUser();
    Sanctum::actingAs($user);
    $upload = mediaLibImage('photo.jpg', 2048, 1536, 'jpg');

    $response = mediaLibUpload($upload)->assertCreated()
        ->assertJsonPath('data.file.width', 1024)
        ->assertJsonPath('data.file.height', 768);
    $file = File::find($response->json('data.file.id'));
    $bytes = mediaLibStoredBytes($file);

    expect(array_slice(getimagesizefromstring($bytes), 0, 3))->toBe([1024, 768, IMAGETYPE_JPEG])
        ->and($file->size)->toBe(strlen($bytes))
        ->and($file->checksum)->toBe(hash('sha256', $bytes));
});

it('runs on a GD build that can resize JPEG and WebP and read EXIF', function () {
    // Without these, photos are silently stored at full size; fail loudly instead (see backend/Dockerfile).
    $processor = app(ImageProcessor::class);

    expect($processor->canProcess('image/jpeg'))->toBeTrue()
        ->and($processor->canProcess('image/webp'))->toBeTrue()
        ->and(function_exists('exif_read_data'))->toBeTrue();
});

it('downscales large WebPs keeping transparency', function () {
    $user = mediaLibUser();
    Sanctum::actingAs($user);

    $response = mediaLibUpload(mediaLibImage('wide.webp', 2048, 1024, 'webp', true))->assertCreated()
        ->assertJsonPath('data.file.width', 1024)
        ->assertJsonPath('data.file.height', 512);
    $bytes = mediaLibStoredBytes(File::find($response->json('data.file.id')));
    $stored = imagecreatefromstring($bytes);

    expect(array_slice(getimagesizefromstring($bytes), 0, 3))->toBe([1024, 512, IMAGETYPE_WEBP])
        ->and(imagecolorsforindex($stored, imagecolorat($stored, 5, 5))['alpha'])->toBe(127)
        ->and(imagecolorsforindex($stored, imagecolorat($stored, 1000, 500))['alpha'])->toBe(0);
});

it('turns rotated phone photos upright before resizing them', function (bool $exifExtension, string $byteOrder) {
    $user = mediaLibUser();
    Sanctum::actingAs($user);
    if (! $exifExtension) {
        // The built-in EXIF reader, used when the exif extension is missing.
        app()->instance(ImageProcessor::class, new class () extends ImageProcessor {
            protected function exifAvailable(): bool
            {
                return false;
            }
        });
    }

    // Orientation 6: the sensor image is landscape, the photo is portrait (turn 90° clockwise).
    $response = mediaLibUpload(mediaLibOrientedJpeg('portrait.jpg', 2000, 1000, 6, $byteOrder))->assertCreated()
        ->assertJsonPath('data.file.width', 512)
        ->assertJsonPath('data.file.height', 1024);
    $bytes = mediaLibStoredBytes(File::find($response->json('data.file.id')));
    [$top, $bottom] = [mediaLibPixel($bytes, 256, 100), mediaLibPixel($bytes, 256, 900)];

    expect(array_slice(getimagesizefromstring($bytes), 0, 2))->toBe([512, 1024])
        // The sensor's left half (red) is now the top of the stored, upright image.
        ->and($top[0])->toBeGreaterThan(200)->and($top[2])->toBeLessThan(60)
        ->and($bottom[2])->toBeGreaterThan(200)->and($bottom[0])->toBeLessThan(60);
})->with([
    'exif extension' => [true, 'MM'],
    'built-in reader, big-endian' => [false, 'MM'],
    'built-in reader, little-endian' => [false, 'II'],
]);

it('keeps small rotated photos as uploaded but records their upright size', function () {
    $user = mediaLibUser();
    Sanctum::actingAs($user);
    app()->instance(ImageProcessor::class, new class () extends ImageProcessor {
        protected function exifAvailable(): bool
        {
            return false;
        }
    });
    $upload = mediaLibOrientedJpeg('small.jpg', 600, 400, 8);
    $originalHash = hash_file('sha256', $upload->getRealPath());

    $response = mediaLibUpload($upload)->assertCreated()
        ->assertJsonPath('data.file.width', 400)
        ->assertJsonPath('data.file.height', 600);

    expect(File::find($response->json('data.file.id'))->checksum)->toBe($originalHash);
});

it('stores images with too many pixels to decode as uploaded instead of refusing them', function () {
    $user = mediaLibUser();
    Sanctum::actingAs($user);
    config(['file_library.max_image_pixels' => 1_000_000]);
    $upload = mediaLibImage('huge.png', 2000, 1000);
    $originalHash = hash_file('sha256', $upload->getRealPath());

    $response = mediaLibUpload($upload)->assertCreated()
        ->assertJsonPath('data.file.width', 2000)
        ->assertJsonPath('data.file.height', 1000);

    expect(File::find($response->json('data.file.id'))->checksum)->toBe($originalHash);
});

it('leaves images within 1024px untouched but records their size', function () {
    $user = mediaLibUser();
    Sanctum::actingAs($user);
    $upload = mediaLibImage('small.png', 1024, 300);
    $originalHash = hash_file('sha256', $upload->getRealPath());
    $originalSize = $upload->getSize();

    $response = mediaLibUpload($upload)->assertCreated()
        ->assertJsonPath('data.file.width', 1024)
        ->assertJsonPath('data.file.height', 300);
    $file = File::find($response->json('data.file.id'));

    expect($file->checksum)->toBe($originalHash)
        ->and($file->size)->toBe($originalSize)
        ->and(hash('sha256', mediaLibStoredBytes($file)))->toBe($originalHash);
});

it('resizes still GIFs keeping their transparent colour but leaves animated GIFs alone', function () {
    $user = mediaLibUser();
    Sanctum::actingAs($user);

    $still = mediaLibUpload(mediaLibGif('still.gif', 2048, 512))->assertCreated()
        ->assertJsonPath('data.file.width', 1024)
        ->assertJsonPath('data.file.height', 256);
    $stored = imagecreatefromstring(mediaLibStoredBytes(File::find($still->json('data.file.id'))));
    expect(imagesx($stored))->toBe(1024)
        ->and(imagecolortransparent($stored))->toBeGreaterThanOrEqual(0)
        ->and(imagecolorat($stored, 5, 5))->toBe(imagecolortransparent($stored));

    $animated = mediaLibGif('spinner.gif', 1600, 40, 3);
    $animatedHash = hash_file('sha256', $animated->getRealPath());
    $response = mediaLibUpload($animated)->assertCreated()
        ->assertJsonPath('data.file.width', 1600)
        ->assertJsonPath('data.file.height', 40);
    expect(File::find($response->json('data.file.id'))->checksum)->toBe($animatedHash);
});

it('leaves a two-frame GIF alone even without a looping block', function () {
    $user = mediaLibUser();
    Sanctum::actingAs($user);
    // Play-once animation: no NETSCAPE block, and the colour table's last byte (not 0x00)
    // sits right before the first frame's control extension.
    $animated = mediaLibGif('blink.gif', 2048, 64, 2);
    $bytes = file_get_contents($animated->getRealPath());
    $tableBytes = 3 * (2 ** ((ord($bytes[10]) & 0x07) + 1));

    expect($bytes[13 + $tableBytes - 1])->not->toBe("\0")
        ->and(str_contains($bytes, 'NETSCAPE'))->toBeFalse()
        ->and(app(ImageProcessor::class)->isAnimated($animated->getRealPath(), 'image/gif'))->toBeTrue();

    $response = mediaLibUpload($animated)->assertCreated()
        ->assertJsonPath('data.file.width', 2048)
        ->assertJsonPath('data.file.height', 64);
    expect(File::find($response->json('data.file.id'))->checksum)->toBe(hash('sha256', $bytes))
        ->and(app(ImageProcessor::class)->isAnimated(mediaLibGif('still.gif', 2048, 64)->getRealPath(), 'image/gif'))->toBeFalse();
});

it('resizes when bytes are replaced through the legacy update path', function () {
    $user = mediaLibUser();
    $service = app(FileStorageService::class);
    $file = $service->store($user, mediaLibImage('before.png', 200, 200))['file'];

    $replaced = $service->replace($user, $file, mediaLibImage('after.png', 3000, 1500));
    $bytes = mediaLibStoredBytes($replaced);

    expect([$replaced->width, $replaced->height])->toBe([1024, 512])
        ->and($replaced->size)->toBe(strlen($bytes))
        ->and($replaced->checksum)->toBe(hash('sha256', $bytes));
});

it('accepts mp4 videos publicly, counts them in usage and rejects oversized ones', function () {
    $user = mediaLibUser();
    Sanctum::actingAs($user);

    $response = mediaLibUpload(UploadedFile::fake()->create('clip.mp4', 100, 'video/mp4'))->assertCreated()
        ->assertJsonPath('data.file.category', 'video')
        ->assertJsonPath('data.file.isPublic', true)
        ->assertJsonPath('data.file.width', null)
        ->assertJsonPath('data.file.extractionStatus', 'none')
        ->assertJsonPath('data.usage.videos.count', 1)
        ->assertJsonPath('data.usage.videos.bytes', 100 * 1024)
        ->assertJsonPath('data.usage.used', 100 * 1024)
        ->assertJsonPath('data.usage.maxFileSize.video', 50 * 1024 * 1024)
        ->assertJsonPath('data.usage.allowed.video', ['mp4']);

    $file = File::find($response->json('data.file.id'));
    expect($file->disk_path)->toStartWith("public/library/{$user->id}/videos/")
        ->and($file->getRawOriginal('path'))->toStartWith("storage/library/{$user->id}/videos/")
        ->and($response->json('data.file.url'))->toContain("/storage/library/{$user->id}/videos/");
    Storage::disk('local')->assertExists($file->disk_path);

    test()->getJson('/api/v1/library/files?category=video')->assertOk()
        ->assertJsonCount(1, 'data.files')
        ->assertJsonPath('data.files.0.id', $file->id);

    // Over 50 MB, a disguised mp4, and a video type we don't take.
    mediaLibUpload(UploadedFile::fake()->create('long.mp4', 51 * 1024, 'video/mp4'))->assertStatus(422);
    config(['file_library.max_video_mb' => 1]);
    mediaLibUpload(UploadedFile::fake()->create('medium.mp4', 2 * 1024, 'video/mp4'))->assertStatus(422)
        ->assertJsonPath('data.code', 'invalid_file');
    mediaLibUpload(UploadedFile::fake()->create('fake.mp4', 10, 'application/pdf'))->assertStatus(422)
        ->assertJsonPath('data.code', 'invalid_file');
    mediaLibUpload(UploadedFile::fake()->create('clip.mov', 10, 'video/quicktime'))->assertStatus(422)
        ->assertJsonPath('data.code', 'invalid_file');

    expect(File::where('user_id', $user->id)->count())->toBe(1);
});

it('finds files used as deck covers, slide media and option images by id', function () {
    $user = mediaLibUser();
    $service = app(FileStorageService::class);
    $references = app(FileReferenceService::class);
    $cover = $service->store($user, mediaLibImage('cover.png', 64, 64))['file'];
    $media = $service->store($user, UploadedFile::fake()->create('intro.mp4', 20, 'video/mp4'))['file'];
    $optionImage = $service->store($user, mediaLibImage('option.png', 32, 48))['file'];
    $unused = $service->store($user, mediaLibImage('unused.png', 16, 16))['file'];

    $deck = Deck::factory()->ownedBy($user)->create(['cover_file_id' => $cover->id]);
    $slide = Slide::factory()->for($deck)->ofType('video')->create(['media_file_id' => $media->id]);
    $otherSlide = Slide::factory()->for($deck)->create();
    SlideOption::factory()->for($otherSlide)->count(2)->create(['image_file_id' => $optionImage->id]);

    expect($references->references($cover))->toBe(['deck covers' => 1])
        ->and($references->references($media))->toBe(['deck slides' => 1])
        ->and($references->references($optionImage))->toBe(['deck slide options' => 2])
        ->and($references->references($unused))->toBe([]);

    Sanctum::actingAs($user);
    test()->deleteJson("/api/v1/library/files/{$media->id}")
        ->assertStatus(409)
        ->assertJsonPath('data.code', 'file_in_use')
        ->assertJsonPath('data.references.deck slides', 1);

    // Deleted slides and decks no longer hold on to their files.
    $slide->delete();
    $otherSlide->delete();
    expect($references->references($media))->toBe([])
        ->and($references->references($optionImage))->toBe([]);
    $deck->delete();
    expect($references->references($cover))->toBe([]);
});

it('indexes the deck columns that point at files', function () {
    $indexes = collect(DB::select("SELECT tablename, indexdef FROM pg_indexes WHERE tablename IN ('decks', 'slides', 'slide_options')"));
    $indexed = fn (string $table, string $column) => $indexes->contains(
        fn ($row) => $row->tablename === $table && str_contains($row->indexdef, "({$column})"),
    );

    expect($indexed('decks', 'cover_file_id'))->toBeTrue()
        ->and($indexed('slides', 'media_file_id'))->toBeTrue()
        ->and($indexed('slide_options', 'image_file_id'))->toBeTrue();
});

it('caps new upload bytes per day, deleted files included, so upload-delete loops cannot fill the disk', function () {
    $user = mediaLibUser();
    Sanctum::actingAs($user);
    config(['file_library.default_quota_mb' => 1, 'file_library.max_daily_upload_mb' => 1]);

    $first = mediaLibUpload(UploadedFile::fake()->create('clip.mp4', 600, 'video/mp4'))->assertCreated();
    test()->deleteJson('/api/v1/library/files/' . $first->json('data.file.id'))->assertOk()
        ->assertJsonPath('data.usage.used', 0);

    // Quota is free again, but the deleted bytes are still on disk and still count today.
    mediaLibUpload(UploadedFile::fake()->create('clip.mp4', 600, 'video/mp4'))->assertStatus(422)
        ->assertJsonPath('data.code', 'daily_upload_limit')
        ->assertJsonPath('data.uploaded', 600 * 1024)
        ->assertJsonPath('data.limit', 1024 * 1024);
    expect(File::withTrashed()->where('user_id', $user->id)->count())->toBe(1);

    // A larger personal quota raises the daily allowance with it.
    $user->forceFill(['storage_quota_bytes' => 5 * 1024 * 1024])->save();
    mediaLibUpload(UploadedFile::fake()->create('clip.mp4', 600, 'video/mp4'))->assertCreated();
});
