<?php

namespace App\Deck\Slides\Types\Quest;

use App\Deck\Slides\AbstractSlideType;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Validator;

/**
 * 2x2 matrix: each participant drags one dot onto a 2D plane.
 *
 * Config:  {x_axis: {low: string, high: string}, y_axis: {low: string, high: string},
 *          show_results_to_participants: bool (PollSettings, default false)}
 *          Labels are at most 80 chars; null is normalised to ''.
 *
 * Coordinates are percentages of the plane (0..100, the same unit as
 * pin_on_image; plan §3.7): x 0 = x_axis.low (left), x 100 = x_axis.high
 * (right); y 0 = y_axis.low (bottom), y 100 = y_axis.high (top).
 *
 * Answer payload (in):     {x: number 0..100, y: number 0..100}
 * Answer payload (stored): {x: float, y: float} rounded to 2 dp.
 *
 * Aggregate (bounded, see PointCloud):
 *   {total_responses: int, total_points: int,
 *    points: [{x, y}, ...] (the latest PointCloud::MAX_POINTS, answer order),
 *    density: {size: 20, counts: [[int x 20] x 20]} (every point; counts[row by y][col by x]),
 *    centroid: {x, y} (2 dp, over every point) | null}
 *   Points carry no participant data: the aggregate goes out on the public channel.
 */
class Matrix2x2SlideType extends AbstractSlideType
{
    public const KEY = 'matrix_2x2';

    private const LABEL_MAX = 80;

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

    public function defaultConfig(): array
    {
        return [
            'x_axis' => ['low' => '', 'high' => ''],
            'y_axis' => ['low' => '', 'high' => ''],
            ...PollSettings::defaults(),
        ];
    }

    public function validateConfig(array $config): array
    {
        $defaults = $this->defaultConfig();
        $config = array_replace($defaults, $config);

        // Fill in a missing label of a partially-sent axis.
        foreach (['x_axis', 'y_axis'] as $axis) {
            if (is_array($config[$axis])) {
                $config[$axis] = array_replace($defaults[$axis], $config[$axis]);
            }
        }

        $max = self::LABEL_MAX;
        Validator::make($config, [
            'x_axis' => ['required', 'array'],
            'x_axis.low' => ['nullable', 'string', "max:{$max}"],
            'x_axis.high' => ['nullable', 'string', "max:{$max}"],
            'y_axis' => ['required', 'array'],
            'y_axis.low' => ['nullable', 'string', "max:{$max}"],
            'y_axis.high' => ['nullable', 'string', "max:{$max}"],
            ...PollSettings::rules(),
        ])->validate();

        return [
            'x_axis' => ['low' => (string) $config['x_axis']['low'], 'high' => (string) $config['x_axis']['high']],
            'y_axis' => ['low' => (string) $config['y_axis']['low'], 'high' => (string) $config['y_axis']['high']],
            ...PollSettings::normalise($config),
        ];
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        Validator::make($payload, [
            'x' => ['required', 'numeric', 'between:0,100'],
            'y' => ['required', 'numeric', 'between:0,100'],
        ])->validate();

        return [
            'x' => round((float) $payload['x'], 2),
            'y' => round((float) $payload['y'], 2),
        ];
    }

    public function aggregate(array $config, array $options, Collection $answers): array
    {
        $points = [];
        foreach ($answers as $answer) {
            $payload = $answer->answer_payload ?? [];
            if (! PointCloud::onPlane($payload['x'] ?? null, $payload['y'] ?? null)) {
                continue;
            }

            $points[] = ['x' => (float) $payload['x'], 'y' => (float) $payload['y']];
        }

        $count = count($points);

        return [
            'total_responses' => $answers->count(),
            'total_points' => $count,
            'points' => PointCloud::latest($points),
            'density' => PointCloud::density($points),
            'centroid' => $count > 0 ? [
                'x' => round(array_sum(array_column($points, 'x')) / $count, 2),
                'y' => round(array_sum(array_column($points, 'y')) / $count, 2),
            ] : null,
        ];
    }
}
