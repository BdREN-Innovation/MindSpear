<?php

namespace App\Deck\Authoring;

use App\Models\Deck\Deck;
use App\Models\Deck\DeckSession;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

/**
 * How many decks of a product someone owns, by how far they got: hosted live
 * right now, hosted before (an ended session) and never hosted. A deck can be
 * both live and hosted; deleted decks are not counted.
 */
class DeckStatistics
{
    /** @return array{total: int, live: int, hosted: int, never_hosted: int} */
    public function forOwner(User $owner, string $product): array
    {
        $decks = fn (): Builder => Deck::query()->ownedBy($owner)->forProduct($product);

        return [
            'total' => $decks()->count(),
            'live' => $decks()->whereHas('sessions', fn (Builder $session) => $session->live())->count(),
            'hosted' => $decks()->whereHas('sessions', fn (Builder $session) => $session->where('status', DeckSession::STATUS_ENDED))->count(),
            'never_hosted' => $decks()->whereDoesntHave('sessions')->count(),
        ];
    }
}
