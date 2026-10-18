<?php

namespace App\Deck\Slides\Types\Quiz;

use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * Pick answer, one choice (scored). Same option shape as Quest poll_single.
 *
 * Config:  {} (no type settings; the session snapshot adds `scoring`).
 * Options: the choices (2–10), label and/or image (image_file_id); 2 empty
 *          ones seeded. The correct one(s): slide_options.is_correct (see
 *          QuizOptions::isCorrect). Several may be marked: picking any of
 *          them is correct.
 * Slide defaults: 20 s, 50/100 points, speed bonus on.
 *
 * Answer payload (in / stored): {option_id: int} — an option of the run.
 *
 * Score: full points when the picked option is correct, else 0.
 *
 * Aggregate (+ AbstractQuizType fields):
 *   {options: [{option_id, count, percentage (of responses, 2 dp), is_correct}, ...]
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

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        Validator::make($payload, [
            'option_id' => ['required', 'integer', Rule::in(QuizOptions::ids($options))],
        ])->validate();

        return ['option_id' => (int) $payload['option_id']];
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
            $id = (int) $payload['option_id'];
            if (isset($counts[$id])) {
                $counts[$id]++;
            }
        }

        return ['options' => QuizOptions::countRows($counts, $key['correct'], count($payloads))];
    }

    protected function presenterOption(array $row, array $option): array
    {
        return parent::presenterOption($row, $option) + ['is_correct' => QuizOptions::isCorrect($option)];
    }
}
