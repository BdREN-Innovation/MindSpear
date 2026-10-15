<?php

namespace App\Deck\Slides\Types\Quest;

use Illuminate\Validation\ValidationException;

/**
 * Small pure helpers shared by the option-based poll types (poll_single,
 * poll_multi, scales, ranking). Not a slide type, so discovery skips it.
 */
final class PollOptions
{
    /**
     * Reject an oversized answer list before Validator::make expands its
     * wildcard rules: `*` expansion with `distinct` slows down quadratically
     * with length (20,000 ids took seconds), and a valid answer never lists
     * more entries than $max. Same message as the other list-based types.
     *
     * @throws ValidationException keyed $field
     */
    public static function assertListAtMost(array $payload, string $field, int $max): void
    {
        $list = $payload[$field] ?? null;

        if (is_array($list) && count($list) > $max) {
            throw ValidationException::withMessages([
                $field => "The {$field} field must not have more than {$max} items.",
            ]);
        }
    }

    /**
     * Option ids of a run's options_snapshot in display order (position, then id),
     * so aggregates and normalised payloads never depend on snapshot order.
     *
     * @return list<int>
     */
    public static function ids(array $options): array
    {
        usort($options, fn (array $a, array $b) => [(int) ($a['position'] ?? 0), (int) ($a['id'] ?? 0)]
            <=> [(int) ($b['position'] ?? 0), (int) ($b['id'] ?? 0)]);

        return array_values(array_unique(array_map(fn (array $option) => (int) ($option['id'] ?? 0), $options)));
    }

    /**
     * @param  array<int, int>  $counts  option id => count, in display order
     * @return list<array{option_id: int, count: int, percentage: float}>
     */
    public static function counted(array $counts, int $denominator): array
    {
        $rows = [];
        foreach ($counts as $id => $count) {
            $rows[] = ['option_id' => $id, 'count' => $count, 'percentage' => self::percentage($count, $denominator)];
        }

        return $rows;
    }

    public static function percentage(int|float $part, int|float $whole): float
    {
        return $whole > 0 ? round($part / $whole * 100, 2) : 0.0;
    }
}
