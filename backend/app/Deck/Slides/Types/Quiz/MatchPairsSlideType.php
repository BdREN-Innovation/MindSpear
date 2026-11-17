<?php

namespace App\Deck\Slides\Types\Quiz;

use App\Deck\Slides\Types\Quest\PollOptions;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * Match pairs (scored): connect each left item to its right item.
 *
 * Config:  {} (the session snapshot adds `scoring`).
 * Options: one option per cell (label and/or image), payload
 *          {side: 'left'|'right', pair_key: string (QuizOptions::KEY_PATTERN)}.
 *          A pair = the left and the right option sharing a pair_key; a
 *          pair_key without exactly one left and one right is ignored (its
 *          options are not shown or scored). 2–8 pairs = 4–16 options;
 *          3 empty pairs seeded as left p1, right p1, left p2, right p2, ...
 * Slide defaults: 45 s, 50/100 points, speed bonus on.
 *
 * Participant view: options carry an opaque `id` (QuizOptions::key, per
 *   run) and payload {side} only (no pair_key). Left cells first, in author
 *   order, then the right cells in a keyed per-participant shuffle
 *   (QuizOptions::shuffle; every order equally likely, aligned included).
 *
 * Answer payload (in / stored): {pairs: [{left_id: key, right_id: key}, ...]}
 *   1..pair count entries, each left_id and right_id an opaque key of that
 *   side, each used at most once. Unmatched cells are allowed. Stored in the
 *   participant's order.
 *
 * Score: points * (correct_pairs / total_pairs); fully correct when all match.
 *
 * Aggregate (+ AbstractQuizType fields):
 *   {pairs: [{left_id, right_id, correct_count, correct_percentage}, ...] in left order,
 *    connection_counts: list<list<int>> — [i][j] = responses that connected
 *      pairs[i].left_id to pairs[j].right_id (the diagonal is the correct
 *      ones); a matrix rather than a list of rows keeps 8 pairs × 8 within
 *      a few hundred bytes of the reveal broadcast,
 *    correct: {pairs: [{left_id, right_id}, ...]}}
 */
class MatchPairsSlideType extends AbstractQuizType
{
    public const KEY = 'match_pairs';

    public const DEFAULT_TIME_LIMIT = 45;

    public const SIDES = ['left', 'right'];

    public function key(): string
    {
        return self::KEY;
    }

    public function defaultOptions(): array
    {
        $options = [];
        foreach (['p1', 'p2', 'p3'] as $pair) {
            $options[] = ['label' => null, 'payload' => ['side' => 'left', 'pair_key' => $pair]];
            $options[] = ['label' => null, 'payload' => ['side' => 'right', 'pair_key' => $pair]];
        }

        return $options;
    }

    public function validateConfig(array $config): array
    {
        return [];
    }

    /**
     * Normalised option payload (optional authoring hook).
     *
     * @throws \Illuminate\Validation\ValidationException
     */
    public function validateOptionPayload(array $payload): array
    {
        Validator::make($payload, [
            'side' => ['required', 'string', Rule::in(self::SIDES)],
            'pair_key' => ['required', 'string', 'regex:' . QuizOptions::KEY_PATTERN],
        ])->validate();

        return ['side' => $payload['side'], 'pair_key' => $payload['pair_key']];
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        $key = $this->answerKey($config, $options);
        PollOptions::assertListAtMost($payload, 'pairs', count($key['pairs']));

        Validator::make($payload, [
            'pairs' => ['required', 'array', 'list', 'min:1'],
            'pairs.*' => ['required', 'array'],
            'pairs.*.left_id' => ['required', 'string', 'distinct', Rule::in(array_keys($key['left']))],
            'pairs.*.right_id' => ['required', 'string', 'distinct', Rule::in(array_keys($key['right']))],
        ])->validate();

        return ['pairs' => array_map(fn (array $pair) => [
            'left_id' => (string) $pair['left_id'],
            'right_id' => (string) $pair['right_id'],
        ], $payload['pairs'])];
    }

    public function correctAnswer(array $config, array $options): array
    {
        return ['pairs' => array_map(
            fn (array $pair) => ['left_id' => $pair['left_id'], 'right_id' => $pair['right_id']],
            $this->answerKey($config, $options)['pairs'],
        )];
    }

