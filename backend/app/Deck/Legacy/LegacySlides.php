<?php

namespace App\Deck\Legacy;

use App\Deck\Authoring\SlideInput;

/**
 * Maps one legacy v1 question (table `questions`, quizzes) or task (table
 * `quest_tasks`, quests) to the slide data SlideAuthoringService::bulk() takes.
 * Pure: no database access. Each method returns either
 *   ['slide' => array, 'time_limit' => ?int, 'notes' => list<string>]
 * or
 *   ['skip' => string]   (why the question can't become a slide)
 *
 * Legacy shapes (from the production data):
 *  - questions.options:  {"choices": [string|null, ...], "correct_answer": int | list<int>, "color": [...]}
 *  - quest_tasks.task_data: {"questions": [{"id", "text", "color"}], "minNumber", "maxNumber",
 *                            "minText", "maxText", "time_limit"}
 */
final class LegacySlides
{
    /** Legacy quiz question types → deck slide type. */
    public const QUIZ_TYPES = [
        'single_choice' => 'pick_answer_single',
        'quiz_single_choice' => 'pick_answer_single',
        'multiple_choice' => 'pick_answer_single', // Pick answer takes several correct answers
        'quiz_multiple_choice' => 'pick_answer_single',
        // v1 "fill in the blanks" was a choice question with one correct option.
        'fill_in_the_blanks' => 'pick_answer_single',
        'fill_in_the_blanks_choice' => 'pick_answer_single',
        'true_false' => 'true_false',
        'true_false_choice' => 'true_false',
        'sort_answer_choice' => 'correct_order',
        'short_answer' => 'short_answer',
    ];

    /** Legacy quest task types → deck slide type. */
    public const QUEST_TYPES = [
        'single_choice' => 'poll_single',
        'truefalse' => 'poll_single',
        'multiple_choice' => 'poll_multi',
        'ranking' => 'ranking',
        'scales' => 'scales',
        'wordcloud' => 'word_cloud',
        'shortanswer' => 'open_ended',
        'longanswer' => 'open_ended',
    ];

    /** Option limits that matter here (config deck.option_limits). */
    private const PICK_MAX = 10;

    private const ORDER_MIN = 3;

    private const ORDER_MAX = 8;

    private const SHORT_ANSWER_MAX = 5;

    private const POLL_MAX = 30;

    private const RANKING_MAX = 12;

    private const SCALES_MAX = 20;

    private const LONG_ANSWER_LENGTH = 2000;

    /** @param array{question_type:?string, question_text:?string, options:mixed, time_limit_seconds:mixed} $question */
    public static function fromQuestion(array $question): array
    {
        $legacyType = $question['question_type'] ?? null;
        if ($legacyType === null || $legacyType === '') {
            return ['skip' => 'no question type (an unfinished, blank question)'];
        }
        $type = self::QUIZ_TYPES[$legacyType] ?? null;
        if ($type === null) {
            return ['skip' => "question type \"{$legacyType}\" has no deck equivalent"];
        }

        $options = self::json($question['options'] ?? null);
        $choices = self::choices($options['choices'] ?? []);
        $correct = self::correctIndices($options['correct_answer'] ?? null, $choices);
        $title = self::text($question['question_text'] ?? null);
        $notes = [];

        if ($type === 'true_false' && count($choices) !== 2) {
            // Not a clean True/False pair: keep the answers as a Pick answer question.
            $type = 'pick_answer_single';
        }

        $slideOptions = match ($type) {
            'pick_answer_single', 'true_false' => self::pickOptions($choices, $correct, $notes),
            'correct_order' => self::orderOptions($choices, $correct),
            'short_answer' => self::acceptedAnswers($choices, $correct, self::correctTexts($options['correct_answer'] ?? null), $notes),
        };
        if (is_string($slideOptions)) {
            return ['skip' => $slideOptions];
        }

        return [
            'slide' => ['type' => $type, 'title' => $title, 'options' => $slideOptions],
            'time_limit' => self::seconds($question['time_limit_seconds'] ?? null),
            'notes' => $notes,
        ];
    }

