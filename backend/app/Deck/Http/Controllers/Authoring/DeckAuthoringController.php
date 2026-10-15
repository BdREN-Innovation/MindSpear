<?php

namespace App\Deck\Http\Controllers\Authoring;

use App\Deck\Authoring\DeckAuthoringService;
use App\Deck\Http\Controllers\DeckController;
use App\Deck\Http\Requests\Authoring\DeckRequest;
use App\Deck\Http\Requests\Authoring\ListDecksRequest;
use App\Deck\Http\Resources\DeckPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Deck authoring, /api/v1/{product authoring prefix} (quests/v2). Other
 * users' and other products' decks are 404.
 */
class DeckAuthoringController extends DeckController
{
    public function __construct(private readonly DeckAuthoringService $decks) {}

    /** GET / → {items: [summary], meta}. */
    public function index(ListDecksRequest $request): JsonResponse
    {
        $page = $this->decks->paginate($request->user(), $this->product($request), $request->validated());

        return $this->okResponse(DeckPresenter::page($page));
    }

    /** POST / → 201 {deck: detail} (one qr_code slide). */
    public function store(DeckRequest $request): JsonResponse
    {
        $deck = $this->decks->create($request->user(), $this->product($request), $request->validated());

        return $this->createdResponse(['deck' => DeckPresenter::detail($deck)], 'Deck created.');
    }

    /** GET /{deck} → {deck: detail}. */
    public function show(Request $request, string $deck): JsonResponse
    {
        return $this->okResponse(['deck' => DeckPresenter::detail($this->ownedDeck($request, $deck))]);
    }

    /** PATCH /{deck} → {deck: summary}. */
    public function update(DeckRequest $request, string $deck): JsonResponse
    {
        $model = $this->decks->update($this->ownedDeck($request, $deck), $request->validated());

        return $this->okResponse(['deck' => DeckPresenter::summary($model)], 'Deck updated.');
    }

    /** DELETE /{deck} → {} (soft delete). */
    public function destroy(Request $request, string $deck): JsonResponse
    {
        $this->decks->delete($this->ownedDeck($request, $deck));

        return $this->okResponse([], 'Deck deleted.');
    }

    /** POST /{deck}/duplicate → 201 {deck: detail}. */
    public function duplicate(Request $request, string $deck): JsonResponse
    {
        $copy = $this->decks->duplicate($this->ownedDeck($request, $deck));

        return $this->createdResponse(['deck' => DeckPresenter::detail($copy)], 'Deck duplicated.');
    }
}
