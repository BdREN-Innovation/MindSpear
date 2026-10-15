<?php

namespace App\Deck\Authoring;

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\DeckValidation;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Content\ContentSlideType;
use App\Deck\Support\OptionLimits;
use App\Models\Deck\Slide;
use Closure;
use Illuminate\Validation\ValidationException;

/**
 * Turns author input into stored slide / option values, through the slide
 * type registry (plan §2.5). Errors are ValidationExceptions with bare keys
 * (`body`, `config.x`, `options`, ...); callers prefix them where the input
 * is nested (bulk: `slides.N.`).
 */
class SlideInput
{
    /**
     * Config keys only the server writes. Media is attached through
     * slides.media_file_id (TakesMedia::withMedia() builds `media` at session
     * start) and a video link through PUT /slides/{id}/media, so author config
     * never sets them: they are dropped from input and the stored values kept.
     */
    public const SERVER_MANAGED_CONFIG_KEYS = ['media', 'media_file_id', 'video_url', 'video_provider', 'video_id', 'embed_url'];

    public const MAX_TITLE = 280;

    public const MAX_LABEL = 200;

    /** Encoded size caps checked before the type validates anything. */
    public const MAX_CONFIG_BYTES = 16384;

    public const MAX_BODY_INPUT_BYTES = 131072;

    /** Option payloads are type extras (no Quest type reads one yet); every byte also rides in slide.changed. */
    public const MAX_OPTION_PAYLOAD_BYTES = 512;

    public const MIN_TIME_LIMIT = DeckSettings::MIN_TIME_LIMIT;

    public const MAX_TIME_LIMIT = DeckSettings::MAX_TIME_LIMIT;

    public const MAX_GET_READY = DeckSettings::MAX_GET_READY;

    public function __construct(private readonly SlideTypeRegistry $registry) {}

    /**
     * The registered type $key when $product offers it.
     *
     * @throws DeckException 422 unsupported_type, shown on $field
     */
    public function supportedType(string $product, mixed $key, string $field = 'type'): SlideTypeContract
    {
        if (is_string($key) && $this->registry->has($key)) {
            $type = $this->registry->for($key);
            if (in_array($product, $type->products(), true)) {
                return $type;
            }
        }

        throw self::unsupported(is_string($key) ? $key : null, [$field]);
    }

    /** The type of an existing slide (422 unsupported_type when it is no longer registered for the deck's product). */
    public function typeOf(Slide $slide, string $product): SlideTypeContract
    {
        return $this->supportedType($product, (string) $slide->type);
    }

    /** 422 unsupported_type with the message on every field in $fields. */
    public static function unsupported(?string $type, array $fields): DeckException
    {
        $message = 'Unsupported slide type for this product.';

        // Client input: echo it only when it can be JSON-encoded.
        return new DeckException($message, 422, DeckException::CODE_UNSUPPORTED_TYPE, [
            'type' => $type !== null && mb_check_encoding($type, 'UTF-8') ? $type : null,
            'validation_errors' => array_fill_keys($fields, [$message]),
        ]);
    }

    /**
     * Normalised config: $incoming (server-managed keys dropped) merged onto
     * $stored, then the type's validateConfig(). Objects merge key by key
     * (x_axis: {low} keeps the stored high); lists and scalars replace.
     * A type may define an optional `mergeConfig(array $stored, array
     * $incoming): array` hook to merge dependent keys itself (scales resizes
     * the stored scale_labels when only scale_points is sent).
     *
     * @throws ValidationException keyed "{$field}.{type key}" (e.g. config.min_selections), or $field itself when too large
     */
    public function config(SlideTypeContract $type, array $incoming, array $stored = [], string $field = 'config'): array
    {
        if (strlen((string) json_encode($incoming)) > self::MAX_CONFIG_BYTES) {
            DeckValidation::fail([$field => 'The config is too large.']);
        }

        foreach (self::SERVER_MANAGED_CONFIG_KEYS as $key) {
            unset($incoming[$key]);
        }

        $merged = method_exists($type, 'mergeConfig') ? $type->mergeConfig($stored, $incoming) : self::merge($stored, $incoming);

        return DeckValidation::prefixed($field, fn () => $type->validateConfig($merged));
    }

    /**
     * Rich-text body. Only types that define validateBody() (paragraph)
     * take one; every other type accepts null only. Pass the raw request
     * value: TrimStrings would eat the spaces between styled text runs.
     *
     * @throws ValidationException keyed `body`
     */
    public function body(SlideTypeContract $type, mixed $body): ?array
    {
        if ($body === null) {
            return null;
        }

        if (! method_exists($type, 'validateBody')) {
            DeckValidation::fail(['body' => 'This slide type has no rich-text body.']);
        }

        if (! is_array($body)) {
            DeckValidation::fail(['body' => 'The body must be a rich-text document.']);
        }

        if (strlen((string) json_encode($body)) > self::MAX_BODY_INPUT_BYTES) {
            DeckValidation::fail(['body' => 'The body is too large.']);
        }

        return $type::validateBody($body);
    }

    /** Single-line, control characters removed; '' becomes null. */
    public function title(?string $title): ?string
    {
        return self::line($title);
    }

    public function label(?string $label): ?string
    {
        return self::line($label);
    }

