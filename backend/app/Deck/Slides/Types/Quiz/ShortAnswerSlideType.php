<?php

namespace App\Deck\Slides\Types\Quiz;

use App\Deck\Slides\Types\Quest\PollText;
use App\Deck\Support\ProfanityFilter;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Normalizer;

/**
 * Short answer (scored): type the answer, compared with the accepted answers.
 *
 * Config:  {case_sensitive: bool (default false),
 *           max_length: int 1..200 (characters per answer; default 100),
 *           profanity_filter_enabled: bool (masks submitted answers in the aggregate; default true)}
 * Options: the accepted answers (1–5): each option's label is one accepted
 *          answer; options with an empty label are ignored. 1 empty seeded.
 *          Participants never see them (their `options` is []).
 * Slide defaults: 30 s, 50/100 points, speed bonus on.
 *
 * Answer payload (in):     {text: string} 1..max_length characters after cleaning.
 * Answer payload (stored): {text: string} cleaned: valid UTF-8, control and
 *                          invisible characters removed, whitespace runs
 *                          collapsed to one space, trimmed.
 *
 * Score: full points when the answer matches an accepted answer, else 0.
 *   Both sides are compared after normalise(): cleaned as above, Unicode NFC,
 *   and case-folded unless case_sensitive. Exact compare, no fuzzy match.
 *
 * Aggregate (+ AbstractQuizType fields):
 *   {distinct_answers: int,
 *    answers: [{text, count, percentage (of responses, 2 dp), is_correct}, ...]
 *      the TOP_ANSWERS most common, count desc then text; answers that
 *      normalise the same are one row, shown as their most common spelling
 *      (masked when the profanity filter is on), cut to PREVIEW_LENGTH
 *      characters, and the list cut to ANSWERS_BUDGET_BYTES of the reveal
 *      broadcast (PollText::fitBroadcastBudget),
 *    answers_truncated: bool (a text or a row was cut),
 *    correct: {accepted_answers: list<string>, case_sensitive: bool}}
 */
class ShortAnswerSlideType extends AbstractQuizType
{
    public const KEY = 'short_answer';

    public const DEFAULT_TIME_LIMIT = 30;

    public const MAX_LENGTH = 200;

    /** Most common answers listed in the aggregate (keeps the reveal broadcast small). */
    public const TOP_ANSWERS = 10;

    /** Characters of each listed answer sent in the aggregate. */
    public const PREVIEW_LENGTH = 100;

    /** Bytes the answers list may take in the reveal broadcast (non-Latin text costs up to 7 bytes a character). */
    public const ANSWERS_BUDGET_BYTES = 4_000;

    public function __construct(private readonly ProfanityFilter $profanity) {}

    public function key(): string
    {
        return self::KEY;
    }

    public function defaultConfig(): array
    {
        return ['case_sensitive' => false, 'max_length' => 100, 'profanity_filter_enabled' => true];
    }

    public function defaultOptions(): array
    {
        return [['label' => null, 'payload' => []]];
    }

    public function validateConfig(array $config): array
    {
        $config = array_replace($this->defaultConfig(), $config);

        Validator::make($config, [
            'case_sensitive' => ['required', 'boolean'],
            'max_length' => ['required', 'integer', 'min:1', 'max:' . self::MAX_LENGTH],
            'profanity_filter_enabled' => ['required', 'boolean'],
        ])->validate();

        return [
            'case_sensitive' => (bool) $config['case_sensitive'],
            'max_length' => (int) $config['max_length'],
            'profanity_filter_enabled' => (bool) $config['profanity_filter_enabled'],
        ];
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        Validator::make($payload, [
            'text' => ['required', 'string'],
        ])->validate();

        $text = self::clean($payload['text']);
        $max = self::maxLength($config);

        if ($text === '') {
            throw ValidationException::withMessages(['text' => 'The answer cannot be blank.']);
        }
        if (mb_strlen($text) > $max) {
            throw ValidationException::withMessages(['text' => "The answer may be at most {$max} characters."]);
        }

        return ['text' => $text];
    }

    public function correctAnswer(array $config, array $options): array
    {
        return [
            'accepted_answers' => self::accepted($options),
            'case_sensitive' => (bool) ($config['case_sensitive'] ?? false),
        ];
    }

