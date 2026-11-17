<?php

namespace App\Deck\Slides\Types\Quiz;

use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Drag and drop (scored): drag words from a word bank into the blanks of a
 * sentence.
 *
 * Config:  {text: string (the sentence, each answer in [brackets]; BlankText:
 *             ≤ 600 characters, ≤ 10 blanks, answers ≤ 60; '' seeded),
 *           distractors: list<string> (extra wrong words for the bank, ≤ 8)}
 * Options: none. The word bank is every blank's answer (repeats included)
 *          plus the distractors that are not also answers.
 * Slide defaults: 45 s, 50/100 points, speed bonus on.
 *
 * Participant view: config {parts, blanks: [{mode: 'drop'}, ...], scoring};
 *   options = the word bank as {id: opaque key (QuizOptions::key, per run),
 *   label: the word, payload: {}}, in a keyed per-participant shuffle
 *   (QuizOptions::shuffle) and hidden until voting like other quiz options.
 *
 * Answer payload: {answers: list<string|null>} (AbstractBlanksType), each a
 *   word of the bank, no word used more often than the bank has it.
 * Score: share of blanks holding their own answer (exact word).
 * Aggregate / correct: AbstractBlanksType.
 */
class DragDropSlideType extends AbstractBlanksType
{
    public const KEY = 'drag_drop';

    public const MAX_DISTRACTORS = 8;

    public function key(): string
    {
        return self::KEY;
    }

    public function defaultConfig(): array
    {
        return ['text' => '', 'distractors' => []];
    }

    public function validateConfig(array $config): array
    {
        $config = array_replace($this->defaultConfig(), $config);

        Validator::make($config, [
            'distractors' => ['present', 'nullable', 'array', 'list', 'max:' . self::MAX_DISTRACTORS],
            'distractors.*' => ['nullable', 'string', 'max:' . BlankText::MAX_ANSWER],
        ], [
            'distractors.max' => 'Add at most ' . self::MAX_DISTRACTORS . ' extra words.',
        ])->validate();

        return [
            'text' => self::validText($config['text']),
            'distractors' => BlankText::words($config['distractors'] ?? []),
        ];
    }

    /** Adds the word bank: answers in reading order, then the extra words. */
    public function sentence(array $config): array
    {
        $sentence = parent::sentence($config);
        $answers = array_map(fn (array $blank) => $blank['accepted'][0], $sentence['blanks']);
        $extra = array_filter(
            array_slice(BlankText::words($config['distractors'] ?? []), 0, self::MAX_DISTRACTORS),
            fn (string $word) => ! in_array($word, $answers, true),
        );

        return $sentence + ['bank' => [...$answers, ...array_values($extra)]];
    }

    protected function resolveBlanks(array $config, array $answers): array
    {
        return array_map(fn (string $answer) => ['mode' => 'drop', 'accepted' => [$answer], 'choices' => null], $answers);
    }

    /** Words are dragged, never typed: they match exactly. */
    protected function caseSensitive(array $config): bool
    {
        return true;
    }

    protected function checkValue(array $sentence, int $index, string $value): ?string
    {
        return in_array($value, $sentence['bank'], true) ? null : 'Use one of the words given.';
    }

    protected function checkAnswers(array $sentence, array $answers): void
    {
        $available = array_count_values($sentence['bank']);
        foreach (array_count_values(array_filter($answers, 'is_string')) as $word => $used) {
            if ($used > ($available[$word] ?? 0)) {
                throw ValidationException::withMessages(['answers' => 'Each word can only be used once.']);
            }
        }
    }

    /** The word bank as options (id = bank position), in the keyed order of this run and participant. */
    protected function displayOptions(DeckSessionSlideRun $run, ?int $participantId = null): array
    {
        $words = [];
        foreach ($this->sentence($run->config_snapshot ?? [])['bank'] as $index => $word) {
            $words[] = ['id' => $index + 1, 'position' => $index + 1, 'label' => $word, 'image_url' => null, 'is_correct' => null, 'payload' => []];
        }

        return QuizOptions::shuffle($words, (int) $run->id, $participantId);
    }

    protected function publicId(array $option, array $config): int|string
    {
        return QuizOptions::key((int) $option['id'], $config);
    }

    protected function participantPayload(array $option, array $public): array
    {
        return [];
    }
}