    /**
     * An option payload: a JSON object (type extras such as a matrix label),
     * at most MAX_OPTION_PAYLOAD_BYTES encoded.
     *
     * @throws ValidationException keyed `payload`
     */
    public function payload(mixed $payload): array
    {
        if ($payload === null) {
            return [];
        }

        if (! is_array($payload) || ($payload !== [] && array_is_list($payload))) {
            DeckValidation::fail(['payload' => 'The payload must be an object.']);
        }

        if (strlen((string) json_encode($payload)) > self::MAX_OPTION_PAYLOAD_BYTES) {
            DeckValidation::fail(['payload' => 'The payload may not be larger than ' . self::MAX_OPTION_PAYLOAD_BYTES . ' bytes.']);
        }

        return $payload;
    }

    /** Whether slides of $type have options at all (content, word cloud, Q&A, matrix and pin types do not). */
    public function takesOptions(SlideTypeContract $type): bool
    {
        return $type->defaultOptions() !== [] || OptionLimits::min($type->key()) > 0;
    }

    /**
     * Checked option rows for a new slide ($options null = the type's
     * defaults). Errors: `options` (count), `options.N.payload`.
     *
     * @return list<array{label:?string, payload:array}>
     */
    public function options(SlideTypeContract $type, ?array $options): array
    {
        if ($options === null) {
            return array_values(array_map(fn (array $option) => [
                'label' => $option['label'] ?? null,
                'payload' => $option['payload'] ?? [],
            ], $type->defaultOptions()));
        }

        if (! $this->takesOptions($type)) {
            if ($options !== []) {
                DeckValidation::fail(['options' => 'This slide type has no options.']);
            }

            return [];
        }

        $this->assertCount($type, count($options));

        $errors = [];
        $rows = [];
        foreach (array_values($options) as $index => $option) {
            $option = is_array($option) ? $option : [];
            $rows[] = [
                'label' => $this->label(isset($option['label']) ? (string) $option['label'] : null),
                'payload' => self::collect($errors, "options.{$index}", fn () => $this->payload($option['payload'] ?? null)) ?? [],
            ];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $rows;
    }

    /**
     * $count options must fit the type's limits (config/deck.php option_limits).
     *
     * @throws ValidationException keyed `options`
     */
    public function assertCount(SlideTypeContract $type, int $count): void
    {
        $max = OptionLimits::max($type->key());
        $min = OptionLimits::min($type->key());

        if ($count > $max) {
            DeckValidation::fail(['options' => "This slide can have at most {$max} options."]);
        }

        if ($count < $min) {
            DeckValidation::fail(['options' => "This slide needs at least {$min} " . ($min === 1 ? 'option' : 'options') . '.']);
        }
    }

    /**
     * time_limit_seconds / get_ready_seconds present in $data (already
     * range-checked by the FormRequest). Only answer-taking slides have a
     * timer. get_ready_seconds 0 is stored as 0: an explicit "no countdown"
     * that the session launcher keeps (it only falls back to the deck setting
     * for null).
     *
     * @throws ValidationException keyed by the field
     */
    public function timing(SlideTypeContract $type, array $data): array
    {
        $out = [];
        $errors = [];

        foreach (['time_limit_seconds', 'get_ready_seconds'] as $key) {
            if (! array_key_exists($key, $data)) {
                continue;
            }

            $value = $data[$key] === null ? null : (int) $data[$key];
            if ($value !== null && ! $type->acceptsAnswers()) {
                $errors[$key] = 'This slide type has no timer.';

                continue;
            }

            $out[$key] = $value;
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $out;
    }

    /**
     * Timer fields of a new slide, from the deck settings (answer-taking
     * types only). get_ready_seconds is always set (0 = off), so a later
     * change of the deck default never reaches existing slides.
     */
    public function seedTiming(SlideTypeContract $type, ?array $deckSettings): array
    {
        if (! $type->acceptsAnswers()) {
            return ['time_limit_seconds' => null, 'get_ready_seconds' => null];
        }

        $settings = DeckSettings::normalise($deckSettings);

        return [
            'time_limit_seconds' => $settings['default_time_limit'],
            'get_ready_seconds' => $settings['get_ready_seconds'],
        ];
    }

    /**
     * Default config of a new slide: defaultConfig(), then the type's
     * optional `seedConfigFromDeck(array $config, array $deckSettings): array`
     * hook (qa_audience takes default_qa_sort), then validateConfig().
     */
    public function seedConfig(SlideTypeContract $type, ?array $deckSettings): array
    {
        $config = $type->defaultConfig();

        if (! method_exists($type, 'seedConfigFromDeck')) {
            return $config;
        }

        try {
            return $type->validateConfig($type->seedConfigFromDeck($config, DeckSettings::normalise($deckSettings)));
        } catch (ValidationException) {
            return $config;
        }
    }

    /**
     * Runs $callback; a ValidationException it throws is added to $errors
     * under "{$prefix}." (or as-is when $prefix is '') and null returned.
     */
    public static function collect(array &$errors, string $prefix, Closure $callback): mixed
    {
        try {
            return $callback();
        } catch (ValidationException $e) {
            foreach ($e->errors() as $key => $messages) {
                $full = $prefix === '' ? $key : rtrim($prefix . '.' . $key, '.');
                $errors[$full] = array_merge($errors[$full] ?? [], $messages);
            }

            return null;
        }
    }

    /** Objects merge recursively; lists and scalars from $incoming replace. */
    public static function merge(array $stored, array $incoming): array
    {
        foreach ($incoming as $key => $value) {
            $nested = is_array($value) && $value !== [] && ! array_is_list($value)
                && is_array($stored[$key] ?? null) && $stored[$key] !== [] && ! array_is_list($stored[$key]);

            $stored[$key] = $nested ? self::merge($stored[$key], $value) : $value;
        }

        return $stored;
    }

    private static function line(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $clean = ContentSlideType::sanitize($value);

        return $clean === '' ? null : $clean;
    }
}
