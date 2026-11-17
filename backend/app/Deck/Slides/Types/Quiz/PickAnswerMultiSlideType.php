<?php

namespace App\Deck\Slides\Types\Quiz;

use App\Deck\Slides\Types\Quest\PollOptions;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Pick answer, several choices (scored). RETIRED: Pick answer
 * (pick_answer_single) now takes one or several correct answers, so new and
 * edited slides use it (replacedBy(); SlideInput resolves this key to it and
 * a migration converted the stored slides). Kept registered so session runs
 * snapshotted as pick_answer_multi still take answers, score and aggregate.
 *
 * Config:  {} (the session snapshot adds `scoring`). A `partial_credit` key
 *          left by older slides is accepted and dropped.
 * Options: the choices (2–10), label and/or image; 3 empty ones seeded. The
 *          correct ones: slide_options.is_correct (QuizOptions::isCorrect).
 * Slide defaults: 30 s, 50/100 points, speed bonus on.
 *
 * Answer payload (in):     {option_ids: list<int>} — 1..n distinct option ids of the run.
 * Answer payload (stored): {option_ids: list<int>} in option order.
 *
 * Score (plan "Scoring model", all or nothing — user decision 2026-10-17):
 *   the selected set equals the correct set exactly = full (time-weighted)
 *   points, isCorrect true, credit 1; anything else (a subset, a superset
 *   such as selecting every option, no overlap) = 0, isCorrect false,
 *   credit 0. No option marked correct: always 0.
 *
 * Aggregate (+ AbstractQuizType fields; partially_correct_responses is always 0):
 *   {options: [{option_id, count, percentage (share of responses that picked it, 2 dp), is_correct}, ...]
 *    in option order, correct: {option_ids: list<int>}}
 */
class PickAnswerMultiSlideType extends AbstractQuizType
{
    public const KEY = 'pick_answer_multi';

    public const DEFAULT_TIME_LIMIT = 30;

    public function key(): string
    {
        return self::KEY;
    }

    /** The type authoring uses instead of this one (optional SlideInput hook). */
    public function replacedBy(): string
    {
        return PickAnswerSingleSlideType::KEY;
    }

    public function defaultOptions(): array
    {
        return array_fill(0, 3, ['label' => null, 'payload' => []]);
    }

    /** No settings; anything sent (e.g. a legacy partial_credit) is dropped, never a 422. */
    public function validateConfig(array $config): array
    {
        return [];
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        $ids = QuizOptions::ids($options);
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

    protected function answerKey(array $config, array $options): array
    {
        return [
            'ids' => QuizOptions::ids($options),
            'correct' => array_flip(QuizOptions::correctIds($options)),
        ];
    }

    protected function judge(array $payload, array $key): ?Evaluation
    {
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

    /** @return array<int, true>|null distinct selected ids as keys; null when the payload has no id list */
    private static function selected(array $payload): ?array
    {
        $ids = $payload['option_ids'] ?? null;
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
