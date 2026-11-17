<?php

namespace App\Deck\Authoring;

use App\Models\Deck\Deck;
use App\Models\Deck\Slide;
use Illuminate\Support\Facades\DB;

/**
 * Position bookkeeping for a deck's live (non-deleted) slides. Positions are
 * 1-based and contiguous, and unique per deck only among live slides
 * (partial unique index `slides_deck_id_position_unique`); soft-deleted
 * slides keep whatever position they had and are never touched here.
 *
 * PostgreSQL checks a non-deferrable unique index row by row inside one
 * UPDATE, so `position = position + 1` can collide mid-statement. Every
 * move therefore stages the affected rows at negative positions first and
 * flips them back in a second statement (plan §1.1).
 *
 * Call these inside a transaction after lock(): the deck row lock
 * serialises every position change of one deck.
 */
final class SlidePositions
{
    /** Locks the deck row until the transaction ends. */
    public static function lock(Deck $deck): void
    {
        Deck::withTrashed()->whereKey($deck->getKey())->lockForUpdate()->value('id');
    }

    /** Highest live position (0 for an empty deck). */
    public static function max(int $deckId): int
    {
        return (int) self::live($deckId)->max('position');
    }

    /**
     * Frees $count positions right after $after (null or past the end =
     * append) by moving later slides down. Returns the first free position.
     */
    public static function open(int $deckId, ?int $after, int $count): int
    {
        $max = self::max($deckId);
        $after = $after === null ? $max : max(0, min($after, $max));

        if ($count > 0 && $after < $max) {
            self::live($deckId)->where('position', '>', $after)->update(['position' => DB::raw('-(position + ' . (int) $count . ')')]);
            self::flip($deckId);
        }

        return $after + 1;
    }

    /** Closes the gap a removed slide left at $position. */
    public static function close(int $deckId, int $position): void
    {
        if (self::live($deckId)->where('position', '>', $position)->exists()) {
            self::live($deckId)->where('position', '>', $position)->update(['position' => DB::raw('-(position - 1)')]);
            self::flip($deckId);
        }
    }

    /**
     * Sets every live slide's position from $positions (slide id => new
     * position). The map must cover exactly the deck's live slides with
     * distinct positions; callers check that.
     *
     * @param  array<int, int>  $positions
     */
    public static function apply(int $deckId, array $positions): void
    {
        if ($positions === []) {
            return;
        }

        self::live($deckId)->update(['position' => DB::raw('-position')]);

        $cases = [];
        $bindings = [];
        foreach ($positions as $id => $position) {
            $cases[] = 'WHEN ? THEN CAST(? AS integer)';
            array_push($bindings, (int) $id, (int) $position);
        }

        $ids = array_map('intval', array_keys($positions));

        DB::update(
            'UPDATE slides SET position = CASE id ' . implode(' ', $cases) . ' END, updated_at = ?'
            . ' WHERE deck_id = ? AND deleted_at IS NULL AND position < 0 AND id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')',
            [...$bindings, now(), $deckId, ...$ids],
        );
    }

    /** @return list<array{id:int, position:int}> live slides in order */
    public static function order(int $deckId): array
    {
        return self::live($deckId)
            ->orderBy('position')
            ->orderBy('id')
            ->get(['id', 'position'])
            ->map(fn (Slide $slide) => ['id' => (int) $slide->id, 'position' => (int) $slide->position])
            ->all();
    }

    /** Second half of a staged move: negative (staged) positions back to positive. */
    private static function flip(int $deckId): void
    {
        self::live($deckId)->where('position', '<', 0)->update(['position' => DB::raw('-position')]);
    }

    private static function live(int $deckId)
    {
        // The SoftDeletes scope keeps soft-deleted slides out.
        return Slide::query()->where('deck_id', $deckId);
    }
}
