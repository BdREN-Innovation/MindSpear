<?php

namespace App\Services\Live;

use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckSession;
use App\Models\Quest\QuestParticipant;
use App\Models\Quest\QuestSession;
use App\Models\Quiz\QuizParticipant;
use App\Models\Quiz\QuizSession;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Anonymous participant tokens: only the SHA-256 hash is stored, the raw
 * token travels in the X-Participant-Token header. Serves legacy
 * Quest/Quiz participants and deck participants alike.
 */
class ParticipantTokenService
{
    public const HEADER = 'X-Participant-Token';

    private const TTL_HOURS = 6;

    public function issue(
        QuestParticipant|QuizParticipant|DeckParticipant $participant,
        QuestSession|QuizSession|DeckSession $session
    ): string {
        $token = Str::random(64);
        $participant->forceFill([
            'participant_token_hash' => $this->hash($token),
            'participant_token_expires_at' => $this->expiresAt($session),
            'participant_token_revoked_at' => null,
        ])->save();

        return $token;
    }

    public function validateRequest(Request $request, QuestParticipant|QuizParticipant|DeckParticipant $participant): bool
    {
        // Deck participants are always anonymous (no is_anonymous column), so they always need a token.
        if (! $participant instanceof DeckParticipant && ! $participant->is_anonymous) {
            return true;
        }

        $token = $request->header(self::HEADER);

        if (! is_string($token) || $token === '') {
            return false;
        }

        return $this->tokenMatches($participant, $token);
    }

    /** Hash, revocation and expiry checks for a raw token. */
    public function tokenMatches(QuestParticipant|QuizParticipant|DeckParticipant $participant, string $token): bool
    {
        if (! $participant->participant_token_hash) {
            return false;
        }

        if ($participant->participant_token_revoked_at !== null) {
            return false;
        }

        if ($participant->participant_token_expires_at && now()->greaterThan($participant->participant_token_expires_at)) {
            return false;
        }

        return hash_equals($participant->participant_token_hash, $this->hash($token));
    }

    public function participantForSession(
        Request $request,
        string $module,
        int $sessionId
    ): QuestParticipant|QuizParticipant|null {
        $token = $request->header(self::HEADER);

        if (! is_string($token) || $token === '') {
            return null;
        }

        $participantClass = $module === LiveSessionService::MODULE_QUEST
            ? QuestParticipant::class
            : QuizParticipant::class;

        $sessionColumn = $module === LiveSessionService::MODULE_QUEST
            ? 'quest_session_id'
            : 'quiz_session_id';

        $participant = $participantClass::query()
            ->where($sessionColumn, $sessionId)
            ->where('participant_token_hash', $this->hash($token))
            ->first();

        if (! $participant || ! $this->validateRequest($request, $participant)) {
            return null;
        }

        return $participant;
    }

    /** The deck participant of $session holding the request's token, if it is still valid. */
    public function participantForDeckSession(Request $request, DeckSession|int $session): ?DeckParticipant
    {
        $token = $request->header(self::HEADER);

        if (! is_string($token) || $token === '') {
            return null;
        }

        return $this->resolveDeckParticipant($token, $session);
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

    public function revokeForSession(string $module, int $sessionId): int
    {
        $participantClass = $module === LiveSessionService::MODULE_QUEST
            ? QuestParticipant::class
            : QuizParticipant::class;

        $sessionColumn = $module === LiveSessionService::MODULE_QUEST
            ? 'quest_session_id'
            : 'quiz_session_id';

        return $participantClass::query()
            ->where($sessionColumn, $sessionId)
            ->whereNull('participant_token_revoked_at')
            ->update(['participant_token_revoked_at' => now()]);
    }

    public function revokeParticipant(QuestParticipant|QuizParticipant|DeckParticipant $participant): void
    {
        if ($participant->participant_token_revoked_at !== null) {
            return;
        }

        $participant->forceFill([
            'participant_token_revoked_at' => now(),
        ])->save();
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

    private function expiresAt(QuestSession|QuizSession|DeckSession $session): \Illuminate\Support\Carbon
    {
        $cap = now()->addHours(self::TTL_HOURS);

        // Deck sessions have no scheduled end; ending one revokes its tokens instead.
        if ($session instanceof DeckSession) {
            return $cap;
        }

        if (
            $session->end_datetime
            && $session->end_datetime->greaterThan(now())
            && $session->end_datetime->lessThan($cap)
        ) {
            return $session->end_datetime;
        }

        return $cap;
    }
}
