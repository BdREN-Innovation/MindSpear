<?php

use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Content\ContentSlideType;
use App\Deck\Slides\Types\Content\VideoSlideType;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\File;
use Database\Factories\Deck\DeckFactory;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Validation\ValidationException;

/*
 * Config validation for the media / session content types (image, video,
 * qr_code), and the server-owned media path: authors never set config.media,
 * only withMedia() does, from a My Files row.
 */

uses(DatabaseTransactions::class);

function deckContentMediaConfig(string $key, array $config): array
{
    return app(SlideTypeRegistry::class)->for($key)->validateConfig($config);
}

function deckContentMediaErrors(string $key, array $config): array
{
    try {
        deckContentMediaConfig($key, $config);
    } catch (ValidationException $e) {
        return $e->errors();
    }

    test()->fail("Config for [{$key}] unexpectedly validated: " . json_encode($config));
}

/** The errors withMedia() throws (fails the test when it succeeds). */
function deckContentMediaAttachErrors(string $key, array $config, ?File $file): array
{
    try {
        app(SlideTypeRegistry::class)->for($key)->withMedia($config, $file);
    } catch (ValidationException $e) {
        return $e->errors();
    }

    test()->fail("withMedia for [{$key}] unexpectedly succeeded.");
}

/** A My Files row owned by a fresh user: public image by default. */
function deckContentMediaFile(array $overrides = []): File
{
    $owner = DeckFactory::newOwner();

    return File::create(array_replace([
        'name' => 'cat.webp',
        'type' => 'image',
        'category' => File::CATEGORY_IMAGE,
        'visibility' => File::VISIBILITY_PUBLIC,
        'path' => "storage/library/{$owner->id}/images/cat.webp",
        'mime_type' => 'image/webp',
        'extension' => 'webp',
        'size' => 10,
        'width' => 800,
        'height' => 600,
        'user_id' => $owner->id,
    ], $overrides));
}

function deckContentMediaVideoFile(): File
{
    return deckContentMediaFile([
        'name' => 'intro.mp4',
        'type' => 'video',
        'category' => File::CATEGORY_VIDEO,
        'path' => 'storage/library/videos/intro.mp4',
        'mime_type' => 'video/mp4',
        'extension' => 'mp4',
        'width' => null,
        'height' => null,
    ]);
}

it('validates image caption and alt', function () {
    expect(deckContentMediaConfig('image', ['caption' => " A cat\x00 ", 'alt' => '']))
        ->toBe(['caption' => 'A cat', 'alt' => null]);
});

it('rejects bad image config with bare keys', function (array $config, string $errorKey) {
    expect(deckContentMediaErrors('image', $config))->toHaveKey($errorKey);
})->with([
    'caption too long' => [['caption' => str_repeat('a', 201)], 'caption'],
    'alt too long' => [['alt' => str_repeat('a', 251)], 'alt'],
]);

it('drops author-supplied media from image and video config', function (string $key, mixed $media) {
    $config = deckContentMediaConfig($key, ['media' => $media]);

    expect($config)->toBe(app(SlideTypeRegistry::class)->for($key)->defaultConfig())
        ->and($config)->not->toHaveKey('media')
        ->and(json_encode($config))->not->toBeFalse();
})->with(['image', 'video'])->with([
    'javascript url' => [['file_id' => 999999, 'url' => 'javascript:alert(document.cookie)', 'mime' => 'image/png']],
    'data url' => [['file_id' => 1, 'url' => 'data:image/svg+xml;base64,PHN2Zz4=', 'mime' => 'image/png']],
    'external tracker' => [['file_id' => 1, 'url' => 'http://tracker.evil.test/pixel.gif', 'mime' => 'image/gif']],
    'external mp4' => [['file_id' => 1, 'url' => 'https://cdn.example.test/video.mp4', 'mime' => 'video/mp4']],
    'invalid utf-8' => [['file_id' => 1, 'url' => "https://x.test/\xFF.png", 'mime' => 'image/png']],
    'not an object' => ['https://x.test/a.png'],
]);

