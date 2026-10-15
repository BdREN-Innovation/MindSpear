<?php

namespace App\Deck\Slides\Types\Quest;

use App\Deck\Slides\AbstractSlideType;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Multiple choice, several answers (unscored).
 *
 * Config:  {result_layout: 'bars'|'donut'|'pie'|'dots',
 *           min_selections: int 1..50, max_selections: int|null (min_selections..50; null = no limit),
 *           show_results_to_participants: bool (see PollSettings; default false)}
 *   Both limits are capped at the number of options when answers are checked,
 *   so a deck with fewer options than min_selections still works.
 * Options: the choices; 3 empty ones seeded.
 *
 * Answer payload (in):     {option_ids: list<int>} — distinct option ids of the run,
 *                          count within [min_selections, max_selections].
 * Answer payload (stored): {option_ids: list<int>} in option order.
 *
 * Aggregate:
 *   {total_responses: int (participants), total_votes: int (selections),
 *    average_selections_per_participant: float (2 dp, 0 when no responses),
 *    options: [{option_id, count, percentage (0..100, 2 dp)}, ...]} in option order.
 *   percentage = count / total_responses * 100: the share of participants who
 *   picked the option, so percentages can add up to more than 100.
 */
class PollMultiSlideType extends AbstractSlideType
{
    public const KEY = 'poll_multi';

    public const MAX_SELECTIONS = 50;

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
        return ['result_layout' => 'bars', 'min_selections' => 1, 'max_selections' => null, ...PollSettings::defaults()];
    }

    public function defaultOptions(): array
    {
        return array_fill(0, 3, ['label' => null, 'payload' => []]);
    }

    public function validateConfig(array $config): array
    {
        $config = array_replace($this->defaultConfig(), $config);
        $max = self::MAX_SELECTIONS;

        Validator::make($config, [
            'result_layout' => ['required', 'string', Rule::in(PollSingleSlideType::RESULT_LAYOUTS)],
            'min_selections' => ['required', 'integer', 'min:1', "max:{$max}"],
            'max_selections' => ['nullable', 'integer', 'min:1', "max:{$max}"],
            ...PollSettings::rules(),
        ])->validate();

        $min = (int) $config['min_selections'];
        $maxSelections = $config['max_selections'] === null ? null : (int) $config['max_selections'];

        if ($maxSelections !== null && $maxSelections < $min) {
            throw ValidationException::withMessages([
                'max_selections' => 'The maximum selections must be at least the minimum selections.',
            ]);
        }

        return [
            'result_layout' => $config['result_layout'],
            'min_selections' => $min,
            'max_selections' => $maxSelections,
            ...PollSettings::normalise($config),
        ];
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        $ids = PollOptions::ids($options);
        PollOptions::assertListAtMost($payload, 'option_ids', count($ids));

        Validator::make($payload, [
            'option_ids' => ['required', 'array', 'list', 'min:1'],
            'option_ids.*' => ['required', 'integer', 'distinct', Rule::in($ids)],
        ])->validate();

        [$min, $max] = $this->limits($config, count($ids));
        $selected = array_map('intval', $payload['option_ids']);

        if (count($selected) < $min || count($selected) > $max) {
            throw ValidationException::withMessages([
                'option_ids' => $min === $max
                    ? "Select exactly {$min} options."
                    : "Select between {$min} and {$max} options.",
            ]);
        }

        return ['option_ids' => array_values(array_intersect($ids, $selected))];
    }

    public function aggregate(array $config, array $options, Collection $answers): array
    {
        $counts = array_fill_keys(PollOptions::ids($options), 0);
        $responses = 0;
        $selections = 0;

        foreach ($answers as $answer) {
            $picked = $answer->answer_payload['option_ids'] ?? null;
            if (! is_array($picked)) {
                continue;
            }

            $responses++;
            foreach (array_unique(array_map('intval', array_filter($picked, 'is_numeric'))) as $id) {
                if (isset($counts[$id])) {
                    $counts[$id]++;
                    $selections++;
                }
            }
        }

        return [
            'total_responses' => $responses,
            'total_votes' => $selections,
            'average_selections_per_participant' => $responses > 0 ? round($selections / $responses, 2) : 0.0,
            'options' => PollOptions::counted($counts, $responses),
        ];
    }

    /** @return array{0: int, 1: int} effective [min, max] for this many options */
    private function limits(array $config, int $optionCount): array
    {
        $min = max(1, (int) ($config['min_selections'] ?? 1));
        $max = isset($config['max_selections']) ? (int) $config['max_selections'] : $optionCount;

        $max = max(1, min($max, $optionCount));
        $min = min($min, $max);

        return [$min, $max];
    }
}
