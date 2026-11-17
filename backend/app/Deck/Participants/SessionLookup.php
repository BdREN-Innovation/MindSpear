<?php

namespace App\Deck\Participants;

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\DeckRoutes;
use App\Models\Deck\DeckSession;

/**
 * Session lookup for the public participant routes (join, aggregate), which
 * have no owner and no deck.participant middleware: any session of the
 * route's product, `deck` loaded; anything else is 404 'Session not found.'.
 */
final class SessionLookup
{
    public static function forProduct(int|string $sessionId, string $product): DeckSession
    {
        $id = DeckRoutes::id($sessionId);
        $session = $id === null ? null : DeckSession::with('deck')->find($id);

        if (! $session || ! $session->deck || $session->deck->product !== $product) {
            throw DeckException::notFound('Session not found.');
        }

        return $session;
    }
}
