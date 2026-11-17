<?php

namespace App\Deck\Participants;

use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckSession;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Anonymous participant tokens: only the SHA-256 hash is stored, the raw
 * token travels in the X-Participant-Token header. Tokens last TTL_HOURS;
 * ending a session revokes its tokens (revokeForDeckSession).
 */
class ParticipantTokenService
{
    public const HEADER = 'X-Participant-Token';

    private const TTL_HOURS = 6;

    public function issue(DeckParticipant $participant): string
    {
        $token = Str::random(64);
        $participant->forceFill([
            'participant_token_hash' => $this->hash($token),
            'participant_token_expires_at' => now()->addHours(self::TTL_HOURS),
            'participant_token_revoked_at' => null,
        ])->save();

        return $token;
    }

    /** Whether the request carries $participant's valid token. */
    public function validateRequest(Request $request, DeckParticipant $participant): bool
    {
        $token = $request->header(self::HEADER);

        return is_string($token) && $token !== '' && $this->tokenMatches($participant, $token);
    }

    /** Hash, revocation and expiry checks for a raw token. */
    public function tokenMatches(DeckParticipant $participant, string $token): bool
    {
        if (! $participant->participant_token_hash || $participant->participant_token_revoked_at !== null) {
            return false;
        }

        if ($participant->participant_token_expires_at && now()->greaterThan($participant->participant_token_expires_at)) {
            return false;
        }

        return hash_equals($participant->participant_token_hash, $this->hash($token));
    }

    /** The participant of $session holding the request's token, if it is still valid. */
    public function participantForDeckSession(Request $request, DeckSession|int $session): ?DeckParticipant
    {
        $token = $request->header(self::HEADER);

        return is_string($token) ? $this->resolveDeckParticipant($token, $session) : null;
    }

    public function resolveDeckParticipant(string $token, DeckSession|int $session): ?DeckParticipant
    {
        if ($token === '') {
            return null;
        }

        $participant = DeckParticipant::query()
            ->where('deck_session_id', $session instanceof DeckSession ? $session->id : $session)
            ->where('participant_token_hash', $this->hash($token))
            ->first();

        return $participant && $this->tokenMatches($participant, $token) ? $participant : null;
    }

    public function revokeForDeckSession(DeckSession|int $session): int
    {
        return DeckParticipant::query()
            ->where('deck_session_id', $session instanceof DeckSession ? $session->id : $session)
            ->whereNull('participant_token_revoked_at')
            ->update(['participant_token_revoked_at' => now()]);
    }

    public function revokeParticipant(DeckParticipant $participant): void
    {
        if ($participant->participant_token_revoked_at !== null) {
            return;
        }

        $participant->forceFill(['participant_token_revoked_at' => now()])->save();
    }

    public function sanitizeParticipant(Model $participant): Model
    {
        return $participant->makeHidden([
            'participant_token_hash',
            'participant_token_expires_at',
            'participant_token_revoked_at',
        ]);
    }

    private function hash(string $token): string
    {
        return hash('sha256', $token);
    }
}
