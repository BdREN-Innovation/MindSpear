<?php

namespace App\Deck\Slides\Types\Quest;

use App\Deck\Slides\AbstractSlideType;
use App\Deck\Slides\AppendsSubmissions;
use App\Deck\Support\ProfanityFilter;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Open ended: free-text responses shown as a card wall on the presenter.
 *
 * Config:  {max_length: int 10..2000 (characters per response),
 *           max_submissions_per_participant: int 1..20 (> 1 = §5.6 "allow multiple submissions"),
 *           profanity_filter_enabled: bool,
 *           show_results_to_participants: bool (see PollSettings; default false)}
 * Options: none.
 *
 * Answer payload (in):     {text: string} one response per submission, 1..max_length
 *                          characters after trimming.
 * Answer payload (stored): {entries: [{body: string, submitted_at: ISO-8601}, ...]}
 *   Control and invisible characters are removed (newlines, tabs and ZWJ/ZWNJ
 *   kept, see PollText). validateAnswer returns a single entry stamped now().
 *   One row per participant per run: repeat submissions go through
 *   mergeSubmissions() — appended while under max_submissions_per_participant,
 *   replaced when it is 1.
 *
 * page() (GET /aggregate?page=N, full text, PER_PAGE cards a page):
 *   {total_responses: int (participants), total_entries: int, page: int, per_page: int,
 *    last_page: int, truncated: false,
 *    items: [{id: "<answer_id>:<index>", body, body_truncated: false,
 *             participant_emoji: ?string, submitted_at: ?ISO-8601}, ...]}
 *   Newest first (submitted_at desc, answer id desc, index desc). Bodies are
 *   masked when the profanity filter is on. Display names are deliberately left
 *   out: the aggregate may go out on the public channel. participant_emoji needs
 *   the answer's participant relation (loaded here for Eloquent collections).
 *
 * aggregate() (sent on every live broadcast, so its size is capped): the same
 *   shape for page 1 with per_page = BROADCAST_PER_PAGE, each body cut to
 *   PREVIEW_LENGTH characters (body_truncated: true when cut), and the items cut
 *   to PollText::BROADCAST_BUDGET_BYTES. truncated: true when a body was cut or
 *   cards were dropped; the presenter then loads full text through page().
 */
class OpenEndedSlideType extends AbstractSlideType implements AppendsSubmissions
{
    public const KEY = 'open_ended';

    public const PER_PAGE = 20;

    /** Newest cards sent in one aggregate broadcast. */
    public const BROADCAST_PER_PAGE = 10;

