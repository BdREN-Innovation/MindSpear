<?php

namespace App\Deck\Legacy;

/**
 * Turns a legacy v1 answer into something a person can read, and for quiz answers
 * decides right / wrong from the question's correct_answer. Pure.
 *
 * Legacy shapes (production data):
 *  - user_quiz_answers.answer_data: {"selected_option": int | list<int> | list<string>, "start_time", ...}
 *  - questions.options: {"choices": [string|null], "correct_answer": int | list<int> | list<string>}
 *  - quest_task_completions.completion_data: {"selected_option": int | list<int> | list<string>}
 *  - quest_tasks.task_data: {"questions": [{"text"}]}
 */
final class LegacyAnswers
{
    /** Sort questions: the order matters. */
    private const ORDERED = ['sort_answer_choice'];

    private const TEXT_ANSWERS = ['short_answer'];

    /** @return array{text:string, correct:?bool} correct null = can't be judged */
    public static function quiz(object $question, array $answer): array
    {
        $options = self::json($question->options);
        $choices = is_array($options['choices'] ?? null) ? $options['choices'] : [];
        $selected = $answer['selected_option'] ?? null;
        $type = (string) $question->question_type;

        return [
            'text' => self::describe($selected, $choices, in_array($type, self::ORDERED, true) ? ' → ' : ', '),
            'correct' => self::judge($type, $selected, $options['correct_answer'] ?? null, $choices),
        ];
    }

    /** @return array{text:string, correct:null} quests are not scored */
    public static function quest(object $task, array $answer): array
    {
        $data = self::json($task->task_data);
        $items = array_map(fn ($item) => is_array($item) ? ($item['text'] ?? null) : null, is_array($data['questions'] ?? null) ? $data['questions'] : []);
        $selected = $answer['selected_option'] ?? null;

        $text = match ($task->task_type) {
            'ranking' => self::ranked($selected, $items),
            'scales' => self::scaled($selected, $items),
            default => self::describe($selected, $items, ', '),
        };

        return ['text' => $text, 'correct' => null];
    }

    /** The question's right answer as text, or null when it has none. */
    public static function quizCorrectText(object $question): ?string
    {
        if ($question->question_type === null) {
            return null;
        }
        $options = self::json($question->options);
        $correct = $options['correct_answer'] ?? null;
        if ($correct === null || $correct === []) {
            return null;
        }
        $choices = is_array($options['choices'] ?? null) ? $options['choices'] : [];
        $text = self::describe($correct, $choices, in_array($question->question_type, self::ORDERED, true) ? ' → ' : ', ');

        return $text === '' ? null : $text;
    }

    /**
     * What a question's answers add up to, for the results page:
     *  - choices: [{label, count, correct?}] per option (polls, true/false, pick-answer quiz types)
     *  - words:   [{text, count}] most given answers first (word cloud, short/long answer)
     *  - ranking: [{label, average_position, first, ranked}] best average first; partial rankings count
     *             only for the items they ranked
     *  - scale:   per statement {label, average, answered, distribution}; values outside min..max (the
     *             v1 app saved 0 for an untouched slider) are counted as `skipped`, not averaged
     *  - none:    nothing to add up (sort questions: see right/wrong per participant)
     *
     * @param  list<array>  $answers  the decoded answer_data / completion_data of everyone who answered
     */
    public static function summary(object $item, array $answers, bool $quiz): array
    {
        $type = (string) ($quiz ? $item->question_type : $item->task_type);
        $selected = array_map(fn (array $a) => $a['selected_option'] ?? null, $answers);

        if ($quiz) {
            $options = self::json($item->options);
            $choices = is_array($options['choices'] ?? null) ? $options['choices'] : [];
            if (in_array($type, self::ORDERED, true)) {
                return ['kind' => 'none'];
            }
            if (in_array($type, self::TEXT_ANSWERS, true)) {
                return ['kind' => 'words', 'words' => self::words($selected)];
            }
            $right = self::indices($options['correct_answer'] ?? null) ?? [];

            return ['kind' => 'choices', 'choices' => self::counts($selected, $choices, $right)];
        }

        $data = self::json($item->task_data);
        $items = array_map(fn ($i) => is_array($i) ? ($i['text'] ?? null) : null, is_array($data['questions'] ?? null) ? $data['questions'] : []);

        return match ($type) {
            'single_choice', 'multiple_choice', 'truefalse' => ['kind' => 'choices', 'choices' => self::counts($selected, $items, null)],
            'ranking' => ['kind' => 'ranking', 'items' => self::ranking($selected, $items)],
            'scales' => ['kind' => 'scale'] + self::scale($selected, $items, $data),
            default => ['kind' => 'words', 'words' => self::words($selected)],
        };
    }

