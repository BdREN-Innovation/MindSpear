<?php

namespace App\Deck\Slides\Types\Quiz;

use App\Deck\Slides\Types\Quest\PollOptions;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Correct order (scored): drag the items into the right order.
 *
 * Config:  {} (the session snapshot adds `scoring`).
 * Options: the items (3–8), label and/or image. The author order (option
 *          position) is the correct order. 4 empty items seeded.
 * Slide defaults: 30 s, 50/100 points, speed bonus on.
 *
 * Participant view: options carry an opaque `id` (QuizOptions::key, per
 *   run), payload {}, in a keyed per-participant shuffle (QuizOptions::shuffle;
 *   any order, the correct one included, is equally likely). `position` is
 *   the display index.
 *
 * Answer payload (in / stored): {order: list<key>} every item key exactly once, first = top.
 *
 * Score: exact order = full points; else points * (items_in_correct_position / total).
 *
 * Aggregate (+ AbstractQuizType fields):
 *   {items: [{id, correct_position (1-based), correct_count, correct_percentage}, ...] in correct order,
 *    most_common_order: {order: list<key>, count, tied: bool} | null (ties:
 *      the smallest key sequence, so it is deterministic; tied is true when
 *      two or more different orders share the top count, so the presenter
 *      need not call one of them "most common"),
 *    correct: {order: list<key>}}
 */
class CorrectOrderSlideType extends AbstractQuizType
{
    public const KEY = 'correct_order';

    public const DEFAULT_TIME_LIMIT = 30;

    public function key(): string
    {
        return self::KEY;
    }

    public function defaultOptions(): array
    {
        return array_fill(0, 4, ['label' => null, 'payload' => []]);
    }

    public function validateConfig(array $config): array
    {
        return [];
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        $order = $this->answerKey($config, $options)['order'];
        PollOptions::assertListAtMost($payload, 'order', count($order));

        Validator::make($payload, [
            'order' => ['required', 'array', 'list', 'min:1'],
            'order.*' => ['required', 'string', 'distinct', Rule::in($order)],
        ])->validate();

        if (count($payload['order']) !== count($order)) {
            throw ValidationException::withMessages(['order' => 'Put every item in order.']);
        }

        return ['order' => array_map('strval', $payload['order'])];
    }

    public function correctAnswer(array $config, array $options): array
    {
        return ['order' => $this->answerKey($config, $options)['order']];
    }

    /** @return array{order: list<string>} item keys in the correct (author) order */
    protected function answerKey(array $config, array $options): array
    {
        return ['order' => array_values(array_unique(array_map(
            fn (array $option) => QuizOptions::key($option['id'], $config),
            QuizOptions::sorted($options),
        )))];
    }

    protected function judge(array $payload, array $key): ?Evaluation
    {
        $order = $payload['order'] ?? null;
        if (! is_array($order) || ! array_is_list($order)) {
            return null;
        }

        return Evaluation::ratio(self::hits($order, $key['order']), count($key['order']));
    }

    protected function breakdown(array $config, array $options, array $key, array $payloads): array
    {
        $correct = array_fill(0, count($key['order']), 0);
        $orders = [];

        foreach ($payloads as $payload) {
            foreach ($key['order'] as $index => $id) {
                if (($payload['order'][$index] ?? null) === $id) {
                    $correct[$index]++;
                }
            }

            $submitted = array_values(array_filter($payload['order'], 'is_string'));
            $signature = implode(',', $submitted);
            $orders[$signature] ??= ['order' => $submitted, 'count' => 0];
            $orders[$signature]['count']++;
        }

        $mostCommon = null;
        foreach ($orders as $signature => $entry) {
            if ($mostCommon === null || $entry['count'] > $mostCommon[1]['count']
                || ($entry['count'] === $mostCommon[1]['count'] && strcmp((string) $signature, $mostCommon[0]) < 0)) {
                $mostCommon = [(string) $signature, $entry];
            }
        }

        if ($mostCommon !== null) {
            $top = $mostCommon[1]['count'];
            $mostCommon[1]['tied'] = count(array_filter($orders, fn (array $entry) => $entry['count'] === $top)) > 1;
        }

        $responses = count($payloads);
        $items = [];
        foreach ($key['order'] as $index => $id) {
            $items[] = [
                'id' => $id,
                'correct_position' => $index + 1,
                'correct_count' => $correct[$index],
                'correct_percentage' => QuizOptions::percentage($correct[$index], $responses),
            ];
        }

        return ['items' => $items, 'most_common_order' => $mostCommon[1] ?? null];
    }

    /** The items in the keyed order of this run and participant. */
    protected function displayOptions(DeckSessionSlideRun $run, ?int $participantId = null): array
    {
        return QuizOptions::shuffle(QuizOptions::sorted($run->options_snapshot ?? []), (int) $run->id, $participantId);
    }

    protected function publicId(array $option, array $config): int|string
    {
        return QuizOptions::key((int) $option['id'], $config);
    }

    protected function participantPayload(array $option, array $public): array
    {
        return [];
    }

    /** Items of $order in their correct slot. */
    private static function hits(array $order, array $correct): int
    {
        $hits = 0;
        foreach ($correct as $index => $id) {
            if (($order[$index] ?? null) === $id) {
                $hits++;
            }
        }

        return $hits;
    }
}
