<?php

use App\Deck\Slides\SlideTypeRegistry;
use App\Models\Deck\Deck;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use App\Models\File;
use App\Models\User;
use App\Modules\FileLibrary\Services\FileReferenceService;
use App\Modules\FileLibrary\Services\FileStorageService;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

uses(DatabaseTransactions::class);

beforeEach(function () {
    Storage::fake('local');
    config([
        'cache.default' => 'array',
        'file_library.disk' => 'local',
        'file_library.default_quota_mb' => 200,
        'file_library.max_image_mb' => 10,
        'file_library.max_document_mb' => 25,
        'file_library.max_video_mb' => 50,
        'file_library.max_daily_upload_mb' => 1024,
        'file_library.max_image_dimension' => 1024,
    ]);
});

/** A real PNG with random pixels, so the library never de-duplicates two of them. */
function mediaApiPng(string $name = 'pic.png', int $width = 40, int $height = 30): UploadedFile
{
    $image = imagecreatetruecolor($width, $height);
    imagefilledrectangle($image, 0, 0, $width - 1, $height - 1, imagecolorallocate($image, random_int(0, 255), random_int(0, 255), random_int(0, 255)));
    for ($i = 0; $i < 8; $i++) {
        imagesetpixel($image, random_int(0, $width - 1), random_int(0, $height - 1), imagecolorallocate($image, random_int(0, 255), random_int(0, 255), random_int(0, 255)));
    }

    $path = tempnam(sys_get_temp_dir(), 'mediaapi');
    imagepng($image, $path);

    return new UploadedFile($path, $name, 'image/png', null, true);
}

/** JPEG bytes of a $width × $height sensor image with an EXIF Orientation tag (big-endian TIFF). */
function mediaApiOrientedJpegBytes(int $width, int $height, int $orientation): string
{
    $image = imagecreatetruecolor($width, $height);
    imagefilledrectangle($image, 0, 0, $width - 1, $height - 1, imagecolorallocate($image, 200, 40, 40));
    ob_start();
    imagejpeg($image, null, 90);
    $jpeg = ob_get_clean();

    // TIFF header, IFD0 with one entry: Orientation (0x0112), SHORT, count 1.
    $tiff = 'MM' . pack('n', 42) . pack('N', 8)
        . pack('n', 1)
        . pack('n', 0x0112) . pack('n', 3) . pack('N', 1) . pack('n', $orientation) . "\0\0"
        . pack('N', 0);
    $app1 = "\xFF\xE1" . pack('n', 2 + 6 + strlen($tiff)) . "Exif\0\0" . $tiff;

    return substr($jpeg, 0, 2) . $app1 . substr($jpeg, 2);
}

function mediaApiImage(User $user, string $name = 'pic.png', int $width = 40, int $height = 30): File
{
    return app(FileStorageService::class)->store($user, mediaApiPng($name, $width, $height))['file'];
}

function mediaApiVideo(User $user, string $name = 'clip.mp4'): File
{
    return app(FileStorageService::class)->store($user, libSized($name, 20))['file'];
}

function mediaApiDocument(User $user): File
{
    return app(FileStorageService::class)->store($user, libSized('notes.pdf', 5))['file'];
}

/** A library image stored before dimensions were recorded: real bytes on disk, null width/height. */
function mediaApiLegacyImage(User $user, string $bytes, string $extension = 'png', string $mime = 'image/png'): File
{
    $name = Str::random(40) . '.' . $extension;
    $relative = "library/{$user->id}/images/2024/01/{$name}";
    Storage::disk('local')->put("public/{$relative}", $bytes);

    return File::create([
        'name' => 'Old upload',
        'path' => "storage/{$relative}",
        'type' => 'image',
        'category' => File::CATEGORY_IMAGE,
        'size' => strlen($bytes),
        'mime_type' => $mime,
        'extension' => $extension,
        'original_name' => "old.{$extension}",
        'disk' => 'local',
        'disk_path' => "public/{$relative}",
        'visibility' => File::VISIBILITY_PUBLIC,
        'width' => null,
        'height' => null,
        'user_id' => $user->id,
        'created_by' => $user->id,
    ]);
}

function mediaApiDeck(User $user, array $attributes = []): Deck
{
    return Deck::factory()->ownedBy($user)->create($attributes);
}

function mediaApiSlide(Deck $deck, string $type, array $config = []): Slide
{
    return Slide::factory()->for($deck)->ofType($type, $config)->create();
}

function mediaApiPut(string $path, array $body)
{
    return test()->putJson('/api/v1/quests/' . ltrim($path, '/'), $body);
}

function mediaApiStale(File $file): File
{
    $file->forceFill(['last_used_at' => now()->subDays(3)])->save();

    return $file;
}

