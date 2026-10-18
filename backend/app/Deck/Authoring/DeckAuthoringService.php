<?php

namespace App\Deck\Authoring;

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\Resources\DeckPresenter;
use App\Deck\Slides\Types\Content\ContentSlideType;
use App\Models\Deck\Deck;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

/**
 * Deck-level authoring (plan §2.1): create, list, update, soft delete and
 * duplicate. Product-neutral; the controller passes the route's product.
 */
class DeckAuthoringService
{
    /** Slide type every new deck starts with (plan §2.1). */
    public const FIRST_SLIDE_TYPE = 'qr_code';

    public const MAX_TITLE = 255;

    public const COPY_PREFIX = 'Copy of ';

    public const SORTS = ['updated' => 'updated_at', 'created' => 'created_at', 'title' => 'title'];

    public const DEFAULT_PER_PAGE = 20;

    public function __construct(
        private readonly SlideAuthoringService $slides,
        private readonly SlideInput $input,
    ) {}

    /** A new deck holding one qr_code slide (position 1), settings filled with defaults. */
    public function create(User $owner, string $product, array $data): Deck
    {
        return DB::transaction(function () use ($owner, $product, $data) {
            $deck = Deck::create([
                'owner_id' => $owner->id,
                'product' => $product,
                'title' => self::title($data['title'] ?? null) ?? 'Untitled ' . $product,
                'description' => $data['description'] ?? null,
                'settings' => DeckSettings::normalise([], $data['settings'] ?? [], $product),
            ]);

            try {
                $type = $this->input->supportedType($product, self::FIRST_SLIDE_TYPE);
            } catch (DeckException) {
                return $deck;
            }

            $this->slides->create($deck, $type, 1);

            return $deck;
        });
    }

    /**
     * $owner's decks of $product, newest change first by default.
     *
     * @param  array{search?:?string, sort?:?string, direction?:?string, per_page?:?int}  $filters
     */
    public function paginate(User $owner, string $product, array $filters): LengthAwarePaginator
    {
        $query = DeckPresenter::forSummary(Deck::query()->ownedBy($owner)->forProduct($product));

        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $query->where('decks.title', 'ILIKE', '%' . addcslashes($search, '%_\\') . '%');
        }

        $column = self::SORTS[$filters['sort'] ?? 'updated'] ?? 'updated_at';
        $direction = ($filters['direction'] ?? ($column === 'title' ? 'asc' : 'desc')) === 'asc' ? 'asc' : 'desc';

        return $query
            ->orderBy("decks.{$column}", $direction)
            ->orderBy('decks.id', $direction)
            ->paginate((int) ($filters['per_page'] ?? self::DEFAULT_PER_PAGE))
            ->withQueryString();
    }

    /**
     * title / description / settings. Settings merge onto the stored ones as
     * they are now: the deck row is re-read FOR UPDATE, so overlapping
     * partial PATCHes both land.
     */
    public function update(Deck $deck, array $data): Deck
    {
        return DB::transaction(function () use ($deck, $data) {
            $fresh = Deck::query()->whereKey($deck->id)->lockForUpdate()->first();
            if ($fresh === null) {
                throw DeckException::notFound('Deck not found.');
            }

            $changes = [];

            if (array_key_exists('title', $data)) {
                $changes['title'] = self::title($data['title']) ?? $fresh->title;
            }

            if (array_key_exists('description', $data)) {
                $changes['description'] = $data['description'];
            }

            if (array_key_exists('settings', $data)) {
                $changes['settings'] = DeckSettings::normalise($fresh->settings, (array) $data['settings'], $fresh->product);
            }

            if ($changes !== []) {
                $fresh->fill($changes)->save();
            }

            return $fresh->setRelations($deck->getRelations());
        });
    }

    /** Soft delete. Slides, sessions and My Files media are left alone. */
    public function delete(Deck $deck): void
    {
        $deck->delete();
    }

    /**
     * A full copy for the same owner: "Copy of …", unpublished, every live
     * slide (renumbered 1..n) with its options. *_file_id references are
     * copied as-is: no new files, no extra quota (plan §1.9).
     */
    public function duplicate(Deck $deck): Deck
    {
        return DB::transaction(function () use ($deck) {
            SlidePositions::lock($deck);
            $slides = $deck->slides()->with('options')->get();
            SlideAuthoringService::assertSlideCount($slides->count());

            $copy = Deck::create([
                'owner_id' => $deck->owner_id,
                'product' => $deck->product,
                'title' => mb_substr(self::COPY_PREFIX . $deck->title, 0, self::MAX_TITLE),
                'description' => $deck->description,
                'cover_file_id' => $deck->cover_file_id,
                'settings' => DeckSettings::normalise($deck->settings, [], $deck->product),
            ]);

            $position = 0;
            foreach ($slides as $slide) {
                $this->slides->copy($slide, $copy->id, ++$position);
            }

            return $copy;
        });
    }

    /** Single-line title, or null when blank. */
    private static function title(?string $title): ?string
    {
        if ($title === null) {
            return null;
        }

        $clean = mb_substr(ContentSlideType::sanitize($title), 0, self::MAX_TITLE);

        return $clean === '' ? null : $clean;
    }
}
