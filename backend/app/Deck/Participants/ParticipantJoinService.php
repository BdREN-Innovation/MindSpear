<?php

namespace App\Deck\Participants;

use App\Deck\Broadcasts\DeckBroadcaster;
use App\Deck\Broadcasts\Payloads\ParticipantJoinedPayload;
use App\Deck\Exceptions\DeckException;
use App\Deck\Sessions\JoinCodeGenerator;
use App\Deck\Support\ProfanityFilter;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckSession;
use Illuminate\Support\Facades\DB;

/**
 * Anonymous join (plan §3.6). A join creates a new participant with a fresh
 * token, except a rejoin from the same device: when the request carries a
 * valid (unrevoked, unexpired) X-Participant-Token of this session, the
 * SAME participant comes back (left_at cleared, points, answers, name,
 * avatar and token unchanged) instead of a second row.
 */
class ParticipantJoinService
{
    public function __construct(
        private readonly ParticipantTokenService $tokens,
        private readonly DeckBroadcaster $broadcaster,
        private readonly ProfanityFilter $profanity,
        private readonly ParticipantPresence $presence,
    ) {}

    /**
     * $displayName is already cleaned and length-checked (JoinDeckSessionRequest);
     * it is profanity-masked here. $joinCode must match the session's join
     * code (JoinCodeGenerator::normalise, constant-time compare); a mismatch
     * is the same 404 as a missing session, so ids cannot be probed. After the commit the host gets
     * `participant.joined` and everyone `participant.count.updated`.
     *
     * $existingToken: the X-Participant-Token the device still holds. When it
     * is a valid token of this session the join is a rejoin (rejoined true,
     * token = $existingToken, no participant.joined; participant.count.updated
     * only when they had left). Any other token is ignored (a normal join).
     *
     * @return array{participant: DeckParticipant, token: string, rejoined: bool}
     *
     * @throws DeckException 404 wrong join code, 409 invalid_state while pending, 403 forbidden once ended
     */
    public function join(DeckSession $session, string $displayName, string $emojiAvatar, string $joinCode, ?string $existingToken = null): array
    {
        $displayName = $this->profanity->mask($displayName);

        [$participant, $token, $session, $rejoined] = DB::transaction(function () use ($session, $displayName, $emojiAvatar, $joinCode, $existingToken) {
            // FOR SHARE: an `end` committing meanwhile either waits for this join
            // (and its token revocation then covers this participant) or is seen here.
            $locked = DeckSession::query()->whereKey($session->id)->sharedLock()->first();
            self::assertJoinCode($locked, $joinCode);
            self::assertJoinable($locked);
            $locked->setRelation('deck', $session->deck);

            $existing = is_string($existingToken) && $existingToken !== ''
                ? $this->tokens->resolveDeckParticipant($existingToken, $locked)
                : null;

            if ($existing) {
                $this->presence->returned($locked, $existing);

                return [$existing->setRelation('session', $locked), $existingToken, $locked, true];
            }

            $participant = new DeckParticipant([
                'deck_session_id' => $locked->id,
                'display_name' => $displayName,
                'emoji_avatar' => $emojiAvatar,
                // Quiz players start the leaderboard at 0; Quest has no points.
                'total_points' => $locked->product() === Deck::PRODUCT_QUIZ ? 0 : null,
                'joined_at' => now(),
            ]);
            $token = $this->tokens->issue($participant);

            return [$participant->setRelation('session', $locked), $token, $locked, false];
        }, 3);

        if (! $rejoined) {
            $this->broadcaster->broadcast($session, ParticipantJoinedPayload::fromParticipant($participant, $session->current_slide_run_id));
            $this->broadcaster->broadcastParticipantCount($session);
        }

        return ['participant' => $participant, 'token' => $token, 'rejoined' => $rejoined];
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