it('registers the media routes under the quest authoring prefix', function () {
    expect(route('deck.quest.decks.cover', ['deck' => 5], false))->toBe('/api/v1/quests/5/cover')
        ->and(route('deck.quest.slides.media', ['deck' => 5, 'slide' => 6], false))->toBe('/api/v1/quests/5/slides/6/media')
        ->and(route('deck.quest.slides.options.image', ['deck' => 5, 'slide' => 6, 'option' => 7], false))
        ->toBe('/api/v1/quests/5/slides/6/options/7/image');
});

it('attaches and removes a deck cover', function () {
    $user = DeckFactory::newOwner();
    $image = mediaApiStale(mediaApiImage($user, 'cover.png', 64, 48));
    $deck = mediaApiDeck($user);
    Sanctum::actingAs($user);

    $response = mediaApiPut("{$deck->id}/cover", ['file_id' => $image->id])->assertOk()
        ->assertJsonPath('status', true)
        ->assertJsonPath('data.deck.id', $deck->id)
        ->assertJsonPath('data.deck.coverFileId', $image->id)
        ->assertJsonPath('data.deck.cover.fileId', $image->id)
        ->assertJsonPath('data.deck.cover.category', 'image')
        ->assertJsonPath('data.deck.cover.width', 64)
        ->assertJsonPath('data.deck.cover.height', 48)
        ->assertJsonPath('data.deck.cover.inLibrary', true);

    expect($response->json('data.deck.cover.url'))->toContain("/storage/library/{$user->id}/images/")
        ->and($deck->fresh()->cover_file_id)->toBe($image->id)
        ->and($image->fresh()->last_used_at->greaterThan(now()->subMinute()))->toBeTrue();

    mediaApiPut("{$deck->id}/cover", ['file_id' => null])->assertOk()
        ->assertJsonPath('data.deck.coverFileId', null)
        ->assertJsonPath('data.deck.cover', null);

    expect($deck->fresh()->cover_file_id)->toBeNull()
        ->and(File::find($image->id))->not->toBeNull();
});

it('attaches and removes an option image', function () {
    $user = DeckFactory::newOwner();
    $image = mediaApiStale(mediaApiImage($user, 'option.png', 32, 40));
    $slide = mediaApiSlide(mediaApiDeck($user), 'poll_single');
    $option = SlideOption::factory()->for($slide)->create(['label' => 'Cats']);
    Sanctum::actingAs($user);

    mediaApiPut("{$slide->deck_id}/slides/{$slide->id}/options/{$option->id}/image", ['file_id' => $image->id])->assertOk()
        ->assertJsonPath('data.option.id', $option->id)
        ->assertJsonPath('data.option.slideId', $slide->id)
        ->assertJsonPath('data.option.label', 'Cats')
        ->assertJsonPath('data.option.imageFileId', $image->id)
        ->assertJsonPath('data.option.image.fileId', $image->id)
        ->assertJsonPath('data.option.image.width', 32)
        ->assertJsonPath('data.option.image.height', 40);

    expect($option->fresh()->image_file_id)->toBe($image->id)
        ->and($image->fresh()->last_used_at->greaterThan(now()->subMinute()))->toBeTrue();

    mediaApiPut("{$slide->deck_id}/slides/{$slide->id}/options/{$option->id}/image", ['file_id' => null])->assertOk()
        ->assertJsonPath('data.option.imageFileId', null)
        ->assertJsonPath('data.option.image', null);

    expect($option->fresh()->image_file_id)->toBeNull();
});

it('attaches and removes images on image and pin_on_image slides', function (string $type) {
    $user = DeckFactory::newOwner();
    $image = mediaApiStale(mediaApiImage($user, 'slide.png', 90, 60));
    $slide = mediaApiSlide(mediaApiDeck($user), $type);
    Sanctum::actingAs($user);

    $response = mediaApiPut("{$slide->deck_id}/slides/{$slide->id}/media", ['file_id' => $image->id])->assertOk()
        ->assertJsonPath('data.slide.id', $slide->id)
        ->assertJsonPath('data.slide.type', $type)
        ->assertJsonPath('data.slide.mediaFileId', $image->id)
        ->assertJsonPath('data.slide.media.fileId', $image->id)
        ->assertJsonPath('data.slide.media.mime', 'image/png')
        ->assertJsonPath('data.slide.media.width', 90)
        ->assertJsonPath('data.slide.media.height', 60);

    // Media is never written into config.
    expect($response->json('data.slide.config.media'))->toBeNull()
        ->and($slide->fresh()->media_file_id)->toBe($image->id)
        ->and($image->fresh()->last_used_at->greaterThan(now()->subMinute()))->toBeTrue();

    // What session start will snapshot is usable (pin_on_image needs width/height).
    $fresh = $slide->fresh();
    $typeClass = app(SlideTypeRegistry::class)->for($type);
    $snapshot = $typeClass->withMedia($fresh->config ?? [], $fresh->mediaFile);
    expect($snapshot['media'])->toMatchArray(['file_id' => $image->id, 'width' => 90, 'height' => 60, 'mime' => 'image/png']);
    if (method_exists($typeClass, 'assertMediaPresent')) {
        $typeClass->assertMediaPresent($snapshot);
    }

    mediaApiPut("{$slide->deck_id}/slides/{$slide->id}/media", ['file_id' => null])->assertOk()
        ->assertJsonPath('data.slide.mediaFileId', null)
        ->assertJsonPath('data.slide.media', null);

    expect($slide->fresh()->media_file_id)->toBeNull();
})->with(['image', 'pin_on_image']);

