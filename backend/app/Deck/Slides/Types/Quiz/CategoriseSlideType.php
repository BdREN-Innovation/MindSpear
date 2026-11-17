<?php

namespace App\Deck\Slides\Types\Quiz;

use App\Deck\Slides\Types\Content\ContentSlideType;
use App\Deck\Slides\Types\Quest\PollOptions;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * Categorise (scored): drag each item into its category.
 *
 * Config:  {categories: [{key: string (QuizOptions::KEY_PATTERN), label: ?string (<= 100)}, ...]}
 *          2–5 categories, distinct keys; 2 empty ones (c1, c2) seeded.
 * Options: the items (4–20), label and/or image, payload
 *          {correct_category_key: string} naming one of the categories.
 *          Items whose key names no category are ignored (not shown, not
 *          scored). 4 empty items seeded (c1, c1, c2, c2).
 * Slide defaults: 45 s, 50/100 points, speed bonus on.
 *
 * Participant view: config.categories as authored (public); options = the
 *   items with an opaque `id` (QuizOptions::key, per run), payload {} (no
 *   correct_category_key), in a keyed per-participant shuffle
 *   (QuizOptions::shuffle).
 *
 * Answer payload (in / stored): {placements: [{item_id: key, category_key: string}, ...]}
 *   1..item count entries, each item at most once; unplaced items count as
 *   wrong. Stored in the participant's order.
 *
 * Score: points * (items_in_correct_category / total_items); fully correct when all are.
 *
 * Aggregate (+ AbstractQuizType fields):
 *   {category_keys: list<string> (config order),
 *    items: [{id, correct_category_key, correct_count, correct_percentage,
 *             category_counts: list<int> (placements per category, aligned with category_keys)}, ...]
 *      in author order,
 *    correct: {categories: [{key, item_ids: list<key>}, ...]}}
 */
class CategoriseSlideType extends AbstractQuizType
{
    public const KEY = 'categorise';

    public const DEFAULT_TIME_LIMIT = 45;

    public const MIN_CATEGORIES = 2;

    public const MAX_CATEGORIES = 5;

    public const MAX_CATEGORY_LABEL = 100;

    public function key(): string
    {
        return self::KEY;
    }

    public function defaultConfig(): array
    {
        return ['categories' => [['key' => 'c1', 'label' => null], ['key' => 'c2', 'label' => null]]];
    }

    public function defaultOptions(): array
    {
        return array_map(
            fn (string $category) => ['label' => null, 'payload' => ['correct_category_key' => $category]],
            ['c1', 'c1', 'c2', 'c2'],
        );
    }

    public function validateConfig(array $config): array
    {
        $config = array_replace($this->defaultConfig(), $config);

        Validator::make($config, [
            'categories' => ['required', 'array', 'list', 'min:' . self::MIN_CATEGORIES, 'max:' . self::MAX_CATEGORIES],
            'categories.*' => ['required', 'array'],
            'categories.*.key' => ['required', 'string', 'distinct', 'regex:' . QuizOptions::KEY_PATTERN],
            'categories.*.label' => ['nullable', 'string', 'max:' . self::MAX_CATEGORY_LABEL],
        ])->validate();

        return ['categories' => array_map(function (array $category) {
            $label = isset($category['label']) ? ContentSlideType::sanitize((string) $category['label']) : '';

            return ['key' => $category['key'], 'label' => $label === '' ? null : $label];
        }, $config['categories'])];
    }

    /**
     * Normalised option payload (optional authoring hook).
     *
     * @throws \Illuminate\Validation\ValidationException
     */
    public function validateOptionPayload(array $payload): array
    {
        Validator::make($payload, [
            'correct_category_key' => ['required', 'string', 'regex:' . QuizOptions::KEY_PATTERN],
        ])->validate();

        return ['correct_category_key' => $payload['correct_category_key']];
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        $key = $this->answerKey($config, $options);
        PollOptions::assertListAtMost($payload, 'placements', count($key['items']));

        Validator::make($payload, [
            'placements' => ['required', 'array', 'list', 'min:1'],
            'placements.*' => ['required', 'array'],
            'placements.*.item_id' => ['required', 'string', 'distinct', Rule::in(array_keys($key['items']))],
            'placements.*.category_key' => ['required', 'string', Rule::in($key['categories'])],
        ])->validate();

        return ['placements' => array_map(fn (array $placement) => [
            'item_id' => (string) $placement['item_id'],
            'category_key' => (string) $placement['category_key'],
        ], $payload['placements'])];
    }

