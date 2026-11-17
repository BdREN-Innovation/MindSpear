<?php

namespace App\Deck\Slides\Types\Content;

use App\Deck\Slides\AbstractSlideType;
use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\TakesMedia;
use App\Models\File;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * Base for read-only content slides (heading, paragraph, bullets, ...),
 * shared by Quest and Quiz.
 *
 * Content slides never take answers: validateAnswer() always throws, score()
 * is zero and aggregate() is `[]`. Presenter view = participant view plus an
 * empty `aggregate`.
 *
 * validateConfig() is the author-facing path. It returns ONLY the type's
 * known keys (unknown keys are dropped). Text is not HTML-escaped (the
 * frontend escapes), but it is scrubbed to valid UTF-8, stripped of control
 * characters (newlines kept only in multi-line fields), trimmed and
 * length-checked. Errors use bare config keys (e.g. `items.2`), like the
 * Quest types, so a controller can prefix `config.` in one place.
 *
 * `media` is server-owned: authors attach a My Files item through
 * slides.media_file_id, never through config. validateConfig() drops any
 * incoming `media`; only withMedia() (given a File model) puts it back, with
 * the URL from File::url (plan §1.1, §1.9).
 */
abstract class ContentSlideType extends AbstractSlideType implements TakesMedia
{
    /** Mime types accepted as media on image slides (My Files images). */
    protected const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

    /** Mime types accepted as media on video slides (browser-playable mp4 only). */
    protected const VIDEO_MIMES = ['video/mp4'];

    /** Validation errors collected by the helpers below, thrown together. */
    private array $errors = [];

    public function products(): array
    {
        return ['quest', 'quiz'];
    }

    public function category(): string
    {
        return self::CATEGORY_CONTENT;
    }

    public function revealModel(): string
    {
        return self::REVEAL_NONE;
    }

    public function acceptsAnswers(): bool
    {
        return false;
    }

