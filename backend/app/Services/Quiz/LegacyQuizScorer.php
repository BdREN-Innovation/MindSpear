<?php

namespace App\Services\Quiz;

use App\Models\Quiz\QuizParticipant;

/**
 * Scores a classic (legacy) quiz attempt. Shared by the attempt API (a player finishing) and
 * by ending a live session, which scores every attempt still in progress.
 */
class LegacyQuizScorer
{
    /**
     * Sets the attempt's end time and score from its answers (not saved).
     */
    public function complete(QuizParticipant $attempt): void
    {
        $attempt->loadMissing('userQuizAnswers.question');
        $attempt->end_time = now();
        $score = 0;

        foreach ($attempt->userQuizAnswers as $answer) {
            $question = $answer->question;

            if (! $question || ! in_array($question->question_type, [
                'multiple_choice',
                'true_false',
                'single_choice',
                'quiz_single_choice',
                'quiz_multiple_choice',
                'true_false_choice',
                'fill_in_the_blanks_choice',
                'fill_in_the_blanks_multiple_choice',
                'sort_answer_choice',
                'sort_answer',
                'short_answer_choice',
                'short_answer',
            ])) {
                continue;
            }

            $answerData = $answer->answer_data;
            $points = $question->points ?? 0;

            if (in_array($question->question_type, ['multiple_choice', 'single_choice', 'quiz_single_choice', 'quiz_multiple_choice', 'fill_in_the_blanks_multiple_choice', 'fill_in_the_blanks_choice', 'true_false_choice'])) {
                $correctIndex = $question->options['correct_answer'] ?? null;
                $selectedOption = $answerData['selected_option'] ?? null;

                // Multiple answers are all-or-nothing: the points only for exactly the
                // correct set, so ticking every option no longer earns anything.
                if (in_array($question->question_type, ['quiz_multiple_choice', 'fill_in_the_blanks_multiple_choice'], true)) {
                    // The editor stores the correct indexes under "correct_answer".
                    $correct = $question->options['correct_answer'] ?? $question->options['correct_answers'] ?? null;
                    if ($this->sameIndexSet($answerData['selected_option'] ?? null, $correct)) {
                        $score += $points;
                    }
                } else {
                    if ($selectedOption !== null && $correctIndex !== null && $selectedOption == $correctIndex) {
                        $score += $points;
                    }
                }
            } elseif ($question->question_type === 'true_false') {
                $correctAnswer = $question->options['correct_answer'] ?? null;
                $selectedAnswer = $answerData['selected_option'] ?? null;

                if ($selectedAnswer !== null && $correctAnswer !== null) {
                    $userAnswer = filter_var($selectedAnswer, FILTER_VALIDATE_BOOLEAN);
                    if ($userAnswer === $correctAnswer) {
                        $score += $points;
                    }
                }
            } elseif ($question->question_type === 'sort_answer_choice' || $question->question_type === 'sort_answer' || $question->question_type === 'short_answer_choice' || $question->question_type === 'short_answer') {
                if ($this->shortAnswerMatches($answerData['selected_option'] ?? null, $question->options)) {
                    $score += $points;
                }
            }
        }

        $attempt->score = $score;
    }

    /**
     * A typed answer is right when every comma-separated part is one of the accepted answers,
     * ignoring case and surrounding spaces ("paris" matches "Paris").
     */
    public function shortAnswerMatches($selected, ?array $options): bool
    {
        $accepted = collect((array) ($options['correct_answer'] ?? []))
            ->map(fn ($index) => $options['choices'][$index] ?? null)
            ->filter(fn ($choice) => is_string($choice) && trim($choice) !== '')
            ->map(fn (string $choice) => mb_strtolower(trim($choice)));
        $typed = collect(is_array($selected) ? $selected : explode(',', (string) $selected))
            ->map(fn ($part) => mb_strtolower(trim((string) $part)))
            ->filter(fn (string $part) => $part !== '');

        return $accepted->isNotEmpty() && $typed->isNotEmpty()
            && $typed->every(fn (string $part) => $accepted->contains($part));
    }

    /**
     * Whether a multiple-answer pick ("0,2" or [0, 2]) is exactly the correct set of indexes.
     */
    public function sameIndexSet($selected, $correct): bool
    {
        $normalise = function ($value): array {
            $items = is_array($value) ? $value : explode(',', (string) $value);
            $items = array_filter(array_map('trim', array_map('strval', $items)), fn ($item) => $item !== '' && is_numeric($item));
            $items = array_values(array_unique(array_map('intval', $items)));
            sort($items);

            return $items;
        };
        if ($selected === null || $correct === null) {
            return false;
        }
        $picked = $normalise($selected);

        return $picked !== [] && $picked === $normalise($correct);
    }
}
