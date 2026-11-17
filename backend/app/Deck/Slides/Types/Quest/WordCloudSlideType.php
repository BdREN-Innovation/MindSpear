<?php

namespace App\Deck\Slides\Types\Quest;

use App\Deck\Slides\AbstractSlideType;
use App\Deck\Slides\AppendsSubmissions;
use App\Deck\Support\ProfanityFilter;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Normalizer;

/**
 * Word cloud: each participant sends 1..N short words or phrases.
 *
 * Config:  {max_entries_per_participant: int 1..10 (total per participant),
 *           max_entry_length: int 1..100 (characters per entry),
 *           profanity_filter_enabled: bool,
 *           allow_multiple_submissions: bool (§5.6: come back and add more words
 *           until max_entries_per_participant is reached),
 *           show_results_to_participants: bool (see PollSettings; default false)}
 * Options: none.
 *
 * Answer payload (in):     {entries: list<string>} 1..max_entries_per_participant strings.
 * Answer payload (stored): {entries: list<string>, entry_times: list<?string>}
 *   entries: trimmed, inner whitespace collapsed, invisible characters removed
 *   (ZWJ/ZWNJ kept, see PollText), duplicates (case-insensitive) removed, in
 *   submission order. entry_times[i] = when entries[i] was first submitted
 *   (ISO-8601; validateAnswer stamps now()). One row per participant per run:
 *   repeat submissions go through mergeSubmissions() (append when allowed,
 *   replace otherwise); earlier entries keep their earlier times.
 *
 * Aggregate (sent on every live broadcast, so its size is capped):
 *   {total_responses: int (participants with at least one entry), total_entries: int,
 *    distinct_words: int, truncated: bool (fewer words sent than distinct_words),
 *    words: [{word, count, first_seen_at (ISO-8601 or null)}, ...]}
 *   word = lower case, trimmed, whitespace collapsed, Unicode NFC; with the
 *   profanity filter on, listed words are masked with '*' and masked forms are
 *   counted together. Sorted by count desc, first_seen_at asc, word asc. At
 *   most MAX_WORDS words and at most PollText::BROADCAST_BUDGET_BYTES of them,
 *   so long or non-Latin words send fewer. first_seen_at = earliest entry time
 *   (entry_times, else the answer's submitted_at, else created_at) of the word.
 */
class WordCloudSlideType extends AbstractSlideType implements AppendsSubmissions
{
    public const KEY = 'word_cloud';

    /** Most words sent in one aggregate; the long tail is dropped. */
    public const MAX_WORDS = 75;

    public function __construct(private readonly ProfanityFilter $profanity) {}

    public function key(): string
    {
        return self::KEY;
    }

    public function category(): string
    {
        return self::CATEGORY_POLL;
    }

    public function revealModel(): string
    {
        return self::REVEAL_LIVE;
    }

    public function defaultConfig(): array
    {
        return [
            'max_entries_per_participant' => 3,
            'max_entry_length' => 25,
            'profanity_filter_enabled' => true,
            'allow_multiple_submissions' => false,
            ...PollSettings::defaults(),
        ];
    }

    public function validateConfig(array $config): array
    {
        $config = array_replace($this->defaultConfig(), $config);

        Validator::make($config, [
            'max_entries_per_participant' => ['required', 'integer', 'min:1', 'max:10'],
            'max_entry_length' => ['required', 'integer', 'min:1', 'max:100'],
            'profanity_filter_enabled' => ['required', 'boolean'],
            'allow_multiple_submissions' => ['required', 'boolean'],
            ...PollSettings::rules(),
        ])->validate();

        return [
            'max_entries_per_participant' => (int) $config['max_entries_per_participant'],
            'max_entry_length' => (int) $config['max_entry_length'],
            'profanity_filter_enabled' => (bool) $config['profanity_filter_enabled'],
            'allow_multiple_submissions' => (bool) $config['allow_multiple_submissions'],
            ...PollSettings::normalise($config),
        ];
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        $maxEntries = $this->maxEntries($config);
        $maxLength = max(1, (int) ($config['max_entry_length'] ?? $this->defaultConfig()['max_entry_length']));
        PollOptions::assertListAtMost($payload, 'entries', $maxEntries);

        Validator::make($payload, [
            'entries' => ['required', 'array', 'list', 'min:1', "max:{$maxEntries}"],
            'entries.*' => ['required', 'string'],
        ])->validate();

        $entries = [];
        foreach ($payload['entries'] as $index => $raw) {
            $entry = self::clean($raw);

            if ($entry === '') {
                throw ValidationException::withMessages(["entries.{$index}" => 'Entries cannot be blank.']);
            }
            if (mb_strlen($entry) > $maxLength) {
                throw ValidationException::withMessages(["entries.{$index}" => "Entries may be at most {$maxLength} characters."]);
            }

            $entries[self::normalise($entry)] ??= $entry;
        }

        $now = now()->toISOString();

        return [
            'entries' => array_values($entries),
            'entry_times' => array_fill(0, count($entries), $now),
        ];
    }

