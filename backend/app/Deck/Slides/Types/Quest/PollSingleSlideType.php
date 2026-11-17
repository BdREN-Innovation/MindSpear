<?php

namespace App\Deck\Slides\Types\Quest;

use App\Deck\Slides\AbstractSlideType;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * Multiple choice, one answer (unscored; same data shape as Quiz pick_answer_single).
 *
 * Config:  {result_layout: 'bars'|'donut'|'pie'|'dots' (presenter chart only),
 *           submit_mode: 'instant'|'confirm' (§7.3: tap submits, or tap then a
 *           confirm button; default instant),
 *           show_results_to_participants: bool (see PollSettings; default false)}
 * Options: the choices; 2 empty ones seeded.
 *
 * Answer payload (in):     {option_id: int} — must be an option of the run.
 * Answer payload (stored): {option_id: int}
 *
 * Aggregate:
 *   {total_responses: int, total_votes: int,
 *    options: [{option_id, count, percentage (0..100, 2 dp)}, ...]} in option order.
 *   percentage = count / total_votes * 100 (0 when no votes). Votes for option
 *   ids missing from the snapshot are ignored.
 */
class PollSingleSlideType extends AbstractSlideType
{
    public const KEY = 'poll_single';

    public const RESULT_LAYOUTS = ['bars', 'donut', 'pie', 'dots'];

    public const SUBMIT_MODES = ['instant', 'confirm'];

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
        return ['result_layout' => 'bars', 'submit_mode' => 'instant', ...PollSettings::defaults()];
    }

    public function defaultOptions(): array
    {
        return array_fill(0, 2, ['label' => null, 'payload' => []]);
    }

    public function validateConfig(array $config): array
    {
        $config = array_replace($this->defaultConfig(), $config);

        Validator::make($config, [
            'result_layout' => ['required', 'string', Rule::in(self::RESULT_LAYOUTS)],
            'submit_mode' => ['required', 'string', Rule::in(self::SUBMIT_MODES)],
            ...PollSettings::rules(),
        ])->validate();

        return [
            'result_layout' => $config['result_layout'],
            'submit_mode' => $config['submit_mode'],
            ...PollSettings::normalise($config),
        ];
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        Validator::make($payload, [
            'option_id' => ['required', 'integer', Rule::in(PollOptions::ids($options))],
        ])->validate();

        return ['option_id' => (int) $payload['option_id']];
    }

    public function aggregate(array $config, array $options, Collection $answers): array
    {
        $counts = array_fill_keys(PollOptions::ids($options), 0);

        foreach ($answers as $answer) {
            $id = $answer->answer_payload['option_id'] ?? null;
            if (is_numeric($id) && isset($counts[(int) $id])) {
                $counts[(int) $id]++;
            }
        }

        $totalVotes = array_sum($counts);

        return [
            'total_responses' => $answers->count(),
            'total_votes' => $totalVotes,
            'options' => PollOptions::counted($counts, $totalVotes),
        ];
    }
}
