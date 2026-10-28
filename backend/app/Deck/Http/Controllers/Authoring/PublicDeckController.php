<?php

namespace App\Deck\Http\Controllers\Authoring;

use App\Deck\Authoring\DeckAuthoringService;
use App\Deck\Exceptions\DeckException;
use App\Deck\Http\Controllers\DeckController;
use App\Deck\Http\DeckRoutes;
use App\Deck\Http\Requests\Authoring\ListPublicDecksRequest;
use App\Deck\Http\Resources\DeckPresenter;
use App\Models\Deck\Deck;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Discover, /api/v1/{product authoring prefix}/public: everyone's public
 * decks of the product, a read-only preview of one, and copying one into
 * the signed-in user's library. A private, deleted or other-product deck is
 * a 404, except that owners can always open their own.
 */
class PublicDeckController extends DeckController
{
    public function __construct(private readonly DeckAuthoringService $decks) {}

    /** GET /public → {items: [public summary], meta}. */
    public function index(ListPublicDecksRequest $request): JsonResponse
    {
        $page = $this->decks->paginatePublic($this->product($request), $request->validated());

        return $this->okResponse(DeckPresenter::publicPage($page, $request->user()));
    }

    /** GET /public/{deck} → {deck: public detail} (slides + options, for the preview). */
    public function show(Request $request, string $deck): JsonResponse
    {
        return $this->okResponse(['deck' => DeckPresenter::publicDetail($this->publicDeck($request, $deck), $request->user())]);
    }

    /** POST /public/{deck}/copy → 201 {deck: detail}: a private copy in the user's library. */
    public function copy(Request $request, string $deck): JsonResponse
    {
        $copy = $this->decks->copyFromPublic($this->publicDeck($request, $deck), $request->user());

        return $this->createdResponse(['deck' => DeckPresenter::detail($copy)], 'Copied to your library.');
    }

    /** A non-deleted deck of the route's product that is public or the user's own. */
    private function publicDeck(Request $request, string $deckId): Deck
    {
        $id = DeckRoutes::id($deckId);
        $deck = $id === null ? null : Deck::query()->forProduct($this->product($request))->find($id);

        if (! $deck || (! $deck->isPublic() && (int) $deck->owner_id !== (int) $request->user()?->id)) {
            throw DeckException::notFound('This ' . $this->product($request) . ' is not shared.');
        }

        return $deck;
    }
}
