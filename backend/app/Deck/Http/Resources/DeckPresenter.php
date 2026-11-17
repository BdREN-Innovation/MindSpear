<?php

namespace App\Deck\Http\Resources;

use App\Models\Deck\Deck;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Collection;

/**
 * Authoring view of a deck (camelCase). summary() for lists, detail() for
 * the editor (summary + slides + options). Owner-only (see OptionPresenter),
 * except for public decks: Discover shows publicSummary() / publicDetail()
 * to any signed-in user, who could copy the whole deck anyway.
 */
class DeckPresenter
{
    /** Relations summary() reads. */
    public const SUMMARY_WITH = ['coverFile'];

    /** Relations detail() reads. */
    public const DETAIL_WITH = ['coverFile', 'slides.mediaFile', 'slides.options.imageFile'];

    /** Relations publicSummary() reads on top of SUMMARY_WITH. */
    public const PUBLIC_WITH = ['owner:id,first_name,last_name,profile_picture'];

    /** Adds summary() eager loads to a list query: DeckPresenter::forSummary(Deck::query()->ownedBy($user)->forProduct($p))->paginate(). */
    public static function forSummary(Builder $query): Builder
    {
        return $query->with(self::SUMMARY_WITH)->withCount('slides');
    }

    /** forSummary() plus what publicSummary() reads (creator, copies_count). */
    public static function forPublic(Builder $query): Builder
    {
        return self::forSummary($query)->with(self::PUBLIC_WITH)->withCount('copies');
    }

    /**
     * @return array{id:int, product:string, title:string, description:?string, coverFileId:?int, cover:?array,
     *               settings:array|object, visibility:string, slideCount:int, publishedAt:?string, createdAt:?string, updatedAt:?string}
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
            'visibility' => $deck->visibility ?? Deck::VISIBILITY_PRIVATE,
            'slideCount' => self::slideCount($deck),
            'publishedAt' => MediaPresenter::iso($deck->published_at),
            'createdAt' => MediaPresenter::iso($deck->created_at),
            'updatedAt' => MediaPresenter::iso($deck->updated_at),
        ];
    }

    /**
     * A Discover card: summary() + `creator` {id, name, avatar}, `copyCount`
     * (live copies made from it) and `isMine`.
     */
    public static function publicSummary(Deck $deck, ?User $viewer = null): array
    {
        $deck->loadMissing(self::PUBLIC_WITH);
        $owner = $deck->owner;

        return self::summary($deck) + [
            'creator' => $owner ? [
                'id' => (int) $owner->id,
                'name' => trim((string) $owner->full_name) ?: 'MindSpear user',
                'avatar' => $owner->profile_picture ?: null,
            ] : null,
            'copyCount' => array_key_exists('copies_count', $deck->getAttributes())
                ? (int) $deck->getAttribute('copies_count')
                : $deck->copies()->count(),
            'isMine' => $viewer !== null && (int) $deck->owner_id === (int) $viewer->id,
        ];
    }

    /** publicSummary() + `slides` (each with `options`), for the Discover preview. */
    public static function publicDetail(Deck $deck, ?User $viewer = null): array
    {
        $deck->loadMissing(self::DETAIL_WITH);

        return self::publicSummary($deck, $viewer) + [
            'slides' => SlidePresenter::collection($deck->slides),
        ];
    }

    /** page() of publicSummary() items. */
    public static function publicPage(LengthAwarePaginator $page, ?User $viewer = null): array
    {
        return [
            'items' => collect($page->items())->map(fn (Deck $deck) => self::publicSummary($deck, $viewer))->values()->all(),
            'meta' => self::meta($page),
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
            'meta' => self::meta($page),
        ];
    }

    /** @return array{currentPage:int, perPage:int, total:int, lastPage:int} */
    private static function meta(LengthAwarePaginator $page): array
    {
        return [
            'currentPage' => $page->currentPage(),
            'perPage' => $page->perPage(),
            'total' => $page->total(),
            'lastPage' => $page->lastPage(),
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
