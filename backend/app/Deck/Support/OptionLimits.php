<?php

namespace App\Deck\Support;

/**
 * How many options a slide type may have (config('deck.option_limits')).
 * The cap keeps whole-aggregate broadcasts under Reverb's 10,000-byte
 * publish limit; the minimum is what a slide needs to be answerable.
 */
final class OptionLimits
{
    public static function max(string $type): int
    {
        $limits = (array) config('deck.option_limits', []);

        return (int) ($limits['max'][$type] ?? $limits['default_max'] ?? 30);
    }

    /** The highest cap of any type: the longest option list a request may carry. */
    public static function ceiling(): int
    {
        $limits = (array) config('deck.option_limits', []);

        return (int) max([(int) ($limits['default_max'] ?? 30), ...array_map('intval', (array) ($limits['max'] ?? []))]);
    }

    public static function min(string $type): int
    {
        return (int) (config('deck.option_limits.min', [])[$type] ?? 0);
    }
}