    public function correctAnswer(array $config, array $options): array
    {
        $key = $this->answerKey($config, $options);

        return ['categories' => array_map(fn (string $category) => [
            'key' => $category,
            'item_ids' => array_keys(array_filter($key['items'], fn (string $correct) => $correct === $category)),
        ], $key['categories'])];
    }

    /**
     * @return array{categories: list<string>, items: array<string, string>, options: list<array>}
     *                                                                                             items: opaque item key => correct category key, author order; options: those items
     */
    protected function answerKey(array $config, array $options): array
    {
        $categories = [];
        foreach (is_array($config['categories'] ?? null) ? $config['categories'] : [] as $category) {
            $key = is_array($category) ? QuizOptions::authorKey($category['key'] ?? null) : null;
            if ($key !== null && ! in_array($key, $categories, true)) {
                $categories[] = $key;
            }
        }

        $items = [];
        $itemOptions = [];
        foreach (QuizOptions::sorted($options) as $option) {
            $category = QuizOptions::authorKey($option['payload']['correct_category_key'] ?? null);
            if ($category !== null && in_array($category, $categories, true)) {
                $items[QuizOptions::key($option['id'], $config)] = $category;
                $itemOptions[] = $option;
            }
        }

        return ['categories' => $categories, 'items' => $items, 'options' => $itemOptions];
    }

    protected function judge(array $payload, array $key): ?Evaluation
    {
        $placements = self::placements($payload, $key);
        if ($placements === null) {
            return null;
        }

        $hits = 0;
        foreach ($placements as $item => $category) {
            if ($key['items'][$item] === $category) {
                $hits++;
            }
        }

        return Evaluation::ratio($hits, count($key['items']));
    }

    protected function breakdown(array $config, array $options, array $key, array $payloads): array
    {
        $slot = array_flip($key['categories']);
        $counts = array_map(fn () => array_fill(0, count($key['categories']), 0), $key['items']);
        $correct = array_map(fn () => 0, $key['items']);

        foreach ($payloads as $payload) {
            foreach (self::placements($payload, $key) ?? [] as $item => $category) {
                $counts[$item][$slot[$category]]++;
                if ($key['items'][$item] === $category) {
                    $correct[$item]++;
                }
            }
        }

        $responses = count($payloads);
        $items = [];
        foreach ($key['items'] as $item => $category) {
            $items[] = [
                'id' => $item,
                'correct_category_key' => $category,
                'correct_count' => $correct[$item],
                'correct_percentage' => QuizOptions::percentage($correct[$item], $responses),
                'category_counts' => $counts[$item],
            ];
        }

        return ['category_keys' => $key['categories'], 'items' => $items];
    }

    /** The scorable items in the keyed order of this run and participant. */
    protected function displayOptions(DeckSessionSlideRun $run, ?int $participantId = null): array
    {
        $items = $this->answerKey($run->config_snapshot ?? [], $run->options_snapshot ?? [])['options'];

        return QuizOptions::shuffle($items, (int) $run->id, $participantId);
    }

    protected function publicId(array $option, array $config): int|string
    {
        return QuizOptions::key((int) $option['id'], $config);
    }

    protected function participantPayload(array $option, array $public): array
    {
        return [];
    }

    /**
     * Known placements of a payload (item key => category key; first
     * placement of an item wins); null when the payload has no placement list.
     *
     * @return array<string, string>|null
     */
    private static function placements(array $payload, array $key): ?array
    {
        $placements = $payload['placements'] ?? null;
        if (! is_array($placements)) {
            return null;
        }

        $known = [];
        foreach ($placements as $placement) {
            $item = is_array($placement) ? ($placement['item_id'] ?? null) : null;
            $category = is_array($placement) ? ($placement['category_key'] ?? null) : null;

            if (is_string($item) && is_string($category) && isset($key['items'][$item])
                && in_array($category, $key['categories'], true) && ! isset($known[$item])) {
                $known[$item] = $category;
            }
        }

        return $known;
    }
}
