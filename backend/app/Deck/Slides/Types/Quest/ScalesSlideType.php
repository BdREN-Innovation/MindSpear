<?php

namespace App\Deck\Slides\Types\Quest;

use App\Deck\Slides\AbstractSlideType;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Scales: one Likert value per statement (the slide options are the statements).
 * The answer payload is the same as `rating`'s, and each aggregate statement
 * has the same shape as a `rating` aggregate item ({option_id, count, mean,
 * distribution}). The top-level aggregate keys differ: scales uses
 * scale_points/statements where rating uses scale/items.
 *
 * Config:  {scale_points: int 2..10,
 *           scale_labels: list<?string> exactly scale_points long (label per value 1..N; max 60 chars),
 *           require_all_statements: bool,
 *           show_results_to_participants: bool (see PollSettings; default false)}
 *   Changing scale_points without sending scale_labels keeps the two end labels
 *   and blanks the middle ones.
 * Options: 3 empty statements seeded.
 *
 * Answer payload (in):
 *   {ratings: [{option_id: int, value: int 1..scale_points}, ...]}
 *   At least one statement; ids belong to the run and appear at most once; with
 *   require_all_statements every statement must be answered.
 * Answer payload (stored): {ratings: [{option_id, value}, ...]} answered statements, in option order.
 *
 * Aggregate:
 *   {total_responses: int, scale_points: int,
 *    statements: [{option_id, count, mean (2 dp, null when count = 0),
 *                  distribution: [{value: 1, count}, ..., {value: scale_points, count}]}, ...]}
 *   in option order. Values outside 1..scale_points are ignored.
 */
class ScalesSlideType extends AbstractSlideType
{
    public const KEY = 'scales';

    public const DEFAULT_LABELS = ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'];

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
            'scale_points' => 5,
            'scale_labels' => self::DEFAULT_LABELS,
            'require_all_statements' => false,
            ...PollSettings::defaults(),
        ];
    }

    public function defaultOptions(): array
    {
        return array_fill(0, 3, ['label' => null, 'payload' => []]);
    }

    public function validateConfig(array $config): array
    {
        $resizeLabels = array_key_exists('scale_points', $config) && ! array_key_exists('scale_labels', $config);
        $config = array_replace($this->defaultConfig(), $config);

        Validator::make($config, [
            'scale_points' => ['required', 'integer', 'min:2', 'max:10'],
            'scale_labels' => ['present', 'array', 'list'],
            'scale_labels.*' => ['nullable', 'string', 'max:60'],
            'require_all_statements' => ['required', 'boolean'],
            ...PollSettings::rules(),
        ])->validate();

        $points = (int) $config['scale_points'];
        $labels = $resizeLabels ? $this->resizeLabels($config['scale_labels'], $points) : $config['scale_labels'];

        if (count($labels) !== $points) {
            throw ValidationException::withMessages([
                'scale_labels' => "Provide exactly {$points} scale labels (null for an unlabelled point).",
            ]);
        }

        return [
            'scale_points' => $points,
            'scale_labels' => array_map(fn ($label) => $label === null || trim($label) === '' ? null : trim($label), $labels),
            'require_all_statements' => (bool) $config['require_all_statements'],
            ...PollSettings::normalise($config),
        ];
    }

    /**
     * Optional authoring hook (Phase 2, SlideInput::config()): $incoming onto
     * the stored config. When only scale_points changes, the stored
     * scale_labels are resized (end labels kept, middle ones blank) instead of
     * failing on a stale label count. validateConfig() still checks the result.
     */
    public function mergeConfig(array $stored, array $incoming): array
    {
        $points = $incoming['scale_points'] ?? null;
        $points = is_string($points) && ctype_digit($points) ? (int) $points : $points;

        if (is_int($points) && $points >= 2 && $points <= 10 && ! array_key_exists('scale_labels', $incoming)
            && is_array($stored['scale_labels'] ?? null)) {
            $incoming['scale_labels'] = $this->resizeLabels($stored['scale_labels'], $points);
        }

        return array_replace($stored, $incoming);
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        $ids = PollOptions::ids($options);
        $points = $this->points($config);
        PollOptions::assertListAtMost($payload, 'ratings', count($ids));

        Validator::make($payload, [
            'ratings' => ['required', 'array', 'list', 'min:1'],
            'ratings.*' => ['required', 'array'],
            'ratings.*.option_id' => ['required', 'integer', 'distinct', Rule::in($ids)],
            'ratings.*.value' => ['required', 'integer', 'min:1', "max:{$points}"],
        ])->validate();

        $byOption = [];
        foreach ($payload['ratings'] as $rating) {
            $byOption[(int) $rating['option_id']] = (int) $rating['value'];
        }

        if (($config['require_all_statements'] ?? false) && count($byOption) !== count($ids)) {
            throw ValidationException::withMessages(['ratings' => 'Every statement must be answered.']);
        }

        $ratings = [];
        foreach ($ids as $id) {
            if (isset($byOption[$id])) {
                $ratings[] = ['option_id' => $id, 'value' => $byOption[$id]];
            }
        }

        return ['ratings' => $ratings];
    }

    public function aggregate(array $config, array $options, Collection $answers): array
    {
        $points = $this->points($config);
        $histograms = array_fill_keys(PollOptions::ids($options), array_fill(1, $points, 0));

        foreach ($answers as $answer) {
            $ratings = $answer->answer_payload['ratings'] ?? null;
            if (! is_array($ratings)) {
                continue;
            }

            foreach ($ratings as $rating) {
                $id = (int) ($rating['option_id'] ?? 0);
                $value = (int) ($rating['value'] ?? 0);
                if (isset($histograms[$id][$value])) {
                    $histograms[$id][$value]++;
                }
            }
        }

        $statements = [];
        foreach ($histograms as $id => $histogram) {
            $count = array_sum($histogram);
            $sum = 0;
            $distribution = [];
            foreach ($histogram as $value => $n) {
                $sum += $value * $n;
                $distribution[] = ['value' => $value, 'count' => $n];
            }

            $statements[] = [
                'option_id' => $id,
                'count' => $count,
                'mean' => $count > 0 ? round($sum / $count, 2) : null,
                'distribution' => $distribution,
            ];
        }

        return [
            'total_responses' => $answers->count(),
            'scale_points' => $points,
            'statements' => $statements,
        ];
    }

    private function points(array $config): int
    {
        $points = (int) ($config['scale_points'] ?? $this->defaultConfig()['scale_points']);

        return $points >= 2 ? $points : $this->defaultConfig()['scale_points'];
    }

    /** Keep the end labels, blank the rest. */
    private function resizeLabels(array $labels, int $points): array
    {
        $labels = array_values($labels);
        if (count($labels) === $points) {
            return $labels;
        }

        $resized = array_fill(0, $points, null);
        $resized[0] = $labels[0] ?? null;
        $resized[$points - 1] = $labels[count($labels) - 1] ?? null;

        return $resized;
    }
}