    /** @param array{task_type:?string, title:?string, description:?string, task_data:mixed} $task */
    public static function fromTask(array $task): array
    {
        $legacyType = (string) ($task['task_type'] ?? '');
        $type = self::QUEST_TYPES[$legacyType] ?? null;
        if ($type === null) {
            return ['skip' => $legacyType === ''
                ? 'no task type'
                : "task type \"{$legacyType}\" has no deck equivalent (all of these are unfinished \"Untitled question\" tasks)"];
        }

        $data = self::json($task['task_data'] ?? null);
        $items = self::items($data['questions'] ?? []);
        $title = self::text($task['title'] ?? null) ?? self::text($task['description'] ?? null);
        $config = [];
        $options = null;
        $notes = [];

        switch ($legacyType) {
            case 'truefalse':
                $items = count($items) >= 2 ? $items : ['Yes', 'No'];
                // no break
            case 'single_choice':
            case 'multiple_choice':
                if (count($items) < 2) {
                    return ['skip' => 'a poll needs at least 2 answers'];
                }
                $options = self::labels(array_slice($items, 0, self::POLL_MAX));
                break;
            case 'ranking':
                if (count($items) < 2) {
                    return ['skip' => 'a ranking needs at least 2 items'];
                }
                if (count($items) > self::RANKING_MAX) {
                    $notes[] = 'kept the first ' . self::RANKING_MAX . ' of ' . count($items) . ' items';
                }
                $options = self::labels(array_slice($items, 0, self::RANKING_MAX));
                break;
            case 'scales':
                $items = $items !== [] ? $items : [$title ?? 'Statement'];
                $options = self::labels(array_slice($items, 0, self::SCALES_MAX));
                $config = self::scale($data);
                break;
            case 'wordcloud':
                if ($items !== []) {
                    $notes[] = 'word cloud: the old example words are not carried over (participants type their own)';
                }
                break;
            case 'longanswer':
                $config = ['max_length' => self::LONG_ANSWER_LENGTH];
                break;
        }

        $slide = ['type' => $type, 'title' => $title];
        if ($config !== []) {
            $slide['config'] = $config;
        }
        if ($options !== null) {
            $slide['options'] = $options;
        }

        return ['slide' => $slide, 'time_limit' => self::seconds($data['time_limit'] ?? null), 'notes' => $notes];
    }

    /** Legacy answer choices, keyed by their original index (blank and null ones dropped). */
    private static function choices(mixed $choices): array
    {
        $out = [];
        foreach (is_array($choices) ? $choices : [] as $index => $choice) {
            $text = is_scalar($choice) ? self::text((string) $choice) : null;
            if ($text !== null) {
                $out[(int) $index] = $text;
            }
        }

        return $out;
    }

    /** correct_answer (an index or a list of them) restricted to the kept choices, in its own order. */
    private static function correctIndices(mixed $value, array $choices): array
    {
        $list = is_array($value) ? $value : ($value === null || $value === '' ? [] : [$value]);
        $out = [];
        foreach ($list as $index) {
            if (is_numeric($index) && array_key_exists((int) $index, $choices) && ! in_array((int) $index, $out, true)) {
                $out[] = (int) $index;
            }
        }

        return $out;
    }

    private static function pickOptions(array $choices, array $correct, array &$notes): array|string
    {
        if (count($choices) < 2) {
            return 'fewer than 2 answer choices';
        }
        if (count($choices) > self::PICK_MAX) {
            return 'more than ' . self::PICK_MAX . ' answer choices';
        }
        if ($correct === []) {
            $notes[] = 'no correct answer was marked; set one in the editor';
        }

        $options = [];
        foreach ($choices as $index => $label) {
            $options[] = ['label' => self::label($label), 'is_correct' => in_array($index, $correct, true)];
        }

        return $options;
    }

