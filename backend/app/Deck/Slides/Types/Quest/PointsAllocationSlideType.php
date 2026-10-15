<?php

namespace App\Deck\Slides\Types\Quest;

use App\Deck\Slides\AbstractSlideType;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Distribute a fixed budget of points (default 100) across the options.
 *
 * Config:  {total_points: int (1..1000), show_results_to_participants: bool (PollSettings, default false)}
 * Options: slide options are the things points go to (3 empty ones seeded).
 *
 * Answer payload (in):
 *   {allocations: [{option_id: int, points: int >= 0}, ...]}
 *   Option ids must belong to the run, appear at most once, and the points must
 *   add up to exactly config.total_points. Options left out count as 0.
 * Answer payload (stored, normalised):
 *   {allocations: [{option_id, points}, ...]} with every option, in option order.
 *
 * Aggregate:
 *   {total_responses: int, total_points: int (config), total_points_distributed: int,
 *    options: [{option_id, points, percentage (0..100, 2 dp), average_points (2 dp)}, ...]}
 *   percentage = sum(points for option) / total_points_distributed * 100 (0 when nothing distributed);
 *   average_points = sum(points for option) / total_responses (0 when no responses).
 */
class PointsAllocationSlideType extends AbstractSlideType
{
    public const KEY = 'points_allocation';

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
        return ['total_points' => 100, ...PollSettings::defaults()];
    }

    public function defaultOptions(): array
    {
        return array_fill(0, 3, ['label' => null, 'payload' => []]);
    }

    public function validateConfig(array $config): array
    {
        $config = array_replace($this->defaultConfig(), $config);

        Validator::make($config, [
            'total_points' => ['required', 'integer', 'min:1', 'max:1000'],
            ...PollSettings::rules(),
        ])->validate();

        return ['total_points' => (int) $config['total_points'], ...PollSettings::normalise($config)];
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        $optionIds = array_map('intval', array_column($options, 'id'));
        $total = (int) ($config['total_points'] ?? $this->defaultConfig()['total_points']);
        $maxItems = count($optionIds);

        // Reject an oversized list before the wildcard rules expand it: the
        // validator's `*` expansion and `distinct` slow down quadratically
        // with length, and a valid answer never has more entries than options.
        $allocations = $payload['allocations'] ?? null;
        if (is_array($allocations) && count($allocations) > $maxItems) {
            throw ValidationException::withMessages([
                'allocations' => "The allocations field must not have more than {$maxItems} items.",
            ]);
        }

        Validator::make(['allocations' => $allocations], [
            'allocations' => ['required', 'array', 'list', 'min:1', "max:{$maxItems}"],
            'allocations.*' => ['required', 'array'],
            'allocations.*.option_id' => ['required', 'integer', 'distinct', Rule::in($optionIds)],
            'allocations.*.points' => ['required', 'integer', 'min:0', "max:{$total}"],
        ])->validate();

        $byOption = [];
        foreach ($allocations as $allocation) {
            $byOption[(int) $allocation['option_id']] = (int) $allocation['points'];
        }

        $sum = array_sum($byOption);
        if ($sum !== $total) {
            throw ValidationException::withMessages([
                'allocations' => "Points must add up to exactly {$total} (got {$sum}).",
            ]);
        }

        return [
            'allocations' => array_map(
                fn (int $id) => ['option_id' => $id, 'points' => $byOption[$id] ?? 0],
                $optionIds,
            ),
        ];
    }

    public function aggregate(array $config, array $options, Collection $answers): array
    {
        $sums = array_fill_keys(array_map('intval', array_column($options, 'id')), 0);

        foreach ($answers as $answer) {
            foreach ($answer->answer_payload['allocations'] ?? [] as $allocation) {
                $id = (int) ($allocation['option_id'] ?? 0);
                // Ignore ids no longer in the snapshot rather than inventing rows.
                if (array_key_exists($id, $sums)) {
                    $sums[$id] += max(0, (int) ($allocation['points'] ?? 0));
                }
            }
        }

        $responses = $answers->count();
        $distributed = array_sum($sums);

        $rows = [];
        foreach ($sums as $id => $points) {
            $rows[] = [
                'option_id' => $id,
                'points' => $points,
                'percentage' => $distributed > 0 ? round($points / $distributed * 100, 2) : 0.0,
                'average_points' => $responses > 0 ? round($points / $responses, 2) : 0.0,
            ];
        }

        return [
            'total_responses' => $responses,
            'total_points' => (int) ($config['total_points'] ?? $this->defaultConfig()['total_points']),
            'total_points_distributed' => $distributed,
            'options' => $rows,
        ];
    }
}
