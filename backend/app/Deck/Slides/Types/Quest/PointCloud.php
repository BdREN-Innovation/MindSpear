<?php

namespace App\Deck\Slides\Types\Quest;

/**
 * Bounded summary of percentage points (0..100 on both axes) for the
 * matrix_2x2 and pin_on_image aggregates. Not a slide type, so discovery
 * skips it.
 *
 * Aggregates go out whole on the public channel (slide.aggregate.updated and
 * slide.closed), and Reverb rejects any publish request over
 * REVERB_MAX_REQUEST_SIZE (10,000 bytes by default). A raw list with one entry
 * per answer would stop broadcasting at a few hundred participants, so only
 * the latest MAX_POINTS points are sent raw. Every point is counted in a
 * fixed GRID_SIZE x GRID_SIZE density grid.
 */
final class PointCloud
{
    /** Raw points kept for the scatter / pin overlay (the most recent ones). */
    public const MAX_POINTS = 150;

    /** Density grid cells per axis; each cell spans 100 / GRID_SIZE percent. */
    public const GRID_SIZE = 20;

    /**
     * The last MAX_POINTS points, in the order given.
     *
     * @param  list<array{x: float, y: float}>  $points
     * @return list<array{x: float, y: float}>
     */
    public static function latest(array $points): array
    {
        return array_slice($points, -self::MAX_POINTS);
    }

    /**
     * Point counts per cell: counts[row][col] counts the points with
     * row * cell <= y < (row + 1) * cell and col * cell <= x < (col + 1) * cell,
     * where cell = 100 / size (100 falls in the last cell). Rows follow the y
     * value, not the screen: matrix_2x2 draws y upwards, pin_on_image downwards.
     *
     * @param  list<array{x: float, y: float}>  $points
     * @return array{size: int, counts: list<list<int>>}
     */
    public static function density(array $points): array
    {
        $counts = array_fill(0, self::GRID_SIZE, array_fill(0, self::GRID_SIZE, 0));

        foreach ($points as $point) {
            $counts[self::cell($point['y'])][self::cell($point['x'])]++;
        }

        return ['size' => self::GRID_SIZE, 'counts' => $counts];
    }

    /** True for a stored coordinate pair that lies on the 0..100 plane. */
    public static function onPlane(mixed $x, mixed $y): bool
    {
        return is_numeric($x) && is_numeric($y)
            && $x >= 0 && $x <= 100
            && $y >= 0 && $y <= 100;
    }

    private static function cell(float $value): int
    {
        return max(0, min(self::GRID_SIZE - 1, (int) floor($value * self::GRID_SIZE / 100)));
    }
}