it('snapshots an attached image from the My Files row, URL from File::url', function () {
    $file = deckContentMediaFile();
    $type = app(SlideTypeRegistry::class)->for('image');

    $snapshot = $type->withMedia($type->validateConfig(['caption' => 'A cat', 'media' => ['url' => 'javascript:alert(1)']]), $file);

    expect($snapshot)->toBe([
        'caption' => 'A cat',
        'alt' => null,
        'media' => ['file_id' => $file->id, 'url' => $file->url, 'width' => 800, 'height' => 600, 'mime' => 'image/webp'],
    ])
        ->and($snapshot['media']['url'])->toStartWith(url('/storage/library/'))
        ->and(ContentSlideType::mediaSnapshot($file))->toBe($snapshot['media']);

    // Participants get exactly the server-built media block.
    $run = DeckSessionSlideRun::factory()->create(['type_snapshot' => 'image', 'config_snapshot' => $snapshot]);
    expect($type->serializeForParticipant($run)['config']['media'])->toBe($snapshot['media']);
});

it('keeps media from a soft-deleted file, so live decks keep showing it', function () {
    $file = deckContentMediaFile();
    $file->delete();

    expect(app(SlideTypeRegistry::class)->for('image')->withMedia([], $file)['media']['url'])->toBe($file->url);
});

it('sets media to null when nothing is attached', function (string $key) {
    $type = app(SlideTypeRegistry::class)->for($key);

    expect($type->withMedia($type->defaultConfig() + ['media' => ['url' => 'https://evil.test/x']], null))
        ->toBe($type->defaultConfig() + ['media' => null]);
})->with(['image', 'video']);

it('refuses files of the wrong kind', function (string $key, array $overrides) {
    expect(deckContentMediaAttachErrors($key, [], deckContentMediaFile($overrides)))->toHaveKey('media');
})->with([
    'pdf on an image slide' => ['image', ['category' => File::CATEGORY_DOCUMENT, 'visibility' => File::VISIBILITY_PRIVATE, 'path' => null, 'mime_type' => 'application/pdf']],
    'svg on an image slide' => ['image', ['mime_type' => 'image/svg+xml']],
    'image on a video slide' => ['video', []],
    'webm on a video slide' => ['video', ['category' => File::CATEGORY_VIDEO, 'mime_type' => 'video/webm']],
]);

it('takes no media on text and session content types', function (string $key) {
    $type = app(SlideTypeRegistry::class)->for($key);
    $config = $type->defaultConfig();

    expect($type->withMedia($config + ['media' => ['url' => 'x']], null))->toBe($config)
        ->and(deckContentMediaAttachErrors($key, $config, deckContentMediaFile()))->toHaveKey('media');
})->with(['heading', 'paragraph', 'bullets', 'numbered', 'quote', 'big_text', 'qr_code']);

it('snapshots an uploaded mp4 instead of a link', function () {
    $file = deckContentMediaVideoFile();
    $type = app(SlideTypeRegistry::class)->for('video');

    expect($type->withMedia($type->validateConfig([]), $file))->toBe([
        'video_url' => null,
        'video_provider' => null,
        'video_id' => null,
        'embed_url' => null,
        'media' => ['file_id' => $file->id, 'url' => $file->url, 'width' => null, 'height' => null, 'mime' => 'video/mp4'],
    ]);
});

it('rejects a video slide with both a link and an upload', function () {
    $config = deckContentMediaConfig('video', ['video_url' => 'https://youtu.be/dQw4w9WgXcQ']);

    expect(deckContentMediaAttachErrors('video', $config, deckContentMediaVideoFile())['media'][0])->toContain('not both');
});