it('keeps a video slide to either an mp4 or a link, never both', function () {
    $user = DeckFactory::newOwner();
    $video = mediaApiStale(mediaApiVideo($user));
    $config = app(SlideTypeRegistry::class)->for('video')->validateConfig(['video_url' => 'https://youtu.be/dQw4w9WgXcQ']);
    $slide = mediaApiSlide(mediaApiDeck($user), 'video', $config);
    $url = "{$slide->deck_id}/slides/{$slide->id}/media";
    Sanctum::actingAs($user);

    // Uploading an mp4 replaces the link.
    mediaApiPut($url, ['file_id' => $video->id])->assertOk()
        ->assertJsonPath('data.slide.mediaFileId', $video->id)
        ->assertJsonPath('data.slide.media.category', 'video')
        ->assertJsonPath('data.slide.media.mime', 'video/mp4')
        ->assertJsonPath('data.slide.config.video_url', null)
        ->assertJsonPath('data.slide.config.video_provider', null)
        ->assertJsonPath('data.slide.config.embed_url', null);

    expect($slide->fresh()->config['video_url'])->toBeNull()
        ->and($video->fresh()->last_used_at->greaterThan(now()->subMinute()))->toBeTrue();
    // The snapshot has the upload and no link (withMedia refuses both).
    $fresh = $slide->fresh();
    expect(app(SlideTypeRegistry::class)->for('video')->withMedia($fresh->config, $fresh->mediaFile)['media']['file_id'])->toBe($video->id);

    // A link replaces the mp4; provider, id and embed URL are derived.
    mediaApiPut($url, ['video_url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'])->assertOk()
        ->assertJsonPath('data.slide.mediaFileId', null)
        ->assertJsonPath('data.slide.media', null)
        ->assertJsonPath('data.slide.config.video_url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
        ->assertJsonPath('data.slide.config.video_provider', 'youtube')
        ->assertJsonPath('data.slide.config.video_id', 'dQw4w9WgXcQ')
        ->assertJsonPath('data.slide.config.embed_url', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');

    expect($slide->fresh()->media_file_id)->toBeNull();

    mediaApiPut($url, ['video_url' => 'https://vimeo.com/76979871'])->assertOk()
        ->assertJsonPath('data.slide.config.video_provider', 'vimeo')
        ->assertJsonPath('data.slide.config.embed_url', 'https://player.vimeo.com/video/76979871');

    // Links the video type refuses: plain http, other hosts, look-alike domains.
    foreach (['http://youtu.be/dQw4w9WgXcQ', 'https://example.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'not a url'] as $bad) {
        mediaApiPut($url, ['video_url' => $bad])->assertStatus(422)
            ->assertJsonPath('status', false)
            ->assertJsonValidationErrors(['video_url'], 'data.validation_errors');
    }
    expect($slide->fresh()->config['video_provider'])->toBe('vimeo');

    // Removing the link leaves no video; removing a link never touches an mp4 and vice versa.
    mediaApiPut($url, ['video_url' => null])->assertOk()
        ->assertJsonPath('data.slide.config.video_url', null)
        ->assertJsonPath('data.slide.config.video_provider', null);

    mediaApiPut($url, ['file_id' => $video->id])->assertOk();
    mediaApiPut($url, ['video_url' => null])->assertOk()->assertJsonPath('data.slide.mediaFileId', $video->id);
    mediaApiPut($url, ['file_id' => null])->assertOk()->assertJsonPath('data.slide.mediaFileId', null);
});

it('refuses files that do not fit the slot', function () {
    $user = DeckFactory::newOwner();
    $image = mediaApiImage($user);
    $video = mediaApiVideo($user);
    $document = mediaApiDocument($user);
    $deck = mediaApiDeck($user);
    $imageSlide = mediaApiSlide($deck, 'image');
    $pinSlide = mediaApiSlide($deck, 'pin_on_image');
    $videoSlide = mediaApiSlide($deck, 'video');
    $pollSlide = mediaApiSlide($deck, 'poll_single');
    $option = SlideOption::factory()->for($pollSlide)->create();
    Sanctum::actingAs($user);

    $cases = [
        ["{$deck->id}/cover", $video, 'Choose an image (jpg, png, gif or webp) from My Files.'],
        ["{$deck->id}/cover", $document, 'Choose an image (jpg, png, gif or webp) from My Files.'],
        ["{$deck->id}/slides/{$pollSlide->id}/options/{$option->id}/image", $video, 'Choose an image (jpg, png, gif or webp) from My Files.'],
        ["{$deck->id}/slides/{$pollSlide->id}/options/{$option->id}/image", $document, 'Choose an image (jpg, png, gif or webp) from My Files.'],
        ["{$deck->id}/slides/{$imageSlide->id}/media", $video, 'Choose an image (jpg, png, gif or webp) from My Files.'],
        ["{$deck->id}/slides/{$pinSlide->id}/media", $document, 'Choose an image (jpg, png, gif or webp) from My Files.'],
        ["{$deck->id}/slides/{$videoSlide->id}/media", $image, 'Choose an mp4 video from My Files.'],
        ["{$deck->id}/slides/{$videoSlide->id}/media", $document, 'Choose an mp4 video from My Files.'],
    ];

    foreach ($cases as [$path, $file, $message]) {
        mediaApiPut($path, ['file_id' => $file->id])->assertStatus(422)
            ->assertJsonPath('status', false)
            ->assertJsonPath('message', 'Validation Error')
            ->assertJsonPath('data.validation_errors.file_id.0', $message);
    }

    // A legacy "image" row in a format the slides do not show (svg) is refused too.
    $svg = mediaApiLegacyImage($user, '<svg xmlns="http://www.w3.org/2000/svg"/>', 'svg', 'image/svg+xml');
    mediaApiPut("{$deck->id}/cover", ['file_id' => $svg->id])->assertStatus(422);
    mediaApiPut("{$deck->id}/slides/{$imageSlide->id}/media", ['file_id' => $svg->id])->assertStatus(422);

    expect($deck->fresh()->cover_file_id)->toBeNull()
        ->and($option->fresh()->image_file_id)->toBeNull()
        ->and($imageSlide->fresh()->media_file_id)->toBeNull()
        ->and($pinSlide->fresh()->media_file_id)->toBeNull()
        ->and($videoSlide->fresh()->media_file_id)->toBeNull();
});

it('refuses media on slide types that take none', function () {
    $user = DeckFactory::newOwner();
    $image = mediaApiImage($user);
    $deck = mediaApiDeck($user);
    Sanctum::actingAs($user);

    foreach (['poll_single', 'word_cloud', 'heading', 'paragraph', 'qr_code', 'qa_audience'] as $type) {
        $slide = mediaApiSlide($deck, $type);

        mediaApiPut("{$deck->id}/slides/{$slide->id}/media", ['file_id' => $image->id])->assertStatus(422)
            ->assertJsonPath('data.validation_errors.file_id.0', 'This slide type does not take media.');
        mediaApiPut("{$deck->id}/slides/{$slide->id}/media", ['file_id' => null])->assertStatus(422)
            ->assertJsonPath('data.validation_errors.file_id.0', 'This slide type does not take media.');
        mediaApiPut("{$deck->id}/slides/{$slide->id}/media", ['video_url' => 'https://youtu.be/dQw4w9WgXcQ'])->assertStatus(422)
            ->assertJsonPath('data.validation_errors.video_url.0', 'This slide type does not take a video link.');

        expect($slide->fresh()->media_file_id)->toBeNull();
    }

    // Image slides take files but no link.
    $imageSlide = mediaApiSlide($deck, 'image');
    mediaApiPut("{$deck->id}/slides/{$imageSlide->id}/media", ['video_url' => 'https://youtu.be/dQw4w9WgXcQ'])->assertStatus(422)
        ->assertJsonValidationErrors(['video_url'], 'data.validation_errors');

    // A type key the registry does not know takes nothing either.
    $unknown = mediaApiSlide($deck, 'retired_type');
    mediaApiPut("{$deck->id}/slides/{$unknown->id}/media", ['file_id' => $image->id])->assertStatus(422)
        ->assertJsonValidationErrors(['file_id'], 'data.validation_errors');
});

it('answers 404 for files of other users, files removed from My Files and unknown ids', function () {
    $user = DeckFactory::newOwner();
    $stranger = DeckFactory::newOwner();
    $theirs = mediaApiStale(mediaApiImage($stranger, 'theirs.png'));
    $trashed = mediaApiImage($user, 'trashed.png');
    app(FileStorageService::class)->delete($trashed, $user);
    $deck = mediaApiDeck($user);
    $slide = mediaApiSlide($deck, 'pin_on_image');
    $option = SlideOption::factory()->for(mediaApiSlide($deck, 'poll_multi'))->create();
    Sanctum::actingAs($user);

    $paths = [
        "{$deck->id}/cover",
        "{$deck->id}/slides/{$slide->id}/media",
        "{$deck->id}/slides/{$option->slide_id}/options/{$option->id}/image",
    ];

    foreach ($paths as $path) {
        foreach ([$theirs->id, $trashed->id, 999_999_999_999] as $fileId) {
            mediaApiPut($path, ['file_id' => $fileId])->assertNotFound()
                ->assertJsonPath('status', false)
                ->assertJsonPath('message', 'File not found.')
                ->assertJsonPath('data.code', 'not_found');
        }
    }

    expect($deck->fresh()->cover_file_id)->toBeNull()
        ->and($slide->fresh()->media_file_id)->toBeNull()
        ->and($option->fresh()->image_file_id)->toBeNull()
        ->and($theirs->fresh()->last_used_at->lessThan(now()->subDay()))->toBeTrue();
});

it('answers 404 for decks, slides and options that are not the caller\'s, and 401 when signed out', function () {
    $user = DeckFactory::newOwner();
    $image = mediaApiImage($user);
    $deck = mediaApiDeck($user);
    $slide = mediaApiSlide($deck, 'image');
    $option = SlideOption::factory()->for(mediaApiSlide($deck, 'poll_single'))->create();

    $otherDeck = mediaApiDeck(DeckFactory::newOwner());
    $otherSlide = mediaApiSlide($otherDeck, 'image');
    $quizDeck = Deck::factory()->quiz()->ownedBy($user)->create();
    $quizSlide = mediaApiSlide($quizDeck, 'image');
    $foreignOption = SlideOption::factory()->for(mediaApiSlide($deck, 'poll_single'))->create();
    $deletedDeck = mediaApiDeck($user);
    $deletedDeck->delete();

    $this->putJson("/api/v1/quests/{$deck->id}/cover", ['file_id' => $image->id])->assertUnauthorized();

    Sanctum::actingAs($user);
    mediaApiPut("{$otherDeck->id}/cover", ['file_id' => $image->id])->assertNotFound()->assertJsonPath('message', 'Deck not found.');
    mediaApiPut("{$quizDeck->id}/cover", ['file_id' => $image->id])->assertNotFound()->assertJsonPath('data.code', 'not_found');
    mediaApiPut("{$deletedDeck->id}/cover", ['file_id' => $image->id])->assertNotFound();
    mediaApiPut("{$otherDeck->id}/slides/{$otherSlide->id}/media", ['file_id' => $image->id])->assertNotFound();
    mediaApiPut("{$quizDeck->id}/slides/{$quizSlide->id}/media", ['file_id' => $image->id])->assertNotFound();
    mediaApiPut("{$deck->id}/slides/{$otherSlide->id}/media", ['file_id' => $image->id])->assertNotFound()->assertJsonPath('message', 'Slide not found.');
    mediaApiPut("{$deck->id}/slides/{$slide->id}/options/{$foreignOption->id}/image", ['file_id' => $image->id])->assertNotFound()
        ->assertJsonPath('message', 'Option not found.');

    expect($otherDeck->fresh()->cover_file_id)->toBeNull()
        ->and($otherSlide->fresh()->media_file_id)->toBeNull()
        ->and($quizDeck->fresh()->cover_file_id)->toBeNull()
        ->and($foreignOption->fresh()->image_file_id)->toBeNull()
        ->and($option->fresh()->image_file_id)->toBeNull();
});

it('validates the request bodies', function () {
    $user = DeckFactory::newOwner();
    $image = mediaApiImage($user);
    $deck = mediaApiDeck($user);
    $slide = mediaApiSlide($deck, 'video');
    $option = SlideOption::factory()->for(mediaApiSlide($deck, 'poll_single'))->create();
    Sanctum::actingAs($user);

    $media = "{$deck->id}/slides/{$slide->id}/media";
    foreach ([[], ['file_id' => $image->id, 'video_url' => 'https://youtu.be/dQw4w9WgXcQ'], ['file_id' => null, 'video_url' => null]] as $body) {
        mediaApiPut($media, $body)->assertStatus(422)->assertJsonValidationErrors(['file_id'], 'data.validation_errors');
    }
    foreach (['abc', true, 0, -3, 1.5, ['x']] as $bad) {
        mediaApiPut($media, ['file_id' => $bad])->assertStatus(422)->assertJsonValidationErrors(['file_id'], 'data.validation_errors');
        mediaApiPut("{$deck->id}/cover", ['file_id' => $bad])->assertStatus(422)->assertJsonValidationErrors(['file_id'], 'data.validation_errors');
    }
    mediaApiPut($media, ['video_url' => ['https://youtu.be/dQw4w9WgXcQ']])->assertStatus(422)
        ->assertJsonValidationErrors(['video_url'], 'data.validation_errors');
    mediaApiPut($media, ['video_url' => 'https://youtu.be/' . str_repeat('a', 2100)])->assertStatus(422)
        ->assertJsonValidationErrors(['video_url'], 'data.validation_errors');

    mediaApiPut("{$deck->id}/cover", [])->assertStatus(422)
        ->assertJsonPath('data.validation_errors.file_id.0', 'Send file_id: a My Files id, or null to remove the image.');
    mediaApiPut("{$deck->id}/slides/{$option->slide_id}/options/{$option->id}/image", [])->assertStatus(422)
        ->assertJsonValidationErrors(['file_id'], 'data.validation_errors');

    // A numeric string id is fine (form posts).
    mediaApiPut("{$deck->id}/cover", ['file_id' => (string) $image->id])->assertOk()->assertJsonPath('data.deck.coverFileId', $image->id);
});

it('fills in missing image dimensions on attach so pin_on_image works for older uploads', function () {
    $user = DeckFactory::newOwner();
    $image = imagecreatetruecolor(120, 80);
    ob_start();
    imagepng($image);
    $legacy = mediaApiLegacyImage($user, ob_get_clean());
    $slide = mediaApiSlide(mediaApiDeck($user), 'pin_on_image');
    Sanctum::actingAs($user);

    expect($legacy->width)->toBeNull()->and($legacy->height)->toBeNull();

    mediaApiPut("{$slide->deck_id}/slides/{$slide->id}/media", ['file_id' => $legacy->id])->assertOk()
        ->assertJsonPath('data.slide.mediaFileId', $legacy->id)
        ->assertJsonPath('data.slide.media.width', 120)
        ->assertJsonPath('data.slide.media.height', 80);

    $legacy->refresh();
    expect($legacy->width)->toBe(120)->and($legacy->height)->toBe(80);

    $fresh = $slide->fresh();
    $pin = app(SlideTypeRegistry::class)->for('pin_on_image');
    $snapshot = $pin->withMedia($fresh->config ?? [], $fresh->mediaFile);
    $pin->assertMediaPresent($snapshot);
    expect($snapshot['media'])->toMatchArray(['width' => 120, 'height' => 80]);
});

it('fills in dimensions for covers and option images too, turned like the browser shows EXIF-rotated photos', function () {
    $user = DeckFactory::newOwner();
    $deck = mediaApiDeck($user);
    $option = SlideOption::factory()->for(mediaApiSlide($deck, 'poll_single'))->create();
    // A portrait phone photo: stored 60 × 40, EXIF orientation 6 (rotate 90°) → shown 40 × 60.
    $rotated = mediaApiLegacyImage($user, mediaApiOrientedJpegBytes(60, 40, 6), 'jpg', 'image/jpeg');
    $plain = mediaApiLegacyImage($user, mediaApiOrientedJpegBytes(50, 30, 1), 'jpg', 'image/jpeg');
    Sanctum::actingAs($user);

    mediaApiPut("{$deck->id}/cover", ['file_id' => $rotated->id])->assertOk()
        ->assertJsonPath('data.deck.cover.width', 40)
        ->assertJsonPath('data.deck.cover.height', 60);
    mediaApiPut("{$deck->id}/slides/{$option->slide_id}/options/{$option->id}/image", ['file_id' => $plain->id])->assertOk()
        ->assertJsonPath('data.option.image.width', 50)
        ->assertJsonPath('data.option.image.height', 30);

    expect([$rotated->fresh()->width, $rotated->fresh()->height])->toBe([40, 60])
        ->and([$plain->fresh()->width, $plain->fresh()->height])->toBe([50, 30]);
});

it('refuses an unreadable image on pin_on_image but still lets image slides show it', function () {
    $user = DeckFactory::newOwner();
    $broken = mediaApiLegacyImage($user, 'definitely not a png');
    $deck = mediaApiDeck($user);
    $pin = mediaApiSlide($deck, 'pin_on_image');
    $image = mediaApiSlide($deck, 'image');
    Sanctum::actingAs($user);

    mediaApiPut("{$deck->id}/slides/{$pin->id}/media", ['file_id' => $broken->id])->assertStatus(422)
        ->assertJsonValidationErrors(['file_id'], 'data.validation_errors');
    expect($pin->fresh()->media_file_id)->toBeNull();

    mediaApiPut("{$deck->id}/slides/{$image->id}/media", ['file_id' => $broken->id])->assertOk()
        ->assertJsonPath('data.slide.media.width', null);
    expect($broken->fresh()->width)->toBeNull();
});

it('makes My Files report where a deck uses each attached file, by exact id', function () {
    $user = DeckFactory::newOwner();
    $cover = mediaApiImage($user, 'cover.png');
    $slideImage = mediaApiImage($user, 'slide.png');
    $optionImage = mediaApiImage($user, 'option.png');
    $video = mediaApiVideo($user);
    $unused = mediaApiImage($user, 'unused.png');
    $deck = mediaApiDeck($user);
    $imageSlide = mediaApiSlide($deck, 'image');
    $videoSlide = mediaApiSlide($deck, 'video');
    $pollSlide = mediaApiSlide($deck, 'poll_single');
    [$first, $second] = SlideOption::factory()->for($pollSlide)->count(2)->create()->all();
    $references = app(FileReferenceService::class);
    Sanctum::actingAs($user);

    mediaApiPut("{$deck->id}/cover", ['file_id' => $cover->id])->assertOk();
    mediaApiPut("{$deck->id}/slides/{$imageSlide->id}/media", ['file_id' => $slideImage->id])->assertOk();
    mediaApiPut("{$deck->id}/slides/{$videoSlide->id}/media", ['file_id' => $video->id])->assertOk();
    mediaApiPut("{$deck->id}/slides/{$pollSlide->id}/options/{$first->id}/image", ['file_id' => $optionImage->id])->assertOk();
    mediaApiPut("{$deck->id}/slides/{$pollSlide->id}/options/{$second->id}/image", ['file_id' => $optionImage->id])->assertOk();

    expect($references->references($cover))->toBe(['deck covers' => 1])
        ->and($references->references($slideImage))->toBe(['deck slides' => 1])
        ->and($references->references($video))->toBe(['deck slides' => 1])
        ->and($references->references($optionImage))->toBe(['deck slide options' => 2])
        ->and($references->references($unused))->toBe([]);

    $this->deleteJson("/api/v1/library/files/{$slideImage->id}")->assertStatus(409)
        ->assertJsonPath('data.code', 'file_in_use')
        ->assertJsonPath('data.references.deck slides', 1);

    // Detaching frees them again.
    mediaApiPut("{$deck->id}/slides/{$imageSlide->id}/media", ['file_id' => null])->assertOk();
    mediaApiPut("{$deck->id}/slides/{$pollSlide->id}/options/{$first->id}/image", ['file_id' => null])->assertOk();
    expect($references->references($slideImage))->toBe([])
        ->and($references->references($optionImage))->toBe(['deck slide options' => 1]);
});

it('keeps showing media its owner later removed from My Files, and lets the editor detach it', function () {
    $user = DeckFactory::newOwner();
    $image = mediaApiImage($user);
    $cover = mediaApiImage($user, 'cover.png');
    $optionImage = mediaApiImage($user, 'option.png');
    $deck = mediaApiDeck($user);
    $slide = mediaApiSlide($deck, 'image');
    $option = SlideOption::factory()->for(mediaApiSlide($deck, 'poll_single'))->create();
    Sanctum::actingAs($user);

    mediaApiPut("{$deck->id}/slides/{$slide->id}/media", ['file_id' => $image->id])->assertOk();
    mediaApiPut("{$deck->id}/cover", ['file_id' => $cover->id])->assertOk();
    mediaApiPut("{$deck->id}/slides/{$option->slide_id}/options/{$option->id}/image", ['file_id' => $optionImage->id])->assertOk();
    foreach ([$image, $cover, $optionImage] as $file) {
        $this->deleteJson("/api/v1/library/files/{$file->id}?force=1")->assertOk();
        expect(File::withTrashed()->find($file->id)->trashed())->toBeTrue();
    }

    // The deck still shows all three, flagged as no longer in My Files.
    $slideResponse = $this->getJson("/api/v1/quests/{$deck->id}/slides/{$slide->id}")->assertOk()
        ->assertJsonPath('data.slide.mediaFileId', $image->id)
        ->assertJsonPath('data.slide.media.fileId', $image->id)
        ->assertJsonPath('data.slide.media.inLibrary', false);
    expect($slideResponse->json('data.slide.media.url'))->toBeString()->not->toBe('');

    $deckResponse = $this->getJson("/api/v1/quests/{$deck->id}")->assertOk()
        ->assertJsonPath('data.deck.coverFileId', $cover->id)
        ->assertJsonPath('data.deck.cover.fileId', $cover->id)
        ->assertJsonPath('data.deck.cover.inLibrary', false);
    expect($deckResponse->json('data.deck.cover.url'))->toBeString()->not->toBe('');

    $shown = collect($deckResponse->json('data.deck.slides'))->keyBy('id');
    expect($shown[$slide->id]['media']['fileId'])->toBe($image->id)
        ->and($shown[$slide->id]['media']['inLibrary'])->toBeFalse()
        ->and($shown[$slide->id]['media']['url'])->toBeString()->not->toBe('');
    $shownOption = collect($shown[$option->slide_id]['options'])->firstWhere('id', $option->id);
    expect($shownOption['imageFileId'])->toBe($optionImage->id)
        ->and($shownOption['image']['fileId'])->toBe($optionImage->id)
        ->and($shownOption['image']['inLibrary'])->toBeFalse()
        ->and($shownOption['image']['url'])->toBeString()->not->toBe('');

    // Re-attaching a removed file is refused, detaching works.
    mediaApiPut("{$deck->id}/slides/{$slide->id}/media", ['file_id' => $image->id])->assertNotFound();
    expect($slide->fresh()->media_file_id)->toBe($image->id);
    mediaApiPut("{$deck->id}/slides/{$slide->id}/media", ['file_id' => null])->assertOk()->assertJsonPath('data.slide.media', null);
    mediaApiPut("{$deck->id}/cover", ['file_id' => null])->assertOk()->assertJsonPath('data.deck.cover', null);
    mediaApiPut("{$deck->id}/slides/{$option->slide_id}/options/{$option->id}/image", ['file_id' => null])->assertOk()
        ->assertJsonPath('data.option.image', null);
});

it('touches the deck on every slide and option media change', function () {
    $user = DeckFactory::newOwner();
    $image = mediaApiImage($user);
    $video = mediaApiVideo($user);
    $deck = mediaApiDeck($user);
    $imageSlide = mediaApiSlide($deck, 'image');
    $videoSlide = mediaApiSlide($deck, 'video');
    $option = SlideOption::factory()->for(mediaApiSlide($deck, 'poll_single'))->create();
    Sanctum::actingAs($user);

    $changes = [
        'slide file' => ["{$deck->id}/slides/{$imageSlide->id}/media", ['file_id' => $image->id]],
        'slide file removed' => ["{$deck->id}/slides/{$imageSlide->id}/media", ['file_id' => null]],
        'video mp4' => ["{$deck->id}/slides/{$videoSlide->id}/media", ['file_id' => $video->id]],
        'video link' => ["{$deck->id}/slides/{$videoSlide->id}/media", ['video_url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ']],
        'video link removed' => ["{$deck->id}/slides/{$videoSlide->id}/media", ['video_url' => null]],
        'option image' => ["{$deck->id}/slides/{$option->slide_id}/options/{$option->id}/image", ['file_id' => $image->id]],
        'option image removed' => ["{$deck->id}/slides/{$option->slide_id}/options/{$option->id}/image", ['file_id' => null]],
    ];

    foreach ($changes as $label => [$path, $body]) {
        $before = now()->subDay()->startOfSecond();
        DB::table('decks')->where('id', $deck->id)->update(['updated_at' => $before]);

        mediaApiPut($path, $body)->assertOk();

        expect($deck->fresh()->updated_at->greaterThan($before))->toBeTrue("{$label} did not touch the deck");
    }
});

/**
 * The row locks and row writes on decks, slides and slide_options that $run
 * issues, in order, as "lock <table>" / "update <table>".
 *
 * @return list<string>
 */
function mediaApiDeckRowLocks(Closure $run): array
{
    $statements = [];
    DB::listen(function ($query) use (&$statements) {
        $statements[] = $query->sql;
    });

    $run();

    $locks = [];
    foreach ($statements as $sql) {
        if (preg_match('/^select .* from "(decks|slides|slide_options)" .*for update$/i', $sql, $m)) {
            $locks[] = "lock {$m[1]}";
        } elseif (preg_match('/^update "(decks|slides|slide_options)" /i', $sql, $m)) {
            $locks[] = "update {$m[1]}";
        }
    }

    return $locks;
}

it('locks the deck row before slide and option rows, like deck authoring, so the two never deadlock', function () {
    $user = DeckFactory::newOwner();
    $image = mediaApiImage($user);
    $deck = mediaApiDeck($user);
    $imageSlide = mediaApiSlide($deck, 'image');
    $videoSlide = mediaApiSlide($deck, 'video');
    $option = SlideOption::factory()->for(mediaApiSlide($deck, 'poll_single'))->create();
    Sanctum::actingAs($user);

    // Backdated so the deck touch is a real UPDATE, not a same-second no-op.
    $put = function (string $path, array $body) use ($deck) {
        DB::table('decks')->where('id', $deck->id)->update(['updated_at' => now()->subDay()]);

        return mediaApiDeckRowLocks(fn () => mediaApiPut($path, $body)->assertOk());
    };

    // Deck authoring (SlidePositions::lock, then the deck's slides/options) takes the
    // deck row first; a media change taking the slide or option row first could deadlock with it.
    expect($put("{$deck->id}/slides/{$imageSlide->id}/media", ['file_id' => $image->id]))
        ->toBe(['lock decks', 'lock slides', 'update slides', 'update decks'])
        ->and($put("{$deck->id}/slides/{$imageSlide->id}/media", ['file_id' => null]))
        ->toBe(['lock decks', 'lock slides', 'update slides', 'update decks'])
        ->and($put("{$deck->id}/slides/{$videoSlide->id}/media", ['video_url' => 'https://vimeo.com/76979871']))
        ->toBe(['lock decks', 'lock slides', 'update slides', 'update decks'])
        ->and($put("{$deck->id}/slides/{$option->slide_id}/options/{$option->id}/image", ['file_id' => $image->id]))
        ->toBe(['lock decks', 'update slide_options', 'update decks']);
});

it('lets the legacy /files/store take videos up to max_video_mb', function () {
    Sanctum::actingAs(DeckFactory::newOwner());

    // 30 MB: over the image and document caps, under the video cap.
    $this->post('/api/v1/files/store', ['file' => UploadedFile::fake()->create('lesson.mp4', 30 * 1024, 'video/mp4')], ['Accept' => 'application/json'])
        ->assertCreated()
        ->assertJsonPath('data.file.category', 'video');

    $this->post('/api/v1/files/store', ['file' => UploadedFile::fake()->create('long.mp4', 51 * 1024, 'video/mp4')], ['Accept' => 'application/json'])
        ->assertStatus(422);

    // Images keep their own (smaller) cap, applied by the library.
    $this->post('/api/v1/files/store', ['file' => UploadedFile::fake()->create('huge.png', 12 * 1024, 'image/png')], ['Accept' => 'application/json'])
        ->assertStatus(422);

    expect(\App\Http\Requests\File\StoreRequest::maxKilobytes())->toBe(50 * 1024);
});
