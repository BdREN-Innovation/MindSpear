<?php

namespace App\Deck\Authoring;

/**
 * Deck-wide settings (plan §5.6 "Per deck"), stored whole in decks.settings.
 *
 *   default_time_limit  ?int 5..3600   seeds time_limit_seconds of new answer slides (null = no limit)
 *   get_ready_seconds   int 0..30      seeds get_ready_seconds of new answer slides (0 = no countdown)
 *   theme               string slug    colour palette preset (frontend-defined; [a-z0-9_-], ≤40)
 *   show_qr_sidebar     bool           presenter shows the join QR sidebar
 *   default_qa_sort     'top'|'newest' presenter's default Q&A sort
 *
 * Every write stores all five keys (defaults filled in), so clients always
 * read the full object. A key sent as null goes back to its default; any
 * other key is rejected (422 on `settings`).
 */
final class DeckSettings
{
    public const KEYS = ['default_time_limit', 'get_ready_seconds', 'theme', 'show_qr_sidebar', 'default_qa_sort'];

    public const DEFAULTS = [
        'default_time_limit' => null,
        'get_ready_seconds' => 0,
        'theme' => 'default',
        'show_qr_sidebar' => true,
        'default_qa_sort' => 'top',
    ];

    public const QA_SORTS = ['top', 'newest'];

    public const MIN_TIME_LIMIT = 5;

    public const MAX_TIME_LIMIT = 3600;

    public const MAX_GET_READY = 30;

    /** Validation rules for an incoming `settings` object (FormRequest style). */
    public static function rules(string $field = 'settings'): array
    {
        return [
            $field => ['sometimes', 'array:' . implode(',', self::KEYS)],
            "{$field}.default_time_limit" => ['nullable', 'integer', 'min:' . self::MIN_TIME_LIMIT, 'max:' . self::MAX_TIME_LIMIT],
            "{$field}.get_ready_seconds" => ['nullable', 'integer', 'min:0', 'max:' . self::MAX_GET_READY],
            "{$field}.theme" => ['nullable', 'string', 'max:40', 'regex:/^[a-z0-9][a-z0-9_-]*$/'],
            "{$field}.show_qr_sidebar" => ['nullable', 'boolean'],
            "{$field}.default_qa_sort" => ['nullable', 'string', 'in:' . implode(',', self::QA_SORTS)],
        ];
    }

    public static function messages(string $field = 'settings'): array
    {
        return [
            "{$field}.array" => 'The settings must be an object with only these keys: ' . implode(', ', self::KEYS) . '.',
            "{$field}.theme.regex" => 'The theme must be a preset name (lower-case letters, digits, - and _).',
        ];
    }

    /**
     * The full settings object: defaults, then the stored values, then the
     * (validated) changes. Unknown stored keys are dropped.
     */
    public static function normalise(?array $stored, array $changes = []): array
    {
        $settings = self::DEFAULTS;

        foreach ([(array) $stored, $changes] as $layer) {
            foreach (self::KEYS as $key) {
                if (array_key_exists($key, $layer)) {
                    $settings[$key] = $layer[$key] ?? self::DEFAULTS[$key];
                }
            }
        }

        return [
            'default_time_limit' => $settings['default_time_limit'] === null ? null : (int) $settings['default_time_limit'],
            'get_ready_seconds' => (int) $settings['get_ready_seconds'],
            'theme' => (string) $settings['theme'],
            'show_qr_sidebar' => (bool) $settings['show_qr_sidebar'],
            'default_qa_sort' => in_array($settings['default_qa_sort'], self::QA_SORTS, true) ? $settings['default_qa_sort'] : self::DEFAULTS['default_qa_sort'],
        ];
    }
}
