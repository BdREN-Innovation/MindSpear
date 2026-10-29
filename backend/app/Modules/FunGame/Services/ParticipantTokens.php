<?php

namespace App\Modules\FunGame\Services;

use App\Modules\FunGame\Models\FunGameParticipant;
use App\Modules\FunGame\Models\FunGameSession;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Bearer tokens for anonymous participants, same scheme as
 * App\Deck\Participants\ParticipantTokenService (sha256 hash stored, raw token
 * returned once, sent back in X-Participant-Token).
 * Tokens stay valid after the game ends so participants can read their results.
 */
class ParticipantTokens
{
    public const HEADER = 'X-Participant-Token';

    private const TTL_HOURS = 12;

    /** last_seen_at is refreshed at most this often, to keep reads cheap. */
    private const SEEN_RESOLUTION_SECONDS = 20;

    public function issue(FunGameParticipant $participant): string
    {
        $token = Str::random(64);
        $participant->forceFill([
            'participant_token_hash' => $this->hash($token),
            'participant_token_expires_at' => now()->addHours(self::TTL_HOURS),
            'participant_token_revoked_at' => null,
        ])->save();

        return $token;
    }

    public function resolve(Request $request, FunGameSession $session): ?FunGameParticipant
    {
        $token = $request->header(self::HEADER);
        if (! is_string($token) || $token === '') {
            return null;
        }

        $participant = FunGameParticipant::query()
            ->where('fun_game_session_id', $session->id)
            ->where('participant_token_hash', $this->hash($token))
            ->first();

        if (
            ! $participant
            || $participant->participant_token_revoked_at !== null
            || ($participant->participant_token_expires_at && now()->greaterThan($participant->participant_token_expires_at))
        ) {
            return null;
        }

        if (! $participant->last_seen_at || $participant->last_seen_at->diffInSeconds(now()) >= self::SEEN_RESOLUTION_SECONDS) {
            $participant->forceFill(['last_seen_at' => now()])->saveQuietly();
        }

        return $participant;
    }

    /** Rate-limit key for participant endpoints. */
    public static function throttleKey(Request $request): string
    {
        $token = $request->header(self::HEADER);

        return is_string($token) && $token !== '' ? 'pt:' . hash('sha256', $token) : 'ip:' . $request->ip();
    }

    private function hash(string $token): string
    {
        return hash('sha256', $token);
    }
}
