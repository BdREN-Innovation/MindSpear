<?php

namespace App\Deck\Slides\Types\Quiz;

use App\Deck\Slides\Types\Quest\PollOptions;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Pick answer (scored): one or several correct answers. Also stands in for
 * the retired pick_answer_multi (PickAnswerMultiSlideType::replacedBy()).
 * Same option shape as Quest poll_single.
 *
 * Config:  {} (no type settings; anything sent, e.g. a legacy
 *          partial_credit, is dropped; the session snapshot adds `scoring`).
 * Options: the choices (2–10), label and/or image (image_file_id); 2 empty
 *          ones seeded. The correct one(s): slide_options.is_correct (see
 *          QuizOptions::isCorrect).
 * Slide defaults: 20 s, 50/100 points, speed bonus on.
 *
 * How players answer depends on how many options are marked correct
 * (multipleAnswers(), from the run's options_snapshot):
 *   - one (or none): pick one option, instant submit.
 *     Answer payload (in / stored): {option_id: int} — an option of the run.
 *     A one-item {option_ids: [id]} is accepted and stored as {option_id}.
 *   - several: select options, then submit.
 *     Answer payload (in): {option_ids: list<int>} — 1..n distinct option ids
 *     (a lone {option_id} counts as a one-item list).
 *     Answer payload (stored): {option_ids: list<int>} in option order.
 * Participant / presenter views add config.multiple_answers (bool) so phones
 * know which of the two to show; nothing else about the key is public.
 *
 * Score (all or nothing):
 *   {option_id}: full points when that option is correct (with several
 *     marked, runs from before multiple_answers existed took any of them).
 *   {option_ids}: full points only when the selection is exactly the correct
 *     set; a subset, a superset or no overlap scores 0. Nothing marked
 *     correct: always 0.
 *
 * Aggregate (+ AbstractQuizType fields; partially_correct_responses is always 0):
 *   {options: [{option_id, count, percentage (share of responses that picked it, 2 dp), is_correct}, ...]
 *    in option order, correct: {option_ids: list<int>}}
 */
class PickAnswerSingleSlideType extends AbstractQuizType
{
    public const KEY = 'pick_answer_single';

    public const DEFAULT_TIME_LIMIT = 20;

    public function key(): string
    {
        return self::KEY;
    }

    public function defaultOptions(): array
    {
        return array_fill(0, 2, ['label' => null, 'payload' => []]);
    }

    public function validateConfig(array $config): array
    {
        return [];
    }

    /** Players select several options (and must match every correct one): more than one is marked correct. */
    public function multipleAnswers(array $options): bool
    {
        return count(QuizOptions::correctIds($options)) > 1;
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        $ids = QuizOptions::ids($options);

        if (! $this->multipleAnswers($options)) {
            $list = $payload['option_ids'] ?? null;
            if (! array_key_exists('option_id', $payload) && is_array($list) && array_is_list($list) && count($list) === 1) {
                $payload = ['option_id' => $list[0]];
            }

            Validator::make($payload, [
                'option_id' => ['required', 'integer', Rule::in($ids)],
            ])->validate();

            return ['option_id' => (int) $payload['option_id']];
        }

        if (! array_key_exists('option_ids', $payload) && array_key_exists('option_id', $payload)) {
            $payload = ['option_ids' => [$payload['option_id']]];
        }

        PollOptions::assertListAtMost($payload, 'option_ids', count($ids));

        Validator::make($payload, [
            'option_ids' => ['required', 'array', 'list', 'min:1'],
            'option_ids.*' => ['required', 'integer', 'distinct', Rule::in($ids)],
        ])->validate();

        if ($ids === []) {
            throw ValidationException::withMessages(['option_ids' => 'This slide has no options.']);
        }

        return ['option_ids' => array_values(array_intersect($ids, array_map('intval', $payload['option_ids'])))];
    }

    public function correctAnswer(array $config, array $options): array
    {
        return ['option_ids' => QuizOptions::correctIds($options)];
    }

    public function serializeForViewer(DeckSessionSlideRun $run, ?int $participantId, bool $hideUntilVoting = true): array
    {
        $view = parent::serializeForViewer($run, $participantId, $hideUntilVoting);
        $view['config']['multiple_answers'] = $this->multipleAnswers($run->options_snapshot ?? []);

        return $view;
    }

    protected function answerKey(array $config, array $options): array
    {
        return [
            'ids' => QuizOptions::ids($options),
            'correct' => array_flip(QuizOptions::correctIds($options)),
        ];
    }

    protected function judge(array $payload, array $key): ?Evaluation
    {
        if (array_key_exists('option_ids', $payload)) {
            $selected = self::selected($payload);
            if ($selected === null) {
                return null;
            }

            $total = count($key['correct']);
            $exact = $total > 0
                && count($selected) === $total
                && count(array_intersect_key($selected, $key['correct'])) === $total;

            return $exact ? Evaluation::right() : Evaluation::wrong();
        }

        $id = $payload['option_id'] ?? null;

        if (! is_int($id) && ! (is_string($id) && ctype_digit($id))) {
            return null;
        }

        return isset($key['correct'][(int) $id]) ? Evaluation::right() : Evaluation::wrong();
    }

    protected function breakdown(array $config, array $options, array $key, array $payloads): array
    {
        $counts = array_fill_keys($key['ids'], 0);
        foreach ($payloads as $payload) {
            foreach (array_keys(self::selected($payload) ?? []) as $id) {
                if (isset($counts[$id])) {
                    $counts[$id]++;
                }
            }
        }

        return ['options' => QuizOptions::countRows($counts, $key['correct'], count($payloads))];
    }

    protected function presenterOption(array $row, array $option): array
    {
        return parent::presenterOption($row, $option) + ['is_correct' => QuizOptions::isCorrect($option)];
    }

    /**
     * The option ids a payload picked, as keys: {option_ids} distinct, or
     * {option_id} as a one-item set; null when it has neither.
     *
     * @return array<int, true>|null
     */
    private static function selected(array $payload): ?array
    {
        $ids = $payload['option_ids'] ?? (array_key_exists('option_id', $payload) ? [$payload['option_id']] : null);
        if (! is_array($ids)) {
            return null;
        }

        $selected = [];
        foreach ($ids as $id) {
            if (is_int($id) || (is_string($id) && ctype_digit($id))) {
                $selected[(int) $id] = true;
            }
        }

        return $selected;
    }
}
