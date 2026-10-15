<?php

namespace App\Deck\Sessions;

use App\Deck\Exceptions\DeckException;
use App\Models\Deck\DeckSession;

/**
 * Join codes for deck sessions (plan §2.4): config('deck.join_code_length')
 * characters from config('deck.join_code_alphabet') (A-Z and 2-9 without
 * 0/O/1/I), globally unique in deck_sessions (never reused, so old links
 * stay unambiguous). A collision is retried; after MAX_ATTEMPTS the start
 * request fails with 409 instead of looping.
 */
class JoinCodeGenerator
{
    public const MAX_ATTEMPTS = 5;

    /** Longest value deck_sessions.join_code holds. */
    public const MAX_LENGTH = 12;

    /** @throws DeckException 409 conflict when every attempt collided */
    public function generate(): string
    {
        for ($attempt = 0; $attempt < self::MAX_ATTEMPTS; $attempt++) {
            $code = $this->candidate();

            if (! DeckSession::query()->where('join_code', $code)->exists()) {
                return $code;
            }
        }

        throw DeckException::conflict('Could not allocate a unique join code. Please try again.');
    }

    /** One random code; uniqueness is checked by generate(). */
    public function candidate(): string
    {
        $alphabet = (string) config('deck.join_code_alphabet', 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
        $length = max(1, min(self::MAX_LENGTH, (int) config('deck.join_code_length', 6)));
        $last = strlen($alphabet) - 1;

        $code = '';
        for ($i = 0; $i < $length; $i++) {
            $code .= $alphabet[random_int(0, $last)];
        }

        return $code;
    }

    /**
     * A typed code as stored (upper case, spaces and dashes dropped), or null
     * when it cannot be a join code at all. Lookups are case-insensitive
     * through this.
     */
    public static function normalise(mixed $code): ?string
    {
        if (! is_string($code)) {
            return null;
        }

        $code = strtoupper((string) preg_replace('/[\s-]+/', '', $code));

        return preg_match('/^[A-Z0-9]{1,' . self::MAX_LENGTH . '}$/', $code) ? $code : null;
    }
}
