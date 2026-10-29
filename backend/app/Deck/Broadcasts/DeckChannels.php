<?php

namespace App\Deck\Broadcasts;

use App\Models\Deck\DeckSession;

/**
 * Channel names for deck sessions: a public one per session (participants
 * and host) and a private one for the host.
 */
class DeckChannels
{
    /** "session.{product}.{public_channel_key}" — participants and host. */
    public function publicChannel(DeckSession $session): string
    {
        return "session.{$session->product()}.{$session->public_channel_key}";
    }

    /** "host.{product}.{id}" — private, host only. */
    public function hostChannel(DeckSession $session): string
    {
        return "host.{$session->product()}.{$session->id}";
    }

    public function for(DeckSession $session, BroadcastPayload $payload): string
    {
        return $payload->visibility() === BroadcastPayload::VISIBILITY_HOST
            ? $this->hostChannel($session)
            : $this->publicChannel($session);
    }
}
