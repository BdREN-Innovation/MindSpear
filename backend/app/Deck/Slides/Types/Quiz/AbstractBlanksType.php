<?php

namespace App\Deck\Slides\Types\Quiz;

use App\Deck\Slides\Types\Content\ContentSlideType;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Base for the sentence-with-blanks Quiz types (fill_blanks, drag_drop).
 * Abstract, so discovery skips it.
 *
 * Config `text` is the sentence with each answer in [square brackets]
 * (BlankText); the type's other config keys say how each blank is answered.
 * Slides have no options. The answer key lives in config only, so the
 * participant / presenter config is rebuilt by publicConfig():
 *   {parts: [{text} | {blank: int}, ...], blanks: [publicBlank(), ...], scoring}
 * (`text` and every other author key dropped).
 *
 * Answer payload (in / stored): {answers: list<string|null>}, one per blank
 *   in reading order (null / '' = left empty; at least one filled), each
 *   cleaned like a short answer. checkValue() says what a blank accepts.
 *
 * Score: points * (blanks right / blanks); fully correct when all are. A
 *   blank is right when its value matches one of its accepted answers after
 *   ShortAnswerSlideType::normalise (case-folded unless case-sensitive).
 *
 * Aggregate (+ AbstractQuizType fields):
 *   {blanks: [{correct_count, correct_percentage}, ...] in reading order,
 *    correct: {blanks: [{answers: list<string>}, ...]} (first = the bracketed answer)}
 */
abstract class AbstractBlanksType extends AbstractQuizType
{
    public const DEFAULT_TIME_LIMIT = 45;

    /** Author config keys that hold the answer key (never public). */
    protected const AUTHOR_KEYS = ['text', 'blanks', 'distractors'];

    /**
     * The blanks of $answers (one bracketed answer each), resolved from $config:
     * mode, accepted answers (first = the bracketed one) and, for choice blanks,
     * the values to choose from (in display order).
     *
     * @param  list<string>  $answers
     * @return list<array{mode: string, accepted: list<string>, choices: ?list<string>}>
     */
    abstract protected function resolveBlanks(array $config, array $answers): array;

    /** Why $value is no answer for blank $index (null = fine). $value is cleaned and non-empty. */
    abstract protected function checkValue(array $sentence, int $index, string $value): ?string;

    /** Whether answers compare case-sensitively. */
    protected function caseSensitive(array $config): bool
    {
        return false;
    }

    /** A blank as participants see it. */
    protected function publicBlank(array $blank): array
    {
        return ['mode' => $blank['mode']];
    }

    /** Extra checks over all the cleaned answers (null = left empty). */
    protected function checkAnswers(array $sentence, array $answers): void {}

