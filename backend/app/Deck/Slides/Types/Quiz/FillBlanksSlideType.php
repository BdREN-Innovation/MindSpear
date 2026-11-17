<?php

namespace App\Deck\Slides\Types\Quiz;

use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Support\Facades\Validator;

/**
 * Fill in the blanks (scored): complete the sentence by typing each missing
 * word, or choosing it from a dropdown.
 *
 * Config:  {text: string (the sentence, each answer in [brackets]; BlankText:
 *             ≤ 600 characters, ≤ 10 blanks, answers ≤ 60; '' seeded),
 *           blanks: [{mode: 'type' | 'dropdown',
 *                     alternatives: list<string> (type: other accepted answers, ≤ 4),
 *                     distractors: list<string> (dropdown: the wrong choices, ≤ 5)}, ...]
 *             settings of the blanks in reading order; missing ones are
 *             {mode: 'type'}, extra ones are kept but unused (the editor
 *             realigns them when brackets move),
 *           case_sensitive: bool (typed answers; default false)}
 * Options: none.
 * Slide defaults: 45 s, 50/100 points, speed bonus on.
 *
 * Participant view config (AbstractBlanksType::publicConfig):
 *   {parts, blanks: [{mode: 'type'} | {mode: 'dropdown', choices: list<string>}],
 *    case_sensitive, scoring}; a dropdown's choices are its answer and
 *   distractors in an order per run (QuizOptions::shuffleValues).
 *
 * Answer payload: {answers: list<string|null>} (AbstractBlanksType); a typed
 *   answer ≤ MAX_TYPED characters, a dropdown answer one of its choices.
 * Score: share of blanks right. A typed blank accepts its bracketed answer
 *   and alternatives, a dropdown blank its bracketed answer.
 * Aggregate / correct: AbstractBlanksType.
 */
class FillBlanksSlideType extends AbstractBlanksType
{
    public const KEY = 'fill_blanks';

    public const MAX_ALTERNATIVES = 4;

    public const MAX_DISTRACTORS = 5;

    /** Characters a typed answer may have. */
    public const MAX_TYPED = 100;

    public const MODES = ['type', 'dropdown'];

    public function key(): string
    {
        return self::KEY;
    }

    public function defaultConfig(): array
    {
        return ['text' => '', 'blanks' => [], 'case_sensitive' => false];
    }

    public function validateConfig(array $config): array
    {
        $config = array_replace($this->defaultConfig(), $config);

        Validator::make($config, [
            'blanks' => ['present', 'array', 'list', 'max:' . BlankText::MAX_BLANKS],
            'blanks.*' => ['array'],
            'blanks.*.mode' => ['sometimes', 'string', 'in:' . implode(',', self::MODES)],
            'blanks.*.alternatives' => ['sometimes', 'nullable', 'array', 'list', 'max:' . self::MAX_ALTERNATIVES],
            'blanks.*.alternatives.*' => ['nullable', 'string', 'max:' . BlankText::MAX_ANSWER],
            'blanks.*.distractors' => ['sometimes', 'nullable', 'array', 'list', 'max:' . self::MAX_DISTRACTORS],
            'blanks.*.distractors.*' => ['nullable', 'string', 'max:' . BlankText::MAX_ANSWER],
            'case_sensitive' => ['required', 'boolean'],
        ], [
            'blanks.max' => 'Use at most ' . BlankText::MAX_BLANKS . ' blanks.',
            'blanks.*.alternatives.max' => 'Add at most ' . self::MAX_ALTERNATIVES . ' other answers per blank.',
            'blanks.*.distractors.max' => 'Add at most ' . self::MAX_DISTRACTORS . ' wrong choices per blank.',
        ])->validate();

        return [
            'text' => self::validText($config['text']),
            'blanks' => array_map(fn (array $blank) => [
                'mode' => $blank['mode'] ?? 'type',
                'alternatives' => BlankText::words($blank['alternatives'] ?? []),
                'distractors' => BlankText::words($blank['distractors'] ?? []),
            ], $config['blanks']),
            'case_sensitive' => (bool) $config['case_sensitive'],
        ];
    }

    protected function resolveBlanks(array $config, array $answers): array
    {
        $settings = is_array($config['blanks'] ?? null) ? array_values($config['blanks']) : [];
        $caseSensitive = $this->caseSensitive($config);
        $blanks = [];

        foreach ($answers as $index => $answer) {
            $setting = is_array($settings[$index] ?? null) ? $settings[$index] : [];
            $answerForm = self::compareForm($answer, $caseSensitive);

            if (($setting['mode'] ?? 'type') === 'dropdown') {
                // The answer plus the wrong choices that differ from it.
                $wrong = array_values(array_filter(
                    array_slice(BlankText::words($setting['distractors'] ?? []), 0, self::MAX_DISTRACTORS),
                    fn (string $word) => self::compareForm($word, $caseSensitive) !== $answerForm,
                ));
                $blanks[] = ['mode' => 'dropdown', 'accepted' => [$answer], 'choices' => self::shuffledChoices($config, $index, [$answer, ...$wrong])];

                continue;
            }

            $accepted = [$answer, ...array_slice(BlankText::words($setting['alternatives'] ?? []), 0, self::MAX_ALTERNATIVES)];
            $blanks[] = ['mode' => 'type', 'accepted' => BlankText::words($accepted), 'choices' => null];
        }

        return $blanks;
    }

    protected function caseSensitive(array $config): bool
    {
        return (bool) ($config['case_sensitive'] ?? false);
    }

    protected function publicBlank(array $blank): array
    {
        return $blank['mode'] === 'dropdown' ? ['mode' => 'dropdown', 'choices' => $blank['choices']] : ['mode' => 'type'];
    }

    protected function checkValue(array $sentence, int $index, string $value): ?string
    {
        $blank = $sentence['blanks'][$index];

        if ($blank['mode'] === 'dropdown') {
            return in_array($value, $blank['choices'], true) ? null : 'Pick one of the choices.';
        }

        return mb_strlen($value) > self::MAX_TYPED ? 'Keep each answer to ' . self::MAX_TYPED . ' characters.' : null;
    }

    /** No options: the blanks are in the config. */
    protected function displayOptions(DeckSessionSlideRun $run, ?int $participantId = null): array
    {
        return [];
    }
}
