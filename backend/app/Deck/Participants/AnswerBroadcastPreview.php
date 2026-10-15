<?php

namespace App\Deck\Participants;

use App\Deck\Slides\Types\Quest\OpenEndedSlideType;

/**
 * The `answer` of a host-only `answer.submitted` event: this submission only
 * (never the merged row, which grows with every append), cut to fit Reverb's
 * 10,000-byte publish limit.
 *
 * 1. Open-ended bodies ({entries: [{body, ...}]}) are cut to
 *    OpenEndedSlideType::PREVIEW_LENGTH characters with `body_truncated`,
 *    like the aggregate cards; the full text is on GET /aggregate?page=N.
 * 2. When the answer still encodes (default json_encode flags: \uXXXX
 *    escapes, the worst case a Pusher body sees) to more than BUDGET_BYTES,
 *    every string longer than a step of STEPS is cut to it and the answer
 *    gets `truncated: true`. Steps stay above an ISO-8601 time's length, so
 *    timestamps are never cut.
 * 3. If even that does not fit, the answer becomes {omitted: true}.
 *
 * The event JSON-encodes the payload once more inside the Pusher body, at
 * most doubling it, so BUDGET_BYTES leaves room for the rest of the event.
 */
final class AnswerBroadcastPreview
{
    public const BUDGET_BYTES = 3_500;

    /** Character caps tried in turn on long strings. */
    private const STEPS = [64, 32];

    public static function make(array $answer): array
    {
        if (isset($answer['entries']) && is_array($answer['entries'])) {
            $answer['entries'] = array_map(self::bodyPreview(...), $answer['entries']);
        }

        if (self::bytes($answer) <= self::BUDGET_BYTES) {
            return $answer;
        }

        foreach (self::STEPS as $step) {
            $cut = self::cutStrings($answer, $step);
            $cut['truncated'] = true;

            if (self::bytes($cut) <= self::BUDGET_BYTES) {
                return $cut;
            }
        }

        return ['omitted' => true];
    }

    public static function bytes(array $value): int
    {
        return strlen((string) json_encode($value, JSON_PARTIAL_OUTPUT_ON_ERROR));
    }

    private static function bodyPreview(mixed $entry): mixed
    {
        if (! is_array($entry) || ! is_string($entry['body'] ?? null)) {
            return $entry;
        }

        $cut = self::cut($entry['body'], OpenEndedSlideType::PREVIEW_LENGTH);
        $entry['body_truncated'] = $cut !== $entry['body'];
        $entry['body'] = $cut;

        return $entry;
    }

    private static function cutStrings(array $value, int $length): array
    {
        array_walk_recursive($value, function (mixed &$leaf) use ($length) {
            if (is_string($leaf)) {
                $leaf = self::cut($leaf, $length);
            }
        });

        return $value;
    }

    /** At most $length code points, on a grapheme boundary when intl is available. */
    private static function cut(string $text, int $length): string
    {
        if (mb_strlen($text) <= $length) {
            return $text;
        }

        $cut = function_exists('grapheme_extract') ? grapheme_extract($text, $length, GRAPHEME_EXTR_MAXCHARS) : false;

        return rtrim(is_string($cut) ? $cut : mb_substr($text, 0, $length));
    }
}