    /**
     * @return array{pairs: list<array{pair_key:string, left:array, right:array, left_id:string, right_id:string}>,
     *               left: array<string, string>, right: array<string, string>}
     *         left / right: opaque key => pair_key, in author order
     */
    protected function answerKey(array $config, array $options): array
    {
        $cells = ['left' => [], 'right' => []];
        foreach (QuizOptions::sorted($options) as $option) {
            $side = $option['payload']['side'] ?? null;
            $pair = QuizOptions::authorKey($option['payload']['pair_key'] ?? null);
            if ($pair !== null && in_array($side, self::SIDES, true)) {
                $cells[$side]['p:' . $pair][] = $option;
            }
        }

        $pairs = [];
        $left = [];
        $right = [];
        foreach ($cells['left'] as $group => $lefts) {
            $rights = $cells['right'][$group] ?? [];
            if (count($lefts) !== 1 || count($rights) !== 1) {
                continue;
            }

            $pair = substr($group, 2);
            $leftId = QuizOptions::key($lefts[0]['id'], $config);
            $rightId = QuizOptions::key($rights[0]['id'], $config);
            $pairs[] = ['pair_key' => $pair, 'left' => $lefts[0], 'right' => $rights[0], 'left_id' => $leftId, 'right_id' => $rightId];
            $left[$leftId] = $pair;
            $right[$rightId] = $pair;
        }

        return ['pairs' => $pairs, 'left' => $left, 'right' => $right];
    }

    protected function judge(array $payload, array $key): ?Evaluation
    {
        $connections = self::connections($payload, $key);
        if ($connections === null) {
            return null;
        }

        $hits = 0;
        foreach ($connections as [$left, $right]) {
            if ($key['left'][$left] === $key['right'][$right]) {
                $hits++;
            }
        }

        return Evaluation::ratio($hits, count($key['pairs']));
    }

    protected function breakdown(array $config, array $options, array $key, array $payloads): array
    {
        $row = array_flip(array_column($key['pairs'], 'left_id'));
        $column = array_flip(array_column($key['pairs'], 'right_id'));
        $size = count($key['pairs']);
        $matrix = array_fill(0, $size, $size > 0 ? array_fill(0, $size, 0) : []);

        foreach ($payloads as $payload) {
            foreach (self::connections($payload, $key) ?? [] as [$left, $right]) {
                if (isset($row[$left], $column[$right])) {
                    $matrix[$row[$left]][$column[$right]]++;
                }
            }
        }

        $responses = count($payloads);

        return [
            'pairs' => array_map(fn (array $pair, int $index) => [
                'left_id' => $pair['left_id'],
                'right_id' => $pair['right_id'],
                'correct_count' => $matrix[$index][$index] ?? 0,
                'correct_percentage' => QuizOptions::percentage($matrix[$index][$index] ?? 0, $responses),
            ], $key['pairs'], array_keys($key['pairs'])),
            'connection_counts' => $matrix,
        ];
    }

    /** Left cells in author order, then the right cells in the keyed order of this run and participant. */
    protected function displayOptions(DeckSessionSlideRun $run, ?int $participantId = null): array
    {
        $pairs = $this->answerKey($run->config_snapshot ?? [], $run->options_snapshot ?? [])['pairs'];

        return [
            ...array_column($pairs, 'left'),
            ...QuizOptions::shuffle(array_column($pairs, 'right'), (int) $run->id, $participantId),
        ];
    }

    protected function publicId(array $option, array $config): int|string
    {
        return QuizOptions::key((int) $option['id'], $config);
    }

    protected function participantPayload(array $option, array $public): array
    {
        return ['side' => $option['payload']['side']];
    }

    /**
     * Known connections of a payload, each left and right used once (first
     * wins); null when the payload has no pair list.
     *
     * @return list<array{0:string, 1:string}>|null
     */
    private static function connections(array $payload, array $key): ?array
    {
        $pairs = $payload['pairs'] ?? null;
        if (! is_array($pairs)) {
            return null;
        }

        $usedLeft = [];
        $usedRight = [];
        $connections = [];
        foreach ($pairs as $pair) {
            $left = is_array($pair) ? ($pair['left_id'] ?? null) : null;
            $right = is_array($pair) ? ($pair['right_id'] ?? null) : null;

            if (! is_string($left) || ! is_string($right) || ! isset($key['left'][$left], $key['right'][$right])
                || isset($usedLeft[$left]) || isset($usedRight[$right])) {
                continue;
            }

            $usedLeft[$left] = true;
            $usedRight[$right] = true;
            $connections[] = [$left, $right];
        }

        return $connections;
    }
}
