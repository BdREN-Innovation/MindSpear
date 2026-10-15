<?php

namespace App\Deck\Slides\Types\Quest;

use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Throwable;

/**
 * Pure helpers shared by the free-text poll types (word_cloud, open_ended).
 * Not a slide type, so discovery skips it.
 */
final class PollText
{
    /**
     * Bytes the variable-length list of a broadcast aggregate may take once
     * JSON-encoded twice (the Pusher HTTP body is JSON with the event data
     * JSON-encoded inside it). Reverb rejects bodies over
     * reverb.max_request_size (10,000 by default) with a 413 and the broadcast
     * is only logged, so the chart would silently freeze; the rest of the
     * event envelope fits in the remaining ~3 KB.
     */
    public const BROADCAST_BUDGET_BYTES = 7_000;

    /**
     * Invisible characters that only hide or disguise text: soft hyphen,
     * Arabic letter mark, Mongolian vowel separator, zero-width space, LRM/RLM,
     * bidi embeddings/overrides/isolates, word joiner and invisible operators,
     * BOM. ZWJ/ZWNJ (emoji sequences, Bengali conjuncts, Persian) and tag
     * characters (subdivision flags) are deliberately not listed.
     */
    private const INVISIBLE = '/[\x{00AD}\x{061C}\x{180E}\x{200B}\x{200E}\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{2066}-\x{2069}\x{FEFF}]+/u';

    /** ZWJ/ZWNJ touching ASCII join nothing; dropping them stops "da<ZWJ>rn" slipping past the profanity filter. */
    private const ASCII_JOINERS = '/(?<=[\x00-\x7F])[\x{200C}\x{200D}]+|[\x{200C}\x{200D}]+(?=[\x00-\x7F])/u';

    public static function stripInvisible(string $text): string
    {
        $text = preg_replace(self::INVISIBLE, '', $text) ?? $text;

        return preg_replace(self::ASCII_JOINERS, '', $text) ?? $text;
    }

    /**
     * The longest prefix of $items whose broadcast size (double JSON-encoded,
     * plus a separator each) stays within $budget bytes.
     */
    public static function fitBroadcastBudget(array $items, int $budget = self::BROADCAST_BUDGET_BYTES): array
    {
        $fitted = [];
        $used = 0;

        foreach ($items as $item) {
            $used += strlen((string) json_encode((string) json_encode($item))) + 1;
            if ($used > $budget) {
                break;
            }
            $fitted[] = $item;
        }

        return $fitted;
    }

    /** ISO-8601 string to a UTC time; null for anything unparseable. */
    public static function timestamp(mixed $value): ?CarbonInterface
    {
        if (! is_string($value) || $value === '') {
            return null;
        }

        try {
            return Carbon::parse($value)->utc();
        } catch (Throwable) {
            return null;
        }
    }
}
