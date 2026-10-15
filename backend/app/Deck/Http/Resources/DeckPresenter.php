<?php

namespace App\Deck\Http\Resources;

use App\Models\Deck\Deck;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Collection;

/**
 * Authoring view of a deck (camelCase). summary() for lists, detail() for
 * the editor (summary + slides + options). Owner-only (see OptionPresenter).
 */
class DeckPresenter
{
    /** Relations summary() reads. */
    public const SUMMARY_WITH = ['coverFile'];

    /** Relations detail() reads. */
    public const DETAIL_WITH = ['coverFile', 'slides.mediaFile', 'slides.options.imageFile'];

    /** Adds summary() eager loads to a list query: DeckPresenter::forSummary(Deck::query()->ownedBy($user)->forProduct($p))->paginate(). */
    public static function forSummary(Builder $query): Builder
    {
        return $query->with(self::SUMMARY_WITH)->withCount('slides');
    }

    /**
     * @return array{id:int, product:string, title:string, description:?string, coverFileId:?int, cover:?array,
     *               settings:array|object, slideCount:int, publishedAt:?string, createdAt:?string, updatedAt:?string}
     */
    public static function summary(Deck $deck): array
    {
        return [
            'id' => (int) $deck->id,
            'product' => $deck->product,
            'title' => $deck->title,
            'description' => $deck->description,
            'coverFileId' => $deck->cover_file_id,
            'cover' => MediaPresenter::file($deck->cover_file_id ? $deck->coverFile : null),
            'settings' => MediaPresenter::object($deck->settings),
            'slideCount' => self::slideCount($deck),
            'publishedAt' => MediaPresenter::iso($deck->published_at),
            'createdAt' => MediaPresenter::iso($deck->created_at),
            'updatedAt' => MediaPresenter::iso($deck->updated_at),
        ];
    }

    /** summary() + `slides` (each with `options`), in position order. */
    public static function detail(Deck $deck): array
    {
        $deck->loadMissing(self::DETAIL_WITH);

        return self::summary($deck) + [
            'slides' => SlidePresenter::collection($deck->slides),
        ];
    }

    /**
     * @param  iterable<Deck>|LengthAwarePaginator  $decks
     * @return list<array>
     */
    public static function summaries(iterable $decks): array
    {
        $items = $decks instanceof LengthAwarePaginator ? collect($decks->items()) : ($decks instanceof Collection ? $decks : collect($decks));

        if ($items instanceof EloquentCollection) {
            $items->loadMissing(self::SUMMARY_WITH);
        }

        return $items->map(fn (Deck $deck) => self::summary($deck))->values()->all();
    }

    /** {items, meta{currentPage, perPage, total, lastPage}} for a paginated list. */
    public static function page(LengthAwarePaginator $page): array
    {
        return [
            'items' => self::summaries($page),
            'meta' => [
                'currentPage' => $page->currentPage(),
                'perPage' => $page->perPage(),
                'total' => $page->total(),
                'lastPage' => $page->lastPage(),
            ],
        ];
    }

    private static function slideCount(Deck $deck): int
    {
        if (array_key_exists('slides_count', $deck->getAttributes())) {
            return (int) $deck->getAttribute('slides_count');
        }

        return $deck->relationLoaded('slides') ? $deck->slides->count() : $deck->slides()->count();
    }
}
