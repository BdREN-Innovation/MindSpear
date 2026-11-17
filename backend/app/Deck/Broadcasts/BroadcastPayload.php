<?php

namespace App\Deck\Broadcasts;

/**
 * A typed live event for a deck session. DeckBroadcaster sends it to the
 * public channel or, for host visibility, only to the private host channel.
 */
interface BroadcastPayload
{
    public const VISIBILITY_PUBLIC = 'public';

    public const VISIBILITY_HOST = 'host';

    /** Event name clients listen for, e.g. 'slide.state.changed'. */
    public function eventName(): string;

    /** 'public' | 'host' */
    public function visibility(): string;

    public function toArray(): array;
}