    /**
     * The sentence of $config: its parts, resolved blanks and comparison case.
     *
     * @return array{parts: list<array>, blanks: list<array{mode: string, accepted: list<string>, choices: ?list<string>}>, case_sensitive: bool}
     */
    public function sentence(array $config): array
    {
        $parsed = BlankText::parse(is_string($config['text'] ?? null) ? $config['text'] : '');

        return [
            'parts' => $parsed['parts'],
            'blanks' => $this->resolveBlanks($config, $parsed['answers']),
            'case_sensitive' => $this->caseSensitive($config),
        ];
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        $sentence = $this->sentence($config);
        $count = count($sentence['blanks']);

        if ($count === 0) {
            throw ValidationException::withMessages(['answers' => 'This slide has no blanks to fill.']);
        }

        Validator::make($payload, [
            'answers' => ['required', 'array', 'list', 'size:' . $count],
            'answers.*' => ['nullable', 'string'],
        ], [
            'answers.size' => 'Send one answer per blank.',
        ])->validate();

        $answers = [];
        $errors = [];
        foreach ($payload['answers'] as $index => $value) {
            $value = ShortAnswerSlideType::clean($value);
            if ($value !== '' && ($error = $this->checkValue($sentence, $index, $value)) !== null) {
                $errors["answers.{$index}"] = $error;
            }
            $answers[] = $value === '' ? null : $value;
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
        if (array_filter($answers, fn (?string $answer) => $answer !== null) === []) {
            throw ValidationException::withMessages(['answers' => 'Fill in at least one blank.']);
        }

        $this->checkAnswers($sentence, $answers);

        return ['answers' => $answers];
    }

    public function correctAnswer(array $config, array $options): array
    {
        return ['blanks' => array_map(fn (array $blank) => ['answers' => $blank['accepted']], $this->sentence($config)['blanks'])];
    }

    /** Participants get the sentence parts and how to fill each blank, never the answers. */
    protected function publicConfig(array $config): array
    {
        $sentence = $this->sentence($config);

        return array_replace(parent::publicConfig(Arr::except($config, static::AUTHOR_KEYS)), [
            'parts' => $sentence['parts'],
            'blanks' => array_map(fn (array $blank) => $this->publicBlank($blank), $sentence['blanks']),
        ]);
    }

    /** @return array{blanks: list<array<string, true>>, case_sensitive: bool} accepted answers per blank, in comparison form */
    protected function answerKey(array $config, array $options): array
    {
        $sentence = $this->sentence($config);

        return ['blanks' => array_map(function (array $blank) use ($sentence) {
            $accepted = [];
            foreach ($blank['accepted'] as $answer) {
                $accepted[self::compareForm($answer, $sentence['case_sensitive'])] = true;
            }

            return $accepted;
        }, $sentence['blanks']), 'case_sensitive' => $sentence['case_sensitive']];
    }

    protected function judge(array $payload, array $key): ?Evaluation
    {
        $hits = $this->hits($payload, $key);

        return $hits === null ? null : Evaluation::ratio(array_sum($hits), count($key['blanks']));
    }

    protected function breakdown(array $config, array $options, array $key, array $payloads): array
    {
        $correct = array_fill(0, count($key['blanks']), 0);
        foreach ($payloads as $payload) {
            foreach ($this->hits($payload, $key) ?? [] as $index => $hit) {
                $correct[$index] += $hit;
            }
        }

        return ['blanks' => array_map(fn (int $count) => [
            'correct_count' => $count,
            'correct_percentage' => QuizOptions::percentage($count, count($payloads)),
        ], $correct)];
    }

    /** Blank options a choice blank shows, keyed per run by the run's salt (QuizOptions::shuffleValues). */
    protected static function shuffledChoices(array $config, int $index, array $choices): array
    {
        return QuizOptions::shuffleValues($choices, (QuizOptions::salt($config) ?? 'preview') . ":blank:{$index}");
    }

    /**
     * Sanitised sentence text: multi-line, at most MAX_TEXT characters, at most
     * MAX_BLANKS blanks, each answer at most MAX_ANSWER characters.
     *
     * @throws ValidationException keyed `text`
     */
    protected static function validText(mixed $text): string
    {
        if ($text !== null && ! is_string($text)) {
            throw ValidationException::withMessages(['text' => 'The sentence must be text.']);
        }

        $text = ContentSlideType::sanitize((string) $text, true);
        $parsed = BlankText::parse($text, PHP_INT_MAX);

        $message = match (true) {
            mb_strlen($text) > BlankText::MAX_TEXT => 'The sentence may be at most ' . BlankText::MAX_TEXT . ' characters.',
            $parsed['brackets'] > BlankText::MAX_BLANKS => 'Use at most ' . BlankText::MAX_BLANKS . ' blanks.',
            max([0, ...array_map('mb_strlen', $parsed['answers'])]) > BlankText::MAX_ANSWER => 'Each missing word may be at most ' . BlankText::MAX_ANSWER . ' characters.',
            default => null,
        };

        if ($message !== null) {
            throw ValidationException::withMessages(['text' => $message]);
        }

        return $text;
    }

    /** Comparison form: ShortAnswerSlideType::normalise. */
    protected static function compareForm(string $value, bool $caseSensitive): string
    {
        return ShortAnswerSlideType::normalise($value, $caseSensitive);
    }

    /**
     * 1 / 0 per blank for $payload; null when it has no answer list.
     *
     * @return list<int>|null
     */
    private function hits(array $payload, array $key): ?array
    {
        $answers = $payload['answers'] ?? null;
        if (! is_array($answers) || ! array_is_list($answers)) {
            return null;
        }

        $hits = [];
        foreach ($key['blanks'] as $index => $accepted) {
            $value = $answers[$index] ?? null;
            $form = is_string($value) ? self::compareForm($value, $key['case_sensitive']) : '';
            $hits[] = $form !== '' && isset($accepted[$form]) ? 1 : 0;
        }

        return $hits;
    }
}
