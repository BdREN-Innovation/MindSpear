<?php

namespace App\Deck\Slides\Types\Quiz;

/**
 * Pure helpers over a run's options_snapshot shared by the Quiz types. Not a
 * slide type, so discovery skips it.
 *
 * Opaque keys: match_pairs, correct_order and categorise show their options
 * to participants under an opaque key instead of the option id. Option ids
 * grow in creation order, and authors usually create items in the correct
 * order (or pair by pair, or category by category), so ids sorted would give
 * the answer away. key() is
 *   'k' . first 12 hex of HMAC-SHA256(app.key, "deck-quiz-option:{salt}:{option_id}")
 * where salt = config_snapshot._key_salt, 32 random hex characters the
 * session launcher draws for every run (SessionLauncher::snapshot). So a key
 * is stable within one run, different on every run and every session of the
 * same deck, and unguessable without app.key; the `_` prefix keeps the salt
 * out of every participant and presenter view (AbstractSlideType::publicConfig).
 * Runs snapshotted before the salt existed have none and keep the old
 * per-option key ("deck-quiz-option:{option_id}"), so their stored answers
 * still match. Those types take answers, store answers and report aggregates
 * in keys.
 *
 * Display order (shuffle()): each option is ranked by
 *   HMAC-SHA256(app.key, "{run_id}:{participant_id}:{option_id}")
 * (participant_id empty for the run-level order the presenter and public
 * broadcasts use) and the options are sorted by rank. Ranks are independent
 * uniform 256-bit values, so every permutation is equally likely (the
 * correct order included: there is no "never the given order" rule, which
 * leaked the answer for 2 and 3 items), each participant gets an order of
 * their own, and nobody can recompute an order without app.key even though
 * run and option ids are public.
 */
final class QuizOptions
{
    /** Author-chosen keys (pair_key, category keys): a letter, then letters, digits, '_' or '-'. */
    public const KEY_PATTERN = '/^[A-Za-z][A-Za-z0-9_-]{0,31}$/';

    /** config_snapshot key of a run's opaque-key salt (`_`: never in a participant or presenter view). */
    public const KEY_SALT = '_key_salt';

    /**
     * Options in display order (position, then id), each with an int id.
     *
     * @return list<array>
     */
    public static function sorted(array $options): array
    {
        $options = array_values(array_filter($options, 'is_array'));

        usort($options, fn (array $a, array $b) => [(int) ($a['position'] ?? 0), (int) ($a['id'] ?? 0)]
            <=> [(int) ($b['position'] ?? 0), (int) ($b['id'] ?? 0)]);

        return array_map(fn (array $option) => ['id' => (int) ($option['id'] ?? 0)] + $option, $options);
    }

    /** @return list<int> distinct option ids in display order */
    public static function ids(array $options): array
    {
        return array_values(array_unique(array_column(self::sorted($options), 'id')));
    }

    /**
     * Whether an option is marked correct: the slide_options.is_correct
     * column; when that is null, a boolean `is_correct` in the payload (the
     * only way the label/payload-only bulk endpoint can mark one).
     */
    public static function isCorrect(array $option): bool
    {
        $column = $option['is_correct'] ?? null;
        if ($column !== null) {
            return (bool) $column;
        }

        return ($option['payload']['is_correct'] ?? null) === true;
    }

    /** @return list<int> ids of the correct options, in display order */
    public static function correctIds(array $options): array
    {
        $ids = [];
        foreach (self::sorted($options) as $option) {
            if (self::isCorrect($option)) {
                $ids[] = $option['id'];
            }
        }

        return array_values(array_unique($ids));
    }

    /**
     * The participant-facing opaque key of option $id on the run whose
     * config_snapshot is $config (its KEY_SALT; see the class docblock).
     */
    public static function key(int $id, array $config = []): string
    {
        $salt = self::salt($config);
        $message = $salt === null ? 'deck-quiz-option:' . $id : "deck-quiz-option:{$salt}:{$id}";

        return 'k' . substr(hash_hmac('sha256', $message, self::secret()), 0, 12);
    }