    public function allowsMultipleSubmissions(array $config): bool
    {
        return (bool) ($config['allow_multiple_submissions'] ?? false);
    }

    public function mergeSubmissions(array $previous, array $incoming, array $config): array
    {
        if (! $this->allowsMultipleSubmissions($config)) {
            return $incoming;
        }

        // Previous entries first, so a word sent again keeps its earlier time.
        $merged = [];
        foreach ([$previous, $incoming] as $payload) {
            foreach (self::timedEntries($payload) as [$entry, $time]) {
                $merged[self::normalise($entry)] ??= [$entry, $time];
            }
        }

        $max = $this->maxEntries($config);
        if (count($merged) > $max) {
            throw ValidationException::withMessages(['entries' => "You can submit at most {$max} words in total."]);
        }

        return [
            'entries' => array_column(array_values($merged), 0),
            'entry_times' => array_column(array_values($merged), 1),
        ];
    }

    public function aggregate(array $config, array $options, Collection $answers): array
    {
        $filter = (bool) ($config['profanity_filter_enabled'] ?? true);
        $words = [];
        $responses = 0;
        $entriesTotal = 0;

        foreach ($answers as $answer) {
            if (! is_array($answer->answer_payload['entries'] ?? null)) {
                continue;
            }

            $rowTime = ($answer->submitted_at ?? $answer->created_at)?->copy()->utc();

            // A participant counts once per word, however they spelled it.
            $mine = [];
            foreach (self::timedEntries($answer->answer_payload) as [$entry, $time]) {
                $word = self::normalise($entry);
                $word = $filter ? $this->profanity->mask($word) : $word;
                $seen = PollText::timestamp($time) ?? $rowTime;

                if (! array_key_exists($word, $mine) || self::earlier($seen, $mine[$word])) {
                    $mine[$word] = $seen;
                }
            }

            foreach ($mine as $word => $seen) {
                $word = (string) $word;
                $entriesTotal++;
                $words[$word] ??= ['word' => $word, 'count' => 0, 'first_seen' => null];
                $words[$word]['count']++;
                if (self::earlier($seen, $words[$word]['first_seen'])) {
                    $words[$word]['first_seen'] = $seen;
                }
            }

            if ($mine !== []) {
                $responses++;
            }
        }

        usort($words, function (array $a, array $b) {
            return [$b['count'], $a['first_seen'] === null ? 1 : 0, $a['first_seen']?->format('Y-m-d H:i:s.u') ?? '', $a['word']]
                <=> [$a['count'], $b['first_seen'] === null ? 1 : 0, $b['first_seen']?->format('Y-m-d H:i:s.u') ?? '', $b['word']];
        });

        $sent = PollText::fitBroadcastBudget(array_map(fn (array $word) => [
            'word' => $word['word'],
            'count' => $word['count'],
            'first_seen_at' => $word['first_seen']?->toISOString(),
        ], array_slice($words, 0, self::MAX_WORDS)));

        return [
            'total_responses' => $responses,
            'total_entries' => $entriesTotal,
            'distinct_words' => count($words),
            'truncated' => count($sent) < count($words),
            'words' => $sent,
        ];
    }

    /** Display form: valid UTF-8, invisible characters removed, trimmed, inner whitespace collapsed. */
    public static function clean(mixed $text): string
    {
        $text = mb_scrub((string) $text, 'UTF-8');
        $text = preg_replace('/\p{Cc}+/u', ' ', $text) ?? $text;
        $text = PollText::stripInvisible($text);

        return trim(preg_replace('/\s+/u', ' ', $text) ?? $text);
    }

    /** Grouping key: the cleaned text in NFC, lower case. */
    public static function normalise(string $text): string
    {
        $text = self::clean($text);
        if (class_exists(Normalizer::class)) {
            $text = Normalizer::normalize($text, Normalizer::FORM_C) ?: $text;
        }

        return mb_strtolower($text);
    }

    /**
     * Non-blank entries of a stored payload with their entry_times value
     * (null when missing, e.g. rows stored before entry_times existed).
     *
     * @return list<array{0: string, 1: ?string}>
     */
    private static function timedEntries(array $payload): array
    {
        $entries = $payload['entries'] ?? [];
        $times = is_array($payload['entry_times'] ?? null) ? array_values($payload['entry_times']) : [];
        $timed = [];

        foreach (is_array($entries) ? array_values($entries) : [] as $index => $entry) {
            if (is_string($entry) && ($entry = self::clean($entry)) !== '') {
                $time = $times[$index] ?? null;
                $timed[] = [$entry, is_string($time) ? $time : null];
            }
        }

        return $timed;
    }

    /** Whether $a is a known time before $b (an unknown $b loses to any known $a). */
    private static function earlier(?CarbonInterface $a, ?CarbonInterface $b): bool
    {
        return $a !== null && ($b === null || $a->lt($b));
    }

    private function maxEntries(array $config): int
    {
        return max(1, (int) ($config['max_entries_per_participant'] ?? $this->defaultConfig()['max_entries_per_participant']));
    }
}
