<?php

namespace App\Deck\Slides\Types\Quest;

use App\Deck\Slides\AbstractSlideType;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Ranking: drag the items (the slide options) into order; best first.
 *
 * Config:  {require_full_ranking: bool — true: every item must be ranked;
 *           false: any non-empty prefix of the order (top-k) is accepted,
 *           show_results_to_participants: bool (see PollSettings; default false)}
 * Options: 4 empty items seeded.
 *
 * Answer payload (in):     {order: list<int>} distinct option ids, best first.
 * Answer payload (stored): {order: list<int>}
 *
 * Aggregate:
 *   {total_responses: int, item_count: int,
 *    items: [{option_id, rank: ?int (1 = best; null only when there are no responses),
 *             average_position: ?float (2 dp, 1-based; lower = better),
 *             count: int (participants who placed it explicitly),
 *             position_counts: [{position: 1, count}, ..., {position: item_count, count}]}, ...]}
 *   average_position = sum(position) / total_responses: every response counts
 *   for every item. An item a participant left out of a top-k ranking takes the
 *   mean of the slots they left open ((k + 1 + item_count) / 2), so an item one
 *   person put first cannot outrank one nearly everyone ranked second.
 *   position_counts only count explicit placements. Items are sorted by
 *   average_position asc, then option order. Items sharing an average share a
 *   rank (1, 2, 2, 4).
 */
class RankingSlideType extends AbstractSlideType
{
    public const KEY = 'ranking';

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
        return ['require_full_ranking' => true, ...PollSettings::defaults()];
    }

    public function defaultOptions(): array
    {
        return array_fill(0, 4, ['label' => null, 'payload' => []]);
    }

    public function validateConfig(array $config): array
    {
        $config = array_replace($this->defaultConfig(), $config);

        Validator::make($config, [
            'require_full_ranking' => ['required', 'boolean'],
            ...PollSettings::rules(),
        ])->validate();

        return [
            'require_full_ranking' => (bool) $config['require_full_ranking'],
            ...PollSettings::normalise($config),
        ];
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        $ids = PollOptions::ids($options);
        PollOptions::assertListAtMost($payload, 'order', count($ids));

        Validator::make($payload, [
            'order' => ['required', 'array', 'list', 'min:1'],
            'order.*' => ['required', 'integer', 'distinct', Rule::in($ids)],
        ])->validate();

        $order = array_map('intval', $payload['order']);

        if (($config['require_full_ranking'] ?? true) && count($order) !== count($ids)) {
            throw ValidationException::withMessages(['order' => 'Rank every item.']);
        }

        return ['order' => $order];
    }

    public function aggregate(array $config, array $options, Collection $answers): array
    {
        $ids = PollOptions::ids($options);
        $itemCount = count($ids);
        $positions = array_fill_keys($ids, $itemCount > 0 ? array_fill(1, $itemCount, 0) : []);
        $sums = array_fill_keys($ids, 0.0);
        $responses = 0;

        foreach ($answers as $answer) {
            $order = $answer->answer_payload['order'] ?? null;
            if (! is_array($order)) {
                continue;
            }

            // Known items only, first mention wins; positions follow this cleaned order.
            $ranked = [];
            foreach ($order as $id) {
                if (is_numeric($id) && isset($positions[(int) $id]) && ! isset($ranked[(int) $id])) {
                    $position = count($ranked) + 1;
                    $ranked[(int) $id] = $position;
                }
            }
            if ($ranked === []) {
                continue;
            }

            $responses++;
            $leftOutPosition = (count($ranked) + 1 + $itemCount) / 2;
            foreach ($ids as $id) {
                if (isset($ranked[$id])) {
                    $positions[$id][$ranked[$id]]++;
                    $sums[$id] += $ranked[$id];
                } else {
                    $sums[$id] += $leftOutPosition;
                }
            }
        }

        $items = [];
        foreach ($ids as $displayIndex => $id) {
            $distribution = [];
            foreach ($positions[$id] as $position => $n) {
                $distribution[] = ['position' => $position, 'count' => $n];
            }

            $items[] = [
                'option_id' => $id,
                'rank' => null,
                'average_position' => $responses > 0 ? round($sums[$id] / $responses, 2) : null,
                'count' => array_sum($positions[$id]),
                'position_counts' => $distribution,
                '_order' => $displayIndex,
            ];
        }

        usort($items, fn (array $a, array $b) => [$a['average_position'] === null, $a['average_position'] ?? 0, $a['_order']]
            <=> [$b['average_position'] === null, $b['average_position'] ?? 0, $b['_order']]);

        $rank = 0;
        $previous = null;
        foreach ($items as $index => &$item) {
            if ($item['average_position'] !== null) {
                if ($item['average_position'] !== $previous) {
                    $rank = $index + 1;
                    $previous = $item['average_position'];
                }
                $item['rank'] = $rank;
            }
            unset($item['_order']);
        }
        unset($item);

        return [
            'total_responses' => $responses,
            'item_count' => $itemCount,
            'items' => $items,
        ];
    }
}
