<?php

namespace App\Deck\Support;

/**
 * List-based profanity filter for audience text (Word Cloud, Q&A, Open
 * Ended). Whole words only, case-insensitive and Unicode-aware, so "class"
 * or "Scunthorpe" are left alone. Words come from config('deck.profanity').
 */
class ProfanityFilter
{
    private ?string $pattern;

    /** @param  list<string>|null  $words  null = config('deck.profanity') */
    public function __construct(?array $words = null)
    {
        $words = array_values(array_unique(array_filter(array_map(
            fn ($word) => mb_strtolower(trim((string) $word)),
            $words ?? (array) config('deck.profanity', []),
        ), fn (string $word) => $word !== '')));

        // Longest first so "fucking" wins over "fuck" in the alternation.
        usort($words, fn (string $a, string $b) => mb_strlen($b) <=> mb_strlen($a));

        $this->pattern = $words === []
            ? null
            : '/(?<![\p{L}\p{N}_])(?:' . implode('|', array_map(fn ($word) => preg_quote($word, '/'), $words)) . ')(?![\p{L}\p{N}_])/iu';
    }

    public function contains(string $text): bool
    {
        return $this->pattern !== null && preg_match($this->pattern, $this->clean($text)) === 1;
    }

    /** Each listed word replaced by asterisks of the same length. */
    public function mask(string $text): string
    {
        $text = $this->clean($text);

        if ($this->pattern === null) {
            return $text;
        }

        return preg_replace_callback(
            $this->pattern,
            fn (array $match) => str_repeat('*', mb_strlen($match[0])),
            $text,
        ) ?? $text;
    }

    /** Invalid UTF-8 would make /u patterns fail silently. */
    private function clean(string $text): string
    {
        return mb_scrub($text, 'UTF-8');
    }
}
