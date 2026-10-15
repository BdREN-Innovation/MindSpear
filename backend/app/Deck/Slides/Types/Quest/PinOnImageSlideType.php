<?php

namespace App\Deck\Slides\Types\Quest;

use App\Deck\Slides\AbstractSlideType;
use App\Deck\Slides\TakesMedia;
use App\Deck\Slides\Types\Content\ContentSlideType;
use App\Models\File;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Participants tap an image to drop pins; the presenter overlays a heatmap.
 *
 * Config (author): {max_pins_per_participant: int (1..10),
 *                   show_results_to_participants: bool (PollSettings, default false)}
 * Config (snapshot) adds media: {file_id: int >= 1, url: absolute http(s) url (<= 2048 chars),
 *                   width: int >= 1, height: int >= 1, mime: image/jpeg|png|gif|webp}
 *   `media` is server-owned (TakesMedia), like the image content slide: the
 *   image is the slide's media_file_id (a My Files image), validateConfig()
 *   drops any author-sent `media`, and withMedia() builds it from the File
 *   (url from File::url, width/height from the files row). Session start
 *   calls withMedia() and then assertMediaPresent() on the snapshot config,
 *   which also refuses an image whose width/height are unknown.
 *
 * Coordinates are percentages of the image, origin top-left:
 * x 0 = left edge, 100 = right edge; y 0 = top edge, 100 = bottom edge.
 * Anything outside 0..100 is outside the image and rejected.
 *
 * Answer payload (in):
 *   {pins: [{x: number 0..100, y: number 0..100}, ...]} (1..max_pins_per_participant)
 *   or the shorthand {x, y} for a single pin.
 * Answer payload (stored, normalised):
 *   {pins: [{x: float, y: float}, ...]} rounded to 2 dp, exact duplicates dropped.
 *
 * Aggregate (bounded, see PointCloud):
 *   {total_responses: int, total_pins: int,
 *    pins: [{x, y}, ...] (the latest PointCloud::MAX_POINTS, answer order),
 *    density: {size: 20, counts: [[int x 20] x 20]} (every pin; counts[row by y][col by x])}
 *   Pins carry no participant data: the aggregate goes out on the public channel.
 */
class PinOnImageSlideType extends AbstractSlideType implements TakesMedia
{
    public const KEY = 'pin_on_image';

    public const MAX_PINS_LIMIT = 10;

    /** Same formats as the image content slide (My Files images). */
    public const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

    private const MAX_URL_LENGTH = 2048;

    public function key(): string
    {
        return self::KEY;
    }

    public function category(): string
    {
        return self::CATEGORY_POLL;
    }

    public function revealModel(): string
    {
        return self::REVEAL_LIVE;
    }

    /** Session start refuses to snapshot this slide without an image. */
    public function requiresMedia(): bool
    {
        return true;
    }

    /** True when the (snapshot) config carries a valid attached image. */
    public function hasMedia(array $config): bool
    {
        $media = $config['media'] ?? null;

        return is_array($media) && $media !== [] && $this->mediaErrors($media) === [];
    }

    /**
     * @throws ValidationException when the (snapshot) config has no usable
     *                             image: always keyed `media`, plus the specific
     *                             `media.*` reasons when a media block is there
     */
    public function assertMediaPresent(array $config): void
    {
        if ($this->hasMedia($config)) {
            return;
        }

        $media = $config['media'] ?? null;

        throw ValidationException::withMessages([
            'media' => 'Pin on image slides need an attached image (jpg, png, gif or webp) with known width and height.',
            ...(is_array($media) && $media !== [] ? $this->mediaErrors($media) : []),
        ]);
    }

    public function defaultConfig(): array
    {
        return ['max_pins_per_participant' => 1, ...PollSettings::defaults()];
    }

    /** Author config only: an incoming `media` is dropped (see withMedia()). */
    public function validateConfig(array $config): array
    {
        $config = array_replace($this->defaultConfig(), $config);
        $limit = self::MAX_PINS_LIMIT;

        Validator::make($config, [
            'max_pins_per_participant' => ['required', 'integer', 'min:1', "max:{$limit}"],
            ...PollSettings::rules(),
        ])->validate();

        return [
            'max_pins_per_participant' => (int) $config['max_pins_per_participant'],
            ...PollSettings::normalise($config),
        ];
    }

