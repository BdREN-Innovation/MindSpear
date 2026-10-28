<?php

namespace App\Deck\Slides\Types\Quiz;

/**
 * The sentence of fill_blanks / drag_drop: plain text where each
 * [square-bracketed] word is a blank and the bracketed word its answer,
 * e.g. "The sun rises in the [east]." Pure helpers; not a slide type, so
 * discovery skips it.
 *
 * Brackets that are empty (or only spaces), nested or span a line break stay
 * literal text. Answers are cleaned like short answers (whitespace collapsed,
 * invisible characters dropped, trimmed).
 */
final class BlankText
{
    /** Characters a sentence may have (brackets and answers included). */
    public const MAX_TEXT = 600;

    public const MAX_BLANKS = 10;

    /** Characters per blank answer (and per alternative / extra word). */
    public const MAX_ANSWER = 60;

    private const BRACKET = '/\[([^\[\]\n]*)\]/u';

    /**
     * $text split into parts in reading order: {text: string} runs and
     * {blank: int} gaps (0-based blank index). `answers` holds each blank's
     * answer; `brackets` counts every bracketed answer, including the ones
     * past $max that stayed literal text.
     *
     * @return array{parts: list<array{text: string}|array{blank: int}>, answers: list<string>, brackets: int}
     */
    public static function parse(string $text, int $max = self::MAX_BLANKS): array
    {
        preg_match_all(self::BRACKET, $text, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);

        $parts = [];
        $answers = [];
        $buffer = '';
        $offset = 0;
        $brackets = 0;

        foreach ($matches as $match) {
            [$whole, $start] = $match[0];
            $buffer .= substr($text, $offset, $start - $offset);
            $offset = $start + strlen($whole);

            $answer = ShortAnswerSlideType::clean($match[1][0]);
            if ($answer !== '') {
                $brackets++;
            }
            if ($answer === '' || count($answers) >= $max) {
                $buffer .= $whole;

                continue;
            }

            if ($buffer !== '') {
                $parts[] = ['text' => $buffer];
                $buffer = '';
            }
            $parts[] = ['blank' => count($answers)];
            $answers[] = $answer;
        }

        $buffer .= substr($text, $offset);
        if ($buffer !== '') {
            $parts[] = ['text' => $buffer];
        }

        return ['parts' => $parts, 'answers' => $answers, 'brackets' => $brackets];
    }

    /**
     * Author word lists (alternatives, extra words): cleaned, blanks and
     * exact repeats dropped, order kept. ("Paris" and "paris" both stay: a
     * case-sensitive blank may accept both.)
     *
     * @return list<string>
     */
    public static function words(mixed $values): array
    {
        $words = [];
        foreach (is_array($values) ? $values : [] as $value) {
            $word = ShortAnswerSlideType::clean($value);
            if ($word !== '' && ! in_array($word, $words, true)) {
                $words[] = $word;
            }
        }

        return $words;
    }
}