    /** Votes per option, in option order; `correct` only for quizzes. */
    private static function counts(array $selected, array $labels, ?array $right): array
    {
        $counts = [];
        foreach ($labels as $index => $label) {
            if (self::filled($label)) {
                $counts[$index] = ['label' => trim((string) $label), 'count' => 0] + ($right === null ? [] : ['correct' => in_array($index, $right, true)]);
            }
        }
        foreach ($selected as $value) {
            foreach (array_unique(self::indices($value) ?? []) as $index) {
                if (isset($counts[$index])) {
                    $counts[$index]['count']++;
                }
            }
        }

        return array_values($counts);
    }

    /** Most frequent answers (case and spacing ignored), at most 50. */
    private static function words(array $selected): array
    {
        $seen = [];
        foreach ($selected as $value) {
            foreach (self::list($value) as $entry) {
                $text = trim(preg_replace('/\s+/u', ' ', (string) $entry) ?? '');
                if ($text === '') {
                    continue;
                }
                $key = self::fold($text);
                $seen[$key] ??= ['text' => $text, 'count' => 0];
                $seen[$key]['count']++;
            }
        }
        usort($seen, fn ($a, $b) => $b['count'] <=> $a['count'] ?: strcmp($a['text'], $b['text']));

        return array_slice(array_values($seen), 0, 50);
    }

    private static function ranking(array $selected, array $items): array
    {
        $stats = [];
        foreach ($items as $index => $label) {
            if (self::filled($label)) {
                $stats[$index] = ['label' => trim((string) $label), 'positions' => [], 'first' => 0];
            }
        }
        foreach ($selected as $value) {
            foreach (array_values(array_unique(self::indices($value) ?? [])) as $position => $index) {
                if (isset($stats[$index])) {
                    $stats[$index]['positions'][] = $position + 1;
                    $stats[$index]['first'] += $position === 0 ? 1 : 0;
                }
            }
        }

        $out = array_map(fn ($s) => [
            'label' => $s['label'],
            'average_position' => $s['positions'] === [] ? null : round(array_sum($s['positions']) / count($s['positions']), 2),
            'first' => $s['first'],
            'ranked' => count($s['positions']),
        ], array_values($stats));
        usort($out, fn ($a, $b) => ($a['average_position'] ?? INF) <=> ($b['average_position'] ?? INF));

        return $out;
    }

    private static function scale(array $selected, array $statements, array $data): array
    {
        $min = is_numeric($data['minNumber'] ?? null) ? (int) $data['minNumber'] : 1;
        $max = is_numeric($data['maxNumber'] ?? null) ? (int) $data['maxNumber'] : 5;
        if ($max <= $min) {
            [$min, $max] = [1, 5];
        }

        $rows = [];
        foreach (array_values($statements) as $index => $label) {
            $rows[$index] = [
                'label' => self::filled($label) ? trim((string) $label) : 'Statement ' . ($index + 1),
                'values' => [],
                'skipped' => 0,
            ];
        }
        foreach ($selected as $value) {
            foreach (self::list($value) as $index => $rating) {
                if (! isset($rows[$index]) || ! is_numeric($rating)) {
                    continue;
                }
                $rating = (int) $rating;
                $rating >= $min && $rating <= $max ? $rows[$index]['values'][] = $rating : $rows[$index]['skipped']++;
            }
        }

        return [
            'min' => $min,
            'max' => $max,
            'min_label' => self::filled($data['minText'] ?? null) ? trim($data['minText']) : null,
            'max_label' => self::filled($data['maxText'] ?? null) ? trim($data['maxText']) : null,
            'statements' => array_values(array_map(function ($row) use ($min, $max) {
                $distribution = array_fill_keys(range($min, $max), 0);
                foreach ($row['values'] as $v) {
                    $distribution[$v]++;
                }

                return [
                    'label' => $row['label'],
                    'average' => $row['values'] === [] ? null : round(array_sum($row['values']) / count($row['values']), 2),
                    'answered' => count($row['values']),
                    'skipped' => $row['skipped'],
                    'distribution' => $distribution,
                ];
            }, $rows)),
        ];
    }