    /**
     * $config with the attached My Files image snapshotted into `media`
     * (ContentSlideType::mediaSnapshot), or `media: null` without one.
     *
     * @throws ValidationException (key `media`) when the file is not a jpg, png, gif or webp image
     */
    public function withMedia(array $config, ?File $file): array
    {
        unset($config['media']);

        if ($file !== null && ! in_array(strtolower((string) $file->mime_type), self::IMAGE_MIMES, true)) {
            throw ValidationException::withMessages(['media' => 'The media must be one of: ' . implode(', ', self::IMAGE_MIMES) . '.']);
        }

        $config['media'] = $file === null ? null : ContentSlideType::mediaSnapshot($file);

        return $config;
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        // Shorthand for the common single-pin case.
        if (! array_key_exists('pins', $payload) && (array_key_exists('x', $payload) || array_key_exists('y', $payload))) {
            $payload = ['pins' => [['x' => $payload['x'] ?? null, 'y' => $payload['y'] ?? null]]];
        }

        $max = max(1, (int) ($config['max_pins_per_participant'] ?? $this->defaultConfig()['max_pins_per_participant']));

        // Reject an oversized list before the wildcard rules expand it: the
        // validator's `pins.*` expansion slows down quadratically with length.
        $pins = $payload['pins'] ?? null;
        if (is_array($pins) && count($pins) > $max) {
            throw ValidationException::withMessages([
                'pins' => "The pins field must not have more than {$max} items.",
            ]);
        }

        Validator::make(['pins' => $pins], [
            'pins' => ['required', 'array', 'list', 'min:1', "max:{$max}"],
            'pins.*' => ['required', 'array'],
            'pins.*.x' => ['required', 'numeric', 'between:0,100'],
            'pins.*.y' => ['required', 'numeric', 'between:0,100'],
        ], [
            'pins.*.x.between' => 'The pin must be on the image.',
            'pins.*.y.between' => 'The pin must be on the image.',
        ])->validate();

        $unique = [];
        foreach ($pins as $pin) {
            $point = ['x' => round((float) $pin['x'], 2), 'y' => round((float) $pin['y'], 2)];
            $unique[$point['x'] . ':' . $point['y']] = $point;
        }

        return ['pins' => array_values($unique)];
    }

    public function aggregate(array $config, array $options, Collection $answers): array
    {
        $pins = [];
        foreach ($answers as $answer) {
            foreach ($answer->answer_payload['pins'] ?? [] as $pin) {
                if (! is_array($pin) || ! PointCloud::onPlane($pin['x'] ?? null, $pin['y'] ?? null)) {
                    continue;
                }

                $pins[] = ['x' => (float) $pin['x'], 'y' => (float) $pin['y']];
            }
        }

        return [
            'total_responses' => $answers->count(),
            'total_pins' => count($pins),
            'pins' => PointCloud::latest($pins),
            'density' => PointCloud::density($pins),
        ];
    }

    /**
     * Problems with a media snapshot, keyed `media.*` (empty when valid):
     * a positive file_id, an absolute http(s) url (File::url always is), a
     * jpg/png/gif/webp mime, and width/height, which the heatmap needs for
     * the aspect ratio (older My Files images may not have them recorded).
     *
     * @return array<string, list<string>>
     */
    private function mediaErrors(array $media): array
    {
        $errors = [];

        if (! self::positiveInt($media['file_id'] ?? null)) {
            $errors['media.file_id'] = ['The media must be an attached My Files image.'];
        }

        $url = $media['url'] ?? null;
        $url = is_string($url) ? trim($url) : null;
        if ($url === null || $url === '' || strlen($url) > self::MAX_URL_LENGTH
            || preg_match('/[\x00-\x20\x7F]/', $url) || ! preg_match('#\Ahttps?://[^/?\#]#i', $url)) {
            $errors['media.url'] = ['The media url is invalid.'];
        }

        foreach (['width', 'height'] as $dimension) {
            if (! self::positiveInt($media[$dimension] ?? null)) {
                $errors["media.{$dimension}"] = ["The media {$dimension} must be a positive integer."];
            }
        }

        $mime = $media['mime'] ?? null;
        if (! is_string($mime) || ! in_array(strtolower($mime), self::IMAGE_MIMES, true)) {
            $errors['media.mime'] = ['The media must be one of: ' . implode(', ', self::IMAGE_MIMES) . '.'];
        }

        return $errors;
    }

    /** An int >= 1, or a digit string of one (JSON and form input). */
    private static function positiveInt(mixed $value): bool
    {
        return (is_int($value) || (is_string($value) && ctype_digit($value))) && (int) $value >= 1;
    }
}
