<?php

namespace App\Deck\Broadcasts;

use App\Models\Deck\DeckSession;

/**
 * Channel names for deck sessions. The public format matches the legacy
 * LiveSessionService one; the host channel is namespaced `.v2` so numeric ids
 * of legacy sessions can never collide during coexistence.
 */
class DeckChannels
{
    /** "session.{product}.{public_channel_key}" — participants and host. */
    public function publicChannel(DeckSession $session): string
    {
        return "session.{$session->product()}.{$session->public_channel_key}";
    }

    /** "host.{product}.v2.{id}" — private, host only. */
    public function hostChannel(DeckSession $session): string
    {
        return "host.{$session->product()}.v2.{$session->id}";
    }

    public function for(DeckSession $session, BroadcastPayload $payload): string
    {
        return $payload->visibility() === BroadcastPayload::VISIBILITY_HOST
            ? $this->hostChannel($session)
            : $this->publicChannel($session);
    }
}