    /** Options in the correct order: correct_answer's order, then any choice it left out. */
    private static function orderOptions(array $choices, array $correct): array|string
    {
        $order = array_merge($correct, array_values(array_diff(array_keys($choices), $correct)));
        if (count($order) < self::ORDER_MIN) {
            return 'Correct order needs at least ' . self::ORDER_MIN . ' items';
        }
        if (count($order) > self::ORDER_MAX) {
            return 'more than ' . self::ORDER_MAX . ' items to order';
        }

        return array_map(fn (int $index) => ['label' => self::label($choices[$index])], $order);
    }

    /** correct_answer entries that are answer texts rather than indices (some short answers store them so). */
    private static function correctTexts(mixed $value): array
    {
        $out = [];
        foreach (is_array($value) ? $value : [$value] as $entry) {
            $text = is_string($entry) && ! is_numeric($entry) ? self::text($entry) : null;
            if ($text !== null && ! in_array($text, $out, true)) {
                $out[] = $text;
            }
        }

        return $out;
    }

    /**
     * Short answer: the accepted answers are the marked choices plus any answer texts in
     * correct_answer, or every choice when neither is there.
     */
    private static function acceptedAnswers(array $choices, array $correct, array $correctTexts, array &$notes): array|string
    {
        $accepted = array_values(array_unique(array_merge(array_map(fn (int $index) => $choices[$index], $correct), $correctTexts)));
        $accepted = $accepted !== [] ? $accepted : array_values($choices);
        if ($accepted === []) {
            return 'no accepted answer';
        }
        if (count($accepted) > self::SHORT_ANSWER_MAX) {
            $notes[] = 'kept the first ' . self::SHORT_ANSWER_MAX . ' of ' . count($accepted) . ' accepted answers';
        }

        return self::labels(array_slice($accepted, 0, self::SHORT_ANSWER_MAX));
    }

    /** Scale config from minNumber..maxNumber (2..10 points, else 5) and the end labels. */
    private static function scale(array $data): array
    {
        $min = is_numeric($data['minNumber'] ?? null) ? (int) $data['minNumber'] : null;
        $max = is_numeric($data['maxNumber'] ?? null) ? (int) $data['maxNumber'] : null;
        $points = $min !== null && $max !== null ? $max - $min + 1 : 5;
        $points = $points >= 2 && $points <= 10 ? $points : 5;

        $labels = array_fill(0, $points, null);
        $labels[0] = self::cut(self::text($data['minText'] ?? null), 60);
        $labels[$points - 1] = self::cut(self::text($data['maxText'] ?? null), 60);

        return ['scale_points' => $points, 'scale_labels' => $labels];
    }

    /** Legacy task items' texts, blank ones dropped. */
    private static function items(mixed $items): array
    {
        $out = [];
        foreach (is_array($items) ? $items : [] as $item) {
            $text = is_array($item) && is_scalar($item['text'] ?? null) ? self::text((string) $item['text']) : null;
            if ($text !== null) {
                $out[] = $text;
            }
        }

        return $out;
    }

    private static function labels(array $texts): array
    {
        return array_values(array_map(fn (string $text) => ['label' => self::label($text)], $texts));
    }

    private static function label(string $text): string
    {
        return self::cut($text, SlideInput::MAX_LABEL);
    }

    /** A legacy time limit within the deck's allowed range, or null for the slide type's default. */
    private static function seconds(mixed $value): ?int
    {
        if (! is_numeric($value) || (int) $value <= 0) {
            return null;
        }

        return max(SlideInput::MIN_TIME_LIMIT, min(SlideInput::MAX_TIME_LIMIT, (int) $value));
    }

    private static function json(mixed $value): array
    {
        if (is_string($value)) {
            $value = json_decode($value, true);
        }

        return is_array($value) ? $value : [];
    }

    private static function text(?string $value): ?string
    {
        $value = trim(preg_replace('/\s+/u', ' ', (string) $value) ?? '');

        return $value === '' ? null : $value;
    }

    private static function cut(?string $value, int $max): ?string
    {
        return $value === null ? null : mb_substr($value, 0, $max);
    }
}
