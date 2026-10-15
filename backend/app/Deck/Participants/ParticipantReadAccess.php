<?php

namespace App\Deck\Participants;

use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckSession;
use App\Services\Live\ParticipantTokenService;
use Illuminate\Http\Request;

/**
 * Participant resolution for the read-only participant routes (my-answer,
 * aggregate), which must keep working on the post-session review screen
 * (plan §7.5) after SessionStateMachine::end() revoked every token.
 *
 * A token resolves when ParticipantTokenService accepts it (live use), or,
 * for an ended session only, when it was revoked by that end: revoked at or
 * after the session's ended_at (to the second) and not past
 * participant_token_expires_at. A participant revoked before the end
 * (removed by the host) stays locked out. Writes (answers, Q&A) keep the strict deck.participant middleware.
 */
class ParticipantReadAccess
{
    /** Per-IP requests per minute on the token routes, sized for a large room behind one NAT. */
    public const IP_PER_MINUTE = 1800;

    /** Per-IP cap that holds whatever token a request sends (the deck-participant limiter keys by token). */
    public const IP_THROTTLE = 'throttle:' . self::IP_PER_MINUTE . ',1,deck-participant-ip-';

    public function __construct(private readonly ParticipantTokenService $tokens) {}

    public function participant(Request $request, DeckSession $session): ?DeckParticipant
    {
        $participant = $this->tokens->participantForDeckSession($request, $session);
        if ($participant) {
            return $participant;
        }

        $token = $request->header(ParticipantTokenService::HEADER);

        return is_string($token) && $token !== '' ? $this->reviewer($token, $session) : null;
    }

    /** The participant of an ended $session whose token the session end revoked. */
    public function reviewer(string $token, DeckSession $session): ?DeckParticipant
    {
        if ($session->status !== DeckSession::STATUS_ENDED || ! $session->ended_at) {
            return null;
        }

        // Same digest ParticipantTokenService stores in participant_token_hash.
        $hash = hash('sha256', $token);
        $participant = DeckParticipant::query()
            ->where('deck_session_id', $session->id)
            ->where('participant_token_hash', $hash)
            ->first();

        if (! $participant || ! hash_equals((string) $participant->participant_token_hash, $hash)) {
            return null;
        }

        // revokeForDeckSession() writes through the query builder, which drops the
        // milliseconds ended_at keeps: compare against the start of the end's second.
        $revokedAt = $participant->participant_token_revoked_at;
        if (! $revokedAt || $revokedAt->lessThan($session->ended_at->copy()->startOfSecond())) {
            return null;
        }

        $expiresAt = $participant->participant_token_expires_at;
        if ($expiresAt && now()->greaterThan($expiresAt)) {
            return null;
        }

        return $participant;
    }
}
