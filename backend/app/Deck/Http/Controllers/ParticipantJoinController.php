<?php

namespace App\Deck\Http\Controllers;

use App\Deck\Http\Requests\JoinDeckSessionRequest;
use App\Deck\Participants\ParticipantJoinService;
use App\Deck\Participants\SessionLookup;
use Illuminate\Http\JsonResponse;

/** Anonymous join (plan §3.6). Public; throttled by `deck-join`. */
class ParticipantJoinController extends DeckController
{
    public function __construct(private readonly ParticipantJoinService $joins) {}

    /**
     * POST /{sessions prefix}/{session}/participants/join
     * Body {join_code, display_name, emoji_avatar} → 201 {participant_id, participant_token,
     * public_channel_key, session_id, display_name (as stored, profanity-masked), emoji_avatar}.
     * 404 unknown session / other product / wrong join code, 409 invalid_state while pending, 403 forbidden once ended.
     */
    public function store(JoinDeckSessionRequest $request, string $session): JsonResponse
    {
        $deckSession = SessionLookup::forProduct($session, $this->product($request));
        $data = $request->validated();

        ['participant' => $participant, 'token' => $token] = $this->joins->join(
            $deckSession,
            $data['display_name'],
            $data['emoji_avatar'],
            $data['join_code'],
        );

        return $this->createdResponse([
            'participant_id' => $participant->id,
            'participant_token' => $token,
            'public_channel_key' => $deckSession->public_channel_key,
            'session_id' => $deckSession->id,
            'display_name' => $participant->display_name,
            'emoji_avatar' => $participant->emoji_avatar,
        ], 'Joined.');
    }
}