    /** Characters of each body sent in a broadcast; full text comes from page(). */
    public const PREVIEW_LENGTH = 200;

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
            'max_length' => 500,
            'max_submissions_per_participant' => 1,
            'profanity_filter_enabled' => true,
            ...PollSettings::defaults(),
        ];
    }

    public function validateConfig(array $config): array
    {
        $config = array_replace($this->defaultConfig(), $config);

        Validator::make($config, [
            'max_length' => ['required', 'integer', 'min:10', 'max:2000'],
            'max_submissions_per_participant' => ['required', 'integer', 'min:1', 'max:20'],
            'profanity_filter_enabled' => ['required', 'boolean'],
            ...PollSettings::rules(),
        ])->validate();

        return [
            'max_length' => (int) $config['max_length'],
            'max_submissions_per_participant' => (int) $config['max_submissions_per_participant'],
            'profanity_filter_enabled' => (bool) $config['profanity_filter_enabled'],
            ...PollSettings::normalise($config),
        ];
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        $maxLength = max(1, (int) ($config['max_length'] ?? $this->defaultConfig()['max_length']));

        Validator::make($payload, [
            'text' => ['required', 'string'],
        ])->validate();

        $body = self::clean($payload['text']);

        if ($body === '') {
            throw ValidationException::withMessages(['text' => 'The response cannot be blank.']);
        }
        if (mb_strlen($body) > $maxLength) {
            throw ValidationException::withMessages(['text' => "The response may be at most {$maxLength} characters."]);
        }

        return ['entries' => [['body' => $body, 'submitted_at' => now()->toISOString()]]];
    }

    public function allowsMultipleSubmissions(array $config): bool
    {
        return $this->maxSubmissions($config) > 1;
    }

    public function mergeSubmissions(array $previous, array $incoming, array $config): array
    {
        if (! $this->allowsMultipleSubmissions($config)) {
            return $incoming;
        }

        $entries = [...array_values($previous['entries'] ?? []), ...array_values($incoming['entries'] ?? [])];
        $max = $this->maxSubmissions($config);

        if (count($entries) > $max) {
            throw ValidationException::withMessages(['text' => "You can submit at most {$max} responses."]);
        }

        return ['entries' => $entries];
    }

    /** Broadcast-safe page 1: short bodies, at most BROADCAST_PER_PAGE cards, within the byte budget. */
    public function aggregate(array $config, array $options, Collection $answers): array
    {
        $aggregate = $this->page($config, $answers, 1, self::BROADCAST_PER_PAGE, self::PREVIEW_LENGTH);
        $items = PollText::fitBroadcastBudget($aggregate['items']);

        $aggregate['truncated'] = count($items) < count($aggregate['items'])
            || in_array(true, array_column($items, 'body_truncated'), true);
        $aggregate['items'] = $items;

        return $aggregate;
    }

    /**
     * One page of the card wall (GET /aggregate?page=N). $previewLength cuts
     * each body to that many characters; null keeps the full text.
     */
    public function page(array $config, Collection $answers, int $page, int $perPage = self::PER_PAGE, ?int $previewLength = null): array
    {
        $page = max(1, $page);
        $perPage = max(1, $perPage);
        $filter = (bool) ($config['profanity_filter_enabled'] ?? true);

        if ($answers instanceof EloquentCollection && $answers->isNotEmpty()) {
            $answers->loadMissing('participant');
        }

        $items = [];
        $responses = 0;

        foreach ($answers as $answer) {
            $entries = $answer->answer_payload['entries'] ?? null;
            if (! is_array($entries)) {
                continue;
            }

            $fallback = ($answer->submitted_at ?? $answer->created_at)?->copy()->utc();
            $emoji = $answer->relationLoaded('participant') ? $answer->participant?->emoji_avatar : null;
            $counted = false;

            foreach (array_values($entries) as $index => $entry) {
                $body = is_array($entry) ? self::clean($entry['body'] ?? '') : '';
                if ($body === '') {
                    continue;
                }

                $submittedAt = PollText::timestamp($entry['submitted_at'] ?? null) ?? $fallback;
                $counted = true;
                $items[] = [
                    'id' => $answer->id . ':' . $index,
                    'body' => $filter ? $this->profanity->mask($body) : $body,
                    'participant_emoji' => $emoji,
                    'submitted_at' => $submittedAt?->toISOString(),
                    '_sort' => [$submittedAt?->format('Y-m-d H:i:s.u') ?? '', (int) $answer->id, $index],
                ];
            }

            if ($counted) {
                $responses++;
            }
        }

        usort($items, fn (array $a, array $b) => $b['_sort'] <=> $a['_sort']);

        $total = count($items);

        return [
            'total_responses' => $responses,
            'total_entries' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'last_page' => max(1, (int) ceil($total / $perPage)),
            'truncated' => false,
            'items' => array_map(
                fn (array $item) => $this->card($item, $previewLength),
                array_slice($items, ($page - 1) * $perPage, $perPage),
            ),
        ];
    }

    /** Valid UTF-8, unified line endings, control and invisible characters removed, trimmed. Inner newlines are kept. */
    public static function clean(mixed $text): string
    {
        if (! is_string($text)) {
            return '';
        }

        $text = str_replace(["\r\n", "\r"], "\n", mb_scrub($text, 'UTF-8'));
        $text = preg_replace('/[^\P{Cc}\n\t]/u', '', $text) ?? $text;

        return trim(PollText::stripInvisible($text));
    }

    /** Public card fields; the body is cut after masking so a cut never reveals a masked word. */
    private function card(array $item, ?int $previewLength): array
    {
        $cut = $previewLength !== null && mb_strlen($item['body']) > $previewLength;

        return [
            'id' => $item['id'],
            'body' => $cut ? self::preview($item['body'], $previewLength) : $item['body'],
            'body_truncated' => $cut,
            'participant_emoji' => $item['participant_emoji'],
            'submitted_at' => $item['submitted_at'],
        ];
    }

    /**
     * At most $length code points (which bounds the bytes), cut on a grapheme
     * boundary so an emoji sequence or a conjunct is never split.
     */
    private static function preview(string $body, int $length): string
    {
        $cut = function_exists('grapheme_extract')
            ? grapheme_extract($body, $length, GRAPHEME_EXTR_MAXCHARS)
            : false;

        return rtrim(is_string($cut) ? $cut : mb_substr($body, 0, $length));
    }

    private function maxSubmissions(array $config): int
    {
        return max(1, (int) ($config['max_submissions_per_participant'] ?? $this->defaultConfig()['max_submissions_per_participant']));
    }
}
