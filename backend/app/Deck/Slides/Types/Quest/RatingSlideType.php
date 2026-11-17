<?php

namespace App\Deck\Slides\Types\Quest;

use App\Deck\Slides\AbstractSlideType;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Star rating of several items (the slide options are the items).
 *
 * Config:  {scale: 3|5|7|10 (stars), require_all_items: bool,
 *          show_results_to_participants: bool (PollSettings, default false)}
 * Options: 3 empty items seeded.
 *
 * Answer payload (in):
 *   {ratings: [{option_id: int, value: int 1..scale}, ...]}
 *   At least one item; each option id belongs to the run and appears at most
 *   once; with require_all_items every item must be rated.
 * Answer payload (stored, normalised):
 *   {ratings: [{option_id, value}, ...]} rated items only, in option order.
 *
 * Aggregate:
 *   {total_responses: int, scale: int,
 *    items: [{option_id, count, mean (2 dp, null when count = 0),
 *             distribution: [{value: 1, count}, ..., {value: scale, count}]}, ...]}
 *   Values outside 1..scale (e.g. the author lowered the scale) are ignored.
 */
class RatingSlideType extends AbstractSlideType
{
    public const KEY = 'rating';

    public const SCALES = [3, 5, 7, 10];

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
        return ['scale' => 5, 'require_all_items' => false, ...PollSettings::defaults()];
    }

    public function defaultOptions(): array
    {
        return array_fill(0, 3, ['label' => null, 'payload' => []]);
    }

    public function validateConfig(array $config): array
    {
        $config = array_replace($this->defaultConfig(), $config);

        Validator::make($config, [
            'scale' => ['required', 'integer', Rule::in(self::SCALES)],
            'require_all_items' => ['required', 'boolean'],
            ...PollSettings::rules(),
        ])->validate();

        return [
            'scale' => (int) $config['scale'],
            'require_all_items' => (bool) $config['require_all_items'],
            ...PollSettings::normalise($config),
        ];
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        $optionIds = array_map('intval', array_column($options, 'id'));
        $scale = $this->scale($config);
        $maxItems = count($optionIds);

        // Reject an oversized list before the wildcard rules expand it: the
        // validator's `*` expansion and `distinct` slow down quadratically
        // with length, and a valid answer never rates more items than exist.
        $ratings = $payload['ratings'] ?? null;
        if (is_array($ratings) && count($ratings) > $maxItems) {
            throw ValidationException::withMessages([
                'ratings' => "The ratings field must not have more than {$maxItems} items.",
            ]);
        }

        Validator::make(['ratings' => $ratings], [
            'ratings' => ['required', 'array', 'list', 'min:1', "max:{$maxItems}"],
            'ratings.*' => ['required', 'array'],
            'ratings.*.option_id' => ['required', 'integer', 'distinct', Rule::in($optionIds)],
            'ratings.*.value' => ['required', 'integer', 'min:1', "max:{$scale}"],
        ])->validate();

        $byOption = [];
        foreach ($ratings as $rating) {
            $byOption[(int) $rating['option_id']] = (int) $rating['value'];
        }

        if (($config['require_all_items'] ?? false) && count($byOption) !== count($optionIds)) {
            throw ValidationException::withMessages(['ratings' => 'Every item must be rated.']);
        }

        $ratings = [];
        foreach ($optionIds as $id) {
            if (isset($byOption[$id])) {
                $ratings[] = ['option_id' => $id, 'value' => $byOption[$id]];
            }
        }

        return ['ratings' => $ratings];
    }

    public function aggregate(array $config, array $options, Collection $answers): array
    {
        $scale = $this->scale($config);
        $histograms = array_fill_keys(
            array_map('intval', array_column($options, 'id')),
            array_fill(1, $scale, 0),
        );

        foreach ($answers as $answer) {
            foreach ($answer->answer_payload['ratings'] ?? [] as $rating) {
                $id = (int) ($rating['option_id'] ?? 0);
                $value = (int) ($rating['value'] ?? 0);
                if (isset($histograms[$id][$value])) {
                    $histograms[$id][$value]++;
                }
            }
        }

        $items = [];
        foreach ($histograms as $id => $histogram) {
            $count = array_sum($histogram);
            $total = 0;
            $distribution = [];
            foreach ($histogram as $value => $n) {
                $total += $value * $n;
                $distribution[] = ['value' => $value, 'count' => $n];
            }

            $items[] = [
                'option_id' => $id,
                'count' => $count,
                'mean' => $count > 0 ? round($total / $count, 2) : null,
                'distribution' => $distribution,
            ];
        }

        return [
            'total_responses' => $answers->count(),
            'scale' => $scale,
            'items' => $items,
        ];
    }

    private function scale(array $config): int
    {
        $scale = (int) ($config['scale'] ?? $this->defaultConfig()['scale']);

        return $scale >= 1 ? $scale : $this->defaultConfig()['scale'];
    }
}
