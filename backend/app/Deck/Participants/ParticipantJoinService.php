<?php

namespace App\Deck\Participants;

use App\Deck\Broadcasts\DeckBroadcaster;
use App\Deck\Broadcasts\Payloads\ParticipantJoinedPayload;
use App\Deck\Exceptions\DeckException;
use App\Deck\Sessions\JoinCodeGenerator;
use App\Deck\Support\ProfanityFilter;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckSession;
use App\Services\Live\LiveSessionService;
use App\Services\Live\ParticipantTokenService;
use Illuminate\Support\Facades\DB;

/**
 * Anonymous join (plan §3.6). Every join creates a new participant with a
 * fresh token; the client keeps the token and never needs to rejoin.
 */
class ParticipantJoinService
{
    public function __construct(
        private readonly ParticipantTokenService $tokens,
        private readonly LiveSessionService $live,
        private readonly DeckBroadcaster $broadcaster,
        private readonly ProfanityFilter $profanity,
    ) {}

    /**
     * $displayName is already cleaned and length-checked (JoinDeckSessionRequest);
     * it is profanity-masked here. $joinCode must match the session's join
     * code (JoinCodeGenerator::normalise, constant-time compare); a mismatch
     * is the same 404 as a missing session, so ids cannot be probed. After the commit the host gets
     * `participant.joined` and everyone `participant.count.updated`.
     *
     * @return array{participant: DeckParticipant, token: string}
     *
     * @throws DeckException 404 wrong join code, 409 invalid_state while pending, 403 forbidden once ended
     */
    public function join(DeckSession $session, string $displayName, string $emojiAvatar, string $joinCode): array
    {
        $displayName = $this->profanity->mask($displayName);

        [$participant, $token, $session] = DB::transaction(function () use ($session, $displayName, $emojiAvatar, $joinCode) {
            // FOR SHARE: an `end` committing meanwhile either waits for this join
            // (and its token revocation then covers this participant) or is seen here.
            $locked = DeckSession::query()->whereKey($session->id)->sharedLock()->first();
            self::assertJoinCode($locked, $joinCode);
            self::assertJoinable($locked);
            $locked->setRelation('deck', $session->deck);

            $participant = new DeckParticipant([
                'deck_session_id' => $locked->id,
                'display_name' => $displayName,
                'emoji_avatar' => $emojiAvatar,
                'joined_at' => now(),
            ]);
            $token = $this->tokens->issue($participant, $locked);

            return [$participant->setRelation('session', $locked), $token, $locked];
        }, 3);

        $this->broadcaster->broadcast($session, ParticipantJoinedPayload::fromParticipant($participant, $session->current_slide_run_id));
        $this->live->broadcastParticipantCount($session->product(), $session);

        return ['participant' => $participant, 'token' => $token];
    }

    /** @throws DeckException 404 'Session not found.' unless $joinCode is $session's join code */
    public static function assertJoinCode(?DeckSession $session, string $joinCode): void
    {
        $given = JoinCodeGenerator::normalise($joinCode);
        $expected = $session ? JoinCodeGenerator::normalise((string) $session->join_code) : null;

        if ($given === null || $expected === null || ! hash_equals($expected, $given)) {
            throw DeckException::notFound('Session not found.');
        }
    }

    public static function assertJoinable(?DeckSession $session): void
    {
        if (! $session) {
            throw DeckException::notFound('Session not found.');
        }

        if ($session->status === DeckSession::STATUS_ENDED) {
            throw new DeckException('This session has ended.', 403, DeckException::CODE_FORBIDDEN, [
                'session_status' => $session->status,
            ]);
        }

        if ($session->status !== DeckSession::STATUS_LIVE) {
            throw DeckException::invalidState('This session has not started yet.', [
                'session_status' => $session->status,
            ]);
        }
    }
}