    /** Comparison form of $text: cleaned, NFC, case-folded unless $caseSensitive. */
    public static function normalise(mixed $text, bool $caseSensitive): string
    {
        $text = self::clean($text);

        if (class_exists(Normalizer::class)) {
            $text = Normalizer::normalize($text, Normalizer::FORM_C) ?: $text;
        }

        return $caseSensitive ? $text : mb_convert_case($text, MB_CASE_FOLD, 'UTF-8');
    }

    /** Valid UTF-8 without control or invisible characters, whitespace runs collapsed, trimmed. */
    public static function clean(mixed $text): string
    {
        if (! is_string($text)) {
            return '';
        }

        $text = PollText::stripInvisible(mb_scrub($text, 'UTF-8'));
        $text = preg_replace('/[\s\p{Cc}]+/u', ' ', $text) ?? $text;

        return trim($text);
    }

    protected function answerKey(array $config, array $options): array
    {
        $caseSensitive = (bool) ($config['case_sensitive'] ?? false);
        $accepted = [];
        foreach (self::accepted($options) as $answer) {
            $accepted[self::normalise($answer, $caseSensitive)] = true;
        }

        return ['case_sensitive' => $caseSensitive, 'accepted' => $accepted];
    }

    protected function judge(array $payload, array $key): ?Evaluation
    {
        $text = $payload['text'] ?? null;
        if (! is_string($text)) {
            return null;
        }

        $normalised = self::normalise($text, $key['case_sensitive']);

        return $normalised !== '' && isset($key['accepted'][$normalised]) ? Evaluation::right() : Evaluation::wrong();
    }

    protected function breakdown(array $config, array $options, array $key, array $payloads): array
    {
        /** @var array<string, array{count:int, spellings: array<string,int>}> $groups */
        $groups = [];
        foreach ($payloads as $payload) {
            $text = self::clean($payload['text']);
            $normalised = self::normalise($text, $key['case_sensitive']);
            if ($normalised === '') {
                continue;
            }

            // String keys stay strings: prefix so "123" is not turned into an int key.
            $group = 's:' . $normalised;
            $groups[$group]['count'] = ($groups[$group]['count'] ?? 0) + 1;
            $groups[$group]['spellings'][$text] = ($groups[$group]['spellings'][$text] ?? 0) + 1;
            $groups[$group]['correct'] = isset($key['accepted'][$normalised]);
        }

        $filter = (bool) ($config['profanity_filter_enabled'] ?? true);
        $rows = [];
        foreach ($groups as $group) {
            $spellings = [];
            foreach ($group['spellings'] as $spelling => $count) {
                $spellings[] = [(string) $spelling, $count];
            }
            usort($spellings, fn (array $a, array $b) => [$b[1], $a[0]] <=> [$a[1], $b[0]]);
            $text = $spellings[0][0];

            $rows[] = [
                'text' => $filter && ! $group['correct'] ? $this->profanity->mask($text) : $text,
                'count' => $group['count'],
                'percentage' => QuizOptions::percentage($group['count'], count($payloads)),
                'is_correct' => $group['correct'],
                '_sort' => $text,
            ];
        }

        usort($rows, fn (array $a, array $b) => [$b['count'], $a['_sort']] <=> [$a['count'], $b['_sort']]);

        $cut = false;
        $top = [];
        foreach (array_slice($rows, 0, self::TOP_ANSWERS) as $row) {
            unset($row['_sort']);
            if (mb_strlen($row['text']) > self::PREVIEW_LENGTH) {
                $row['text'] = rtrim(mb_substr($row['text'], 0, self::PREVIEW_LENGTH));
                $cut = true;
            }
            $top[] = $row;
        }
        $fitted = PollText::fitBroadcastBudget($top, self::ANSWERS_BUDGET_BYTES);

        return [
            'distinct_answers' => count($rows),
            'answers' => $fitted,
            'answers_truncated' => $cut || count($fitted) < count($top),
        ];
    }

    /** Accepted answers are never shown to participants. */
    protected function displayOptions(DeckSessionSlideRun $run, ?int $participantId = null): array
    {
        return [];
    }

    /** @return list<string> accepted answers (option labels, cleaned, non-empty), in option order */
    private static function accepted(array $options): array
    {
        $accepted = [];
        foreach (QuizOptions::sorted($options) as $option) {
            $label = self::clean($option['label'] ?? null);
            if ($label !== '') {
                $accepted[] = $label;
            }
        }

        return array_values(array_unique($accepted));
    }

    private static function maxLength(array $config): int
    {
        $max = (int) ($config['max_length'] ?? 100);

        return max(1, min($max, self::MAX_LENGTH));
    }
}