it('derives provider, id and embed URL from valid video links', function (string $url, string $provider, string $id, string $embed) {
    $config = deckContentMediaConfig('video', ['video_url' => "  {$url} ", 'video_provider' => 'spoofed', 'embed_url' => 'https://evil.test']);

    expect($config)->toBe([
        'video_url' => $url,
        'video_provider' => $provider,
        'video_id' => $id,
        'embed_url' => $embed,
    ]);
})->with([
    'youtube watch' => ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'youtube', 'dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    'youtube bare host' => ['https://youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    'youtube mobile' => ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    'youtube short link' => ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'youtube', 'dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    'youtube embed' => ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    'youtube nocookie embed' => ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    'youtube shorts' => ['https://www.youtube.com/shorts/aBcDeFgHiJ_', 'youtube', 'aBcDeFgHiJ_', 'https://www.youtube-nocookie.com/embed/aBcDeFgHiJ_'],
    'youtube upper-case host' => ['https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    'vimeo' => ['https://vimeo.com/76979871', 'vimeo', '76979871', 'https://player.vimeo.com/video/76979871'],
    'vimeo unlisted' => ['https://vimeo.com/76979871/8272103f6e', 'vimeo', '76979871', 'https://player.vimeo.com/video/76979871?h=8272103f6e'],
    'vimeo www channel' => ['https://www.vimeo.com/channels/staffpicks/76979871', 'vimeo', '76979871', 'https://player.vimeo.com/video/76979871'],
    'vimeo player' => ['https://player.vimeo.com/video/76979871?h=8272103f6e&badge=0', 'vimeo', '76979871', 'https://player.vimeo.com/video/76979871?h=8272103f6e'],
    'vimeo player without hash' => ['https://player.vimeo.com/video/76979871', 'vimeo', '76979871', 'https://player.vimeo.com/video/76979871'],
]);

it('rejects video links that are not https YouTube or Vimeo videos', function (string $url) {
    expect(deckContentMediaErrors('video', ['video_url' => $url]))->toHaveKey('video_url')
        ->and(VideoSlideType::parseVideoUrl($url))->toBeNull();
})->with([
    'http' => ['http://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    'protocol relative' => ['//www.youtube.com/watch?v=dQw4w9WgXcQ'],
    'javascript' => ['javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ'],
    'look-alike suffix' => ['https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ'],
    'look-alike prefix' => ['https://notyoutube.com/watch?v=dQw4w9WgXcQ'],
    'subdomain not allowed' => ['https://music.youtube.com/watch?v=dQw4w9WgXcQ'],
    'credentials' => ['https://youtube.com@evil.test/watch?v=dQw4w9WgXcQ'],
    'user on real host' => ['https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ'],
    'custom port' => ['https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ'],
    'fragment trick' => ['https://evil.test#www.youtube.com/watch?v=dQw4w9WgXcQ'],
    'backslash trick' => ['https://evil.test\\@www.youtube.com/watch?v=dQw4w9WgXcQ'],
    'youtube no id' => ['https://www.youtube.com/watch'],
    'youtube bad id' => ['https://www.youtube.com/watch?v=short'],
    'youtube id array' => ['https://www.youtube.com/watch?v[]=dQw4w9WgXcQ'],
    'youtube id with encoded newline' => ['https://www.youtube.com/watch?v=dQw4w9WgXcQ%0A'],
    'youtube id with encoded CR' => ['https://www.youtube.com/watch?v=dQw4w9WgXcQ%0D'],
    'youtube playlist only' => ['https://www.youtube.com/playlist?list=PL1234567890'],
    'youtube channel' => ['https://www.youtube.com/@somechannel'],
    'youtu.be extra path' => ['https://youtu.be/dQw4w9WgXcQ/extra'],
    'youtu.be encoded newline' => ['https://youtu.be/dQw4w9WgXcQ%0A'],
    'vimeo profile' => ['https://vimeo.com/someuser'],
    'vimeo player non numeric' => ['https://player.vimeo.com/video/abc'],
    'vimeo hash with encoded newline' => ['https://player.vimeo.com/video/76979871?h=8272103f6e%0A'],
    'vimeo malformed hash' => ['https://player.vimeo.com/video/76979871?h=not-a-hash'],
    'vimeo hash array' => ['https://player.vimeo.com/video/76979871?h[]=8272103f6e'],
    'other host' => ['https://www.dailymotion.com/video/x7tgad0'],
    'mp4 link' => ['https://cdn.example.test/video.mp4'],
    'not a url' => ['dQw4w9WgXcQ'],
]);

it('rejects over-long and non-string video links', function () {
    expect(deckContentMediaErrors('video', ['video_url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=' . str_repeat('a', 2048)]))->toHaveKey('video_url')
        ->and(deckContentMediaErrors('video', ['video_url' => ['https://youtu.be/dQw4w9WgXcQ']]))->toHaveKey('video_url');
});

it('treats a blank video link as no link', function () {
    expect(deckContentMediaConfig('video', ['video_url' => '   ']))->toBe(app(SlideTypeRegistry::class)->for('video')->defaultConfig());
});

it('validates the qr_code show_join_code flag', function (mixed $input, bool $expected) {
    expect(deckContentMediaConfig('qr_code', ['show_join_code' => $input]))->toBe(['show_join_code' => $expected]);
})->with([
    'true' => [true, true],
    'false' => [false, false],
    'one' => [1, true],
    'zero string' => ['0', false],
    'null means default' => [null, true],
]);

it('rejects a non-boolean show_join_code', function (mixed $input) {
    expect(deckContentMediaErrors('qr_code', ['show_join_code' => $input]))->toHaveKey('show_join_code');
})->with(['yes', 2, [[true]], 'on']);