    public function validateConfig(array $config): array
    {
        // Author input never carries media (see withMedia()).
        unset($config['media']);

        $this->errors = [];

        try {
            $normalised = $this->normaliseConfig(array_replace($this->defaultConfig(), $config));
        } finally {
            $errors = $this->errors;
            $this->errors = [];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $normalised;
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        throw ValidationException::withMessages(['answer' => 'This slide does not accept answers.']);
    }

    public function score(array $payload, array $config, array $options, int $timeToAnswerMs): ScoreResult
    {
        return ScoreResult::zero();
    }

    /** Nothing to aggregate on a content slide. */
    public function aggregate(array $config, array $options, Collection $answers): array
    {
        return [];
    }

    /**
     * $config with the slide's attached My Files item snapshotted into
     * `media` ({file_id, url, width, height, mime}), or `media: null` when
     * nothing is attached. This is the only way media enters a content
     * slide's config. Callers resolve $file from slides.media_file_id after
     * FilePolicy::manage (session start, to build config_snapshot). Types
     * without media return $config unchanged.
     *
     * @throws ValidationException (key `media`) when the type takes no media or the file is the wrong kind
     */
    public function withMedia(array $config, ?File $file): array
    {
        unset($config['media']);
        $mimes = $this->mediaMimes();

        if ($mimes === []) {
            if ($file !== null) {
                throw ValidationException::withMessages(['media' => 'This slide does not take media.']);
            }

            return $config;
        }

        if ($file !== null && ! in_array(strtolower((string) $file->mime_type), $mimes, true)) {
            throw ValidationException::withMessages(['media' => 'The media must be one of: ' . implode(', ', $mimes) . '.']);
        }

        $config['media'] = $file === null ? null : static::mediaSnapshot($file);

        return $config;
    }

    /**
     * The config_snapshot `media` block for a My Files item. The URL always
     * comes from File::url, never from client input.
     *
     * @return array{file_id:int, url:string, width:?int, height:?int, mime:string}
     */
    public static function mediaSnapshot(File $file): array
    {
        return [
            'file_id' => (int) $file->id,
            'url' => $file->url,
            'width' => $file->width,
            'height' => $file->height,
            'mime' => strtolower((string) $file->mime_type),
        ];
    }

    /**
     * Valid UTF-8 without control characters, trimmed. Multi-line text keeps
     * "\n" (CRLF / CR normalised to LF) and tabs become spaces; single-line
     * text turns all line breaks and tabs into spaces.
     */
    public static function sanitize(string $value, bool $multiline = false): string
    {
        return trim(static::clean($value, $multiline));
    }

    /**
     * Validate and normalise the (defaults-merged) config. Report problems
     * with fail(); return only the type's known keys.
     */
    abstract protected function normaliseConfig(array $config): array;

    /** Mime types this type accepts as attached media; [] = no media. */
    protected function mediaMimes(): array
    {
        return [];
    }

    /** sanitize() without the trim, for rich-text runs where edge spaces matter. */
    protected static function clean(string $value, bool $multiline = false): string
    {
        $value = mb_scrub($value, 'UTF-8');
        $value = str_replace(["\r\n", "\r"], "\n", $value);
        $value = str_replace("\t", ' ', $value);

        if (! $multiline) {
            $value = str_replace("\n", ' ', $value);
        }

        // C0/C1 controls (except LF), plus bidi overrides/isolates that can
        // visually reorder text on the presenter screen.
        return preg_replace('/[^\P{Cc}\n]|[\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '', $value) ?? '';
    }

    protected function fail(string $key, string $message): void
    {
        $this->errors[$key] ??= $message;
    }

    /**
     * Sanitised string from $value, or null when the value is missing/blank
     * and $nullable. Non-strings and over-long text are reported via fail().
     */
    protected function text(mixed $value, string $key, int $max, bool $nullable = false, bool $multiline = false): ?string
    {
        if ($value === null) {
            return $nullable ? null : '';
        }

        if (! is_string($value) && ! is_int($value) && ! is_float($value)) {
            $this->fail($key, "The {$this->label($key)} must be text.");

            return $nullable ? null : '';
        }

        $clean = static::sanitize((string) $value, $multiline);

        if (mb_strlen($clean) > $max) {
            $this->fail($key, "The {$this->label($key)} may not be longer than {$max} characters.");
        }

        return ($clean === '' && $nullable) ? null : $clean;
    }

    protected function boolean(mixed $value, string $key, bool $default): bool
    {
        if ($value === null) {
            return $default;
        }

        // Same inputs Laravel's `boolean` rule accepts (form posts send "1"/"0").
        return match (true) {
            in_array($value, [true, 1, '1', 'true'], true) => true,
            in_array($value, [false, 0, '0', 'false'], true) => false,
            default => tap($default, fn () => $this->fail($key, "The {$this->label($key)} must be true or false.")),
        };
    }

    /** @param list<string> $allowed */
    protected function choice(mixed $value, string $key, array $allowed, string $default): string
    {
        if ($value === null) {
            return $default;
        }

        if (! is_string($value) || ! in_array($value, $allowed, true)) {
            $this->fail($key, "The {$this->label($key)} must be one of: " . implode(', ', $allowed) . '.');

            return $default;
        }

        return $value;
    }

    /**
     * List of single-line strings ($min..$max entries, each up to $maxLength).
     *
     * @return list<string>
     */
    protected function items(mixed $value, string $key, int $min, int $max, int $maxLength): array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            $this->fail($key, "The {$this->label($key)} must be a list.");

            return [];
        }

        if (count($value) < $min || count($value) > $max) {
            $this->fail($key, "The {$this->label($key)} must have between {$min} and {$max} entries.");
        }

        $items = [];
        foreach (array_slice($value, 0, $max) as $index => $item) {
            $items[] = (string) $this->text($item, "{$key}.{$index}", $maxLength);
        }

        return $items;
    }

    private function label(string $key): string
    {
        return str_replace(['.', '_'], [' ', ' '], $key);
    }
}
