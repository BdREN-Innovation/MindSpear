<?php

namespace App\Deck\Slides\Types\Content;

use App\Models\File;
use Illuminate\Validation\ValidationException;

/**
 * `video`: EITHER a YouTube/Vimeo link OR an mp4 from My Files, never both.
 * Neither is fine while authoring (a fresh slide has no video yet).
 *
 * Links must be https on an exact YouTube/Vimeo host with a recognisable
 * video id; anything else (other hosts, look-alike domains, credentials,
 * custom ports, playlists without a video) is rejected. The provider, id and
 * a privacy-friendly embed URL are derived here so the frontend never parses
 * URLs. The mp4 is attached through slides.media_file_id (never through
 * config) and snapshotted into config.media by withMedia(), which refuses a
 * slide that has both a link and an upload.
 *
 * Config (author): {video_url: ?string (≤2048), video_provider: ?'youtube'|'vimeo',
 *                   video_id: ?string, embed_url: ?string}.
 * video_provider / video_id / embed_url are derived from video_url (input values are ignored).
 * Snapshot adds: media: ?{file_id:int, url:string (File::url), width:?int, height:?int, mime:'video/mp4'}.
 * Answer payload: none (validateAnswer always throws). Aggregate: [].
 */
class VideoSlideType extends ContentSlideType
{
    public const MAX_URL = 2048;

    public const PROVIDER_YOUTUBE = 'youtube';

    public const PROVIDER_VIMEO = 'vimeo';

    private const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];

    private const VIMEO_HOSTS = ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'];

    private const YOUTUBE_ID = '[A-Za-z0-9_-]{11}';

    private const VIMEO_HASH = '[0-9a-fA-F]{6,32}';

    public function key(): string
    {
        return 'video';
    }

    public function defaultConfig(): array
    {
        return ['video_url' => null, 'video_provider' => null, 'video_id' => null, 'embed_url' => null];
    }

    /** @throws ValidationException (key `media`) also when the slide already has a video link */
    public function withMedia(array $config, ?File $file): array
    {
        $config = parent::withMedia($config, $file);

        if ($config['media'] !== null && ($config['video_url'] ?? null) !== null) {
            throw ValidationException::withMessages(['media' => 'Use either a video link or an uploaded video, not both.']);
        }

        return $config;
    }

    protected function mediaMimes(): array
    {
        return self::VIDEO_MIMES;
    }

    protected function normaliseConfig(array $config): array
    {
        $url = $this->text($config['video_url'], 'video_url', self::MAX_URL, nullable: true);

        $video = null;
        if ($url !== null) {
            $video = static::parseVideoUrl($url);
            if ($video === null) {
                $this->fail('video_url', 'The video link must be an https YouTube or Vimeo video URL.');
            }
        }

        return [
            'video_url' => $url,
            'video_provider' => $video['provider'] ?? null,
            'video_id' => $video['id'] ?? null,
            'embed_url' => $video['embed_url'] ?? null,
        ];
    }

    /**
     * Provider, id and embed URL of a YouTube/Vimeo link, or null when the
     * link is not an https URL to a video on one of those exact hosts.
     *
     * Patterns end in `\z`, not `$`: query values arrive percent-decoded, and
     * `$` would let a trailing "%0A" newline into the id.
     *
     * @return array{provider:string, id:string, embed_url:string}|null
     */
    public static function parseVideoUrl(string $url): ?array
    {
        if (preg_match('/[\s\x00-\x1F\x7F\\\\]/', $url)) {
            return null;
        }

        $parts = parse_url($url);
        if ($parts === false || strtolower($parts['scheme'] ?? '') !== 'https' || ! isset($parts['host'])) {
            return null;
        }

        if (isset($parts['user']) || isset($parts['pass']) || (isset($parts['port']) && $parts['port'] !== 443)) {
            return null;
        }

        $host = strtolower($parts['host']);
        $path = $parts['path'] ?? '/';
        parse_str($parts['query'] ?? '', $query);

        if (in_array($host, self::YOUTUBE_HOSTS, true)) {
            $id = self::youtubeId($host, $path, $query);

            return $id === null ? null : [
                'provider' => self::PROVIDER_YOUTUBE,
                'id' => $id,
                'embed_url' => "https://www.youtube-nocookie.com/embed/{$id}",
            ];
        }

        if (in_array($host, self::VIMEO_HOSTS, true)) {
            [$id, $hash] = self::vimeoId($host, $path, $query);

            return $id === null ? null : [
                'provider' => self::PROVIDER_VIMEO,
                'id' => $id,
                'embed_url' => "https://player.vimeo.com/video/{$id}" . ($hash !== null ? "?h={$hash}" : ''),
            ];
        }

        return null;
    }

    private static function youtubeId(string $host, string $path, array $query): ?string
    {
        $id = self::YOUTUBE_ID;

        if ($host === 'youtu.be') {
            return preg_match("~^/({$id})/?\\z~", $path, $m) ? $m[1] : null;
        }

        if (preg_match("~^/(?:embed|shorts|live|v)/({$id})/?\\z~", $path, $m)) {
            return $m[1];
        }

        if (! str_contains($host, 'nocookie') && preg_match('~^/watch/?\z~', $path)) {
            $v = $query['v'] ?? null;

            return is_string($v) && preg_match("~^{$id}\\z~", $v) ? $v : null;
        }

        return null;
    }

    /** @return array{0:?string, 1:?string} [video id, unlisted-video hash] */
    private static function vimeoId(string $host, string $path, array $query): array
    {
        $hashPattern = self::VIMEO_HASH;

        if ($host === 'player.vimeo.com') {
            if (! preg_match('~^/video/(\d{1,12})/?\z~', $path, $m)) {
                return [null, null];
            }

            // A malformed `h` would embed a private video that never plays: reject the link.
            $hash = $query['h'] ?? null;
            if ($hash !== null && ! (is_string($hash) && preg_match("~^{$hashPattern}\\z~", $hash))) {
                return [null, null];
            }

            return [$m[1], $hash !== null ? strtolower($hash) : null];
        }

        $pattern = '~^/(?:channels/[\w-]{1,64}/|groups/[\w-]{1,64}/videos/|(?:album|showcase)/\d{1,12}/video/|video/)?(\d{1,12})(?:/(' . $hashPattern . '))?/?\z~';

        return preg_match($pattern, $path, $m) ? [$m[1], isset($m[2]) ? strtolower($m[2]) : null] : [null, null];
    }
}
