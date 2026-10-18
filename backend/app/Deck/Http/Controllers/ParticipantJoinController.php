<?php

namespace App\Deck\Http\Controllers;

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\Requests\JoinDeckSessionRequest;
use App\Deck\Participants\ParticipantJoinService;
use App\Deck\Participants\ParticipantPresence;
use App\Deck\Participants\SessionLookup;
use App\Services\Live\ParticipantTokenService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/** Anonymous join (plan §3.6; throttled by `deck-join`) and leaving the session. */
class ParticipantJoinController extends DeckController
{
    public function __construct(
        private readonly ParticipantJoinService $joins,
        private readonly ParticipantPresence $presence,
        private readonly ParticipantTokenService $tokens,
    ) {}

    /**
     * POST /{sessions prefix}/{session}/participants/join
     * Body {join_code, display_name, emoji_avatar} → 201 {participant_id, participant_token,
     * public_channel_key, session_id, display_name (as stored, profanity-masked), emoji_avatar, rejoined: false}.
     * Same device: with a valid X-Participant-Token of this session → 200 with the SAME
     * participant and token (rejoined: true; stored name / avatar win, left_at is cleared).
     * 404 unknown session / other product / wrong join code, 409 invalid_state while pending, 403 forbidden once ended.
     */
    public function store(JoinDeckSessionRequest $request, string $session): JsonResponse
    {
        $deckSession = SessionLookup::forProduct($session, $this->product($request));
        $data = $request->validated();
        $token = $request->header(ParticipantTokenService::HEADER);

        ['participant' => $participant, 'token' => $token, 'rejoined' => $rejoined] = $this->joins->join(
            $deckSession,
            $data['display_name'],
            $data['emoji_avatar'],
            $data['join_code'],
            is_string($token) ? $token : null,
        );

        $body = [
            'participant_id' => $participant->id,
            'participant_token' => $token,
            'public_channel_key' => $deckSession->public_channel_key,
            'session_id' => $deckSession->id,
            'display_name' => $participant->display_name,
            'emoji_avatar' => $participant->emoji_avatar,
            'rejoined' => $rejoined,
        ];

        return $rejoined ? $this->okResponse($body, 'Rejoined.') : $this->createdResponse($body, 'Joined.');
    }

    /**
     * POST /{sessions prefix}/{session}/participants/leave → 204 (also when already left).
     * The token comes in X-Participant-Token, or as `participant_token` in the body for
     * navigator.sendBeacon (which cannot set headers; send it form-encoded). Sets left_at:
     * the participant stops counting for participant_count, "x / y answered", auto-reveal
     * and leaderboards; a quiz run whose remaining participants all answered reveals.
     * The token stays valid: a join with it (same device) or an answer brings them back.
     * 401 without a valid token, 404 unknown session / other product.
     */
    public function leave(Request $request, string $session): Response
    {
        $deckSession = SessionLookup::forProduct($session, $this->product($request));
        $token = $request->header(ParticipantTokenService::HEADER);
        if (! is_string($token) || $token === '') {
            $token = $request->input('participant_token');
        }

        $participant = is_string($token) && $token !== ''
            ? $this->tokens->resolveDeckParticipant($token, $deckSession)
            : null;

        if (! $participant) {
            throw DeckException::unauthorized();
        }

        $this->presence->leave($deckSession, $participant);

        return response()->noContent();
    }
}