    public static function json(mixed $value): array
    {
        if (is_string($value)) {
            $value = json_decode($value, true);
        }

        return is_array($value) ? $value : [];
    }

    private static function judge(string $type, mixed $selected, mixed $correct, array $choices): ?bool
    {
        if ($selected === null || $selected === [] || $correct === null || $correct === []) {
            return null;
        }

        if (in_array($type, self::TEXT_ANSWERS, true)) {
            $accepted = array_map(fn ($c) => self::fold(is_numeric($c) ? ($choices[(int) $c] ?? '') : $c), self::list($correct));
            $given = array_map(fn ($s) => self::fold(is_numeric($s) ? ($choices[(int) $s] ?? '') : $s), self::list($selected));

            return $given !== [] && array_diff($given, $accepted) === [];
        }

        $picked = self::indices($selected);
        $right = self::indices($correct);
        if ($picked === null || $right === null) {
            return null; // free text where an option was expected: can't be judged
        }

        if (in_array($type, self::ORDERED, true)) {
            // Only the items that exist count; the v1 app padded the list with empty slots.
            $right = array_values(array_filter($right, fn ($i) => self::filled($choices[$i] ?? null)));

            return $picked === $right;
        }

        sort($picked);
        sort($right);

        return $picked === $right;
    }

    /** Indices as ints, or null when any entry isn't one. */
    private static function indices(mixed $value): ?array
    {
        $out = [];
        foreach (self::list($value) as $entry) {
            if (! is_int($entry) && ! (is_string($entry) && ctype_digit($entry))) {
                return null;
            }
            $out[] = (int) $entry;
        }

        return $out;
    }

    private static function describe(mixed $selected, array $labels, string $glue): string
    {
        $parts = [];
        foreach (self::list($selected) as $entry) {
            $parts[] = is_int($entry) || (is_string($entry) && ctype_digit($entry))
                ? (self::filled($labels[(int) $entry] ?? null) ? trim((string) $labels[(int) $entry]) : 'option ' . ((int) $entry + 1))
                : trim((string) $entry);
        }

        return implode($glue, array_filter($parts, fn ($p) => $p !== ''));
    }

    /** "1. first · 2. second" */
    private static function ranked(mixed $selected, array $items): string
    {
        $parts = [];
        foreach (self::list($selected) as $rank => $entry) {
            $label = is_numeric($entry) && self::filled($items[(int) $entry] ?? null) ? trim($items[(int) $entry]) : trim((string) $entry);
            $parts[] = ($rank + 1) . '. ' . $label;
        }

        return implode(' · ', $parts);
    }

    /** One value per statement, in statement order: "statement: value · ..." */
    private static function scaled(mixed $selected, array $items): string
    {
        $parts = [];
        foreach (self::list($selected) as $index => $value) {
            $label = self::filled($items[$index] ?? null) ? trim($items[$index]) : 'Statement ' . ($index + 1);
            $parts[] = $label . ': ' . (is_scalar($value) ? $value : json_encode($value));
        }

        return implode(' · ', $parts);
    }

    private static function list(mixed $value): array
    {
        if ($value === null || $value === '') {
            return [];
        }

        return is_array($value) ? array_values(array_filter($value, fn ($v) => $v !== null && ! is_array($v))) : [$value];
    }

    private static function filled(mixed $value): bool
    {
        return is_scalar($value) && trim((string) $value) !== '';
    }

    private static function fold(mixed $text): string
    {
        return mb_strtolower(trim(preg_replace('/\s+/u', ' ', (string) $text) ?? ''));
    }
}