    /** A run's opaque-key salt, or null for a run snapshotted before salts existed. */
    public static function salt(array $config): ?string
    {
        $salt = $config[self::KEY_SALT] ?? null;

        return is_string($salt) && $salt !== '' ? $salt : null;
    }

    /** A fresh salt for a new run (SessionLauncher). */
    public static function newSalt(): string
    {
        return bin2hex(random_bytes(16));
    }

    /**
     * Options keyed by their opaque key on the run of $config, display order
     * kept (the first option wins if two ever shared a key).
     *
     * @return array<string, array>
     */
    public static function byKey(array $options, array $config = []): array
    {
        $byKey = [];
        foreach (self::sorted($options) as $option) {
            $byKey[self::key($option['id'], $config)] ??= $option;
        }

        return $byKey;
    }

    /**
     * $options in the keyed order of run $runId for $participantId (null =
     * the run-level order): sorted by HMAC-SHA256(app.key,
     * "{run_id}:{participant_id}:{option_id}"), ties (never in practice) by
     * id. Deterministic for the same run and participant, unbiased, and not
     * recomputable without app.key (class docblock).
     *
     * @param  list<array>  $options  each with an int `id`
     * @return list<array>
     */
    public static function shuffle(array $options, int $runId, ?int $participantId = null): array
    {
        $secret = self::secret();
        $ranked = [];
        foreach (array_values($options) as $option) {
            $id = (int) $option['id'];
            $ranked[] = [hash_hmac('sha256', "{$runId}:{$participantId}:{$id}", $secret), $id, $option];
        }

        usort($ranked, fn (array $a, array $b) => [$a[0], $a[1]] <=> [$b[0], $b[1]]);

        return array_column($ranked, 2);
    }

    /**
     * Plain values (fill_blanks dropdown choices) in an order keyed by
     * $seed: sorted by HMAC-SHA256(app.key, "{seed}:{index}:{value}"), so the
     * same seed always gives the same order and nobody can recompute it
     * without app.key. Seed with the run's KEY_SALT for an order per run.
     *
     * @param  list<string>  $values
     * @return list<string>
     */
    public static function shuffleValues(array $values, string $seed): array
    {
        $secret = self::secret();
        $ranked = [];
        foreach (array_values($values) as $index => $value) {
            $ranked[] = [hash_hmac('sha256', "{$seed}:{$index}:{$value}", $secret), $index, $value];
        }

        usort($ranked, fn (array $a, array $b) => [$a[0], $a[1]] <=> [$b[0], $b[1]]);

        return array_column($ranked, 2);
    }

    /** An author key (pair_key, category key) or null when it is not one. */
    public static function authorKey(mixed $value): ?string
    {
        return is_string($value) && preg_match(self::KEY_PATTERN, $value) ? $value : null;
    }

    /** The HMAC secret: app.key (a fixed fallback only where no key is configured). */
    private static function secret(): string
    {
        $secret = (string) config('app.key');

        return $secret !== '' ? $secret : 'deck-quiz';
    }

    public static function percentage(int|float $part, int|float $whole): float
    {
        return $whole > 0 ? round($part / $whole * 100, 2) : 0.0;
    }

    /**
     * Option count rows of the pick_answer aggregates.
     *
     * @param  array<int, int>  $counts  option id => count, in option order
     * @param  array<int, mixed>  $correct  correct option ids as keys
     * @return list<array{option_id:int, count:int, percentage:float, is_correct:bool}>
     */
    public static function countRows(array $counts, array $correct, int $responses): array
    {
        $rows = [];
        foreach ($counts as $id => $count) {
            $rows[] = [
                'option_id' => $id,
                'count' => $count,
                'percentage' => self::percentage($count, $responses),
                'is_correct' => isset($correct[$id]),
            ];
        }

        return $rows;
    }
}
