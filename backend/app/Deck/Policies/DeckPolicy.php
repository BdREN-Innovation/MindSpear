<?php

namespace App\Deck\Policies;

use App\Models\Deck\Deck;
use App\Models\Deck\DeckSession;
use App\Models\User;

/**
 * Registered for Deck and DeckSession. A deck (its slides and options) is
 * managed by its owner only; a session by the host who started it.
 */
class DeckPolicy
{
    public function manage(User $user, Deck|DeckSession $model): bool
    {
        $ownerId = $model instanceof Deck ? $model->owner_id : $model->host_user_id;

        return $ownerId !== null && (int) $ownerId === (int) $user->id;
    }
}
