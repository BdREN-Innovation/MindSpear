<?php

namespace App\Deck\Http\Controllers\Sessions;

use App\Deck\Http\Controllers\DeckController;
use App\Deck\Http\Requests\Sessions\AdvanceSessionRequest;
use App\Deck\Http\Resources\SessionStatePresenter;
use App\Deck\Sessions\SessionLauncher;
use App\Deck\Sessions\SessionStateMachine;
use App\Models\Deck\DeckParticipant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Host side of a live session (Sanctum; the deck owner / session host only,
 * everyone else gets 404). Every action answers with the host state
 * (SessionStatePresenter::host), the same shape as the host's GET /state
 * (SessionStateController).
 */
class HostSessionController extends DeckController
{
    public function __construct(
        private readonly SessionLauncher $launcher,
        private readonly SessionStateMachine $machine,
    ) {}

    /** POST /quests/{deck}/sessions → 201 host state (+ session_id, join_code, public_channel_key). */
    public function start(Request $request, string $deck): JsonResponse
    {
        $session = $this->launcher->start($this->ownedDeck($request, $deck), $request->user());

        return $this->createdResponse(SessionStatePresenter::host($session), 'Session started.');
    }

    /** POST /quest-sessions/{session}/advance {action, target_run_id?, force?, start?} */
    public function advance(AdvanceSessionRequest $request, string $session): JsonResponse
    {
        $session = $this->machine->advance(
            $this->ownedSession($request, $session),
            $request->action(),
            $request->targetRunId(),
            $request->force(),
            $request->start(),
        );

        return $this->okResponse(SessionStatePresenter::host($session));
    }

    /** Most participants listed; the count beyond is in `total`. */
    private const PARTICIPANT_LIST_LIMIT = 200;

    /**
     * GET /quest-sessions/{session}/participants → {participants: [{participant_id, display_name,
     * emoji_avatar, joined_at}, ...] newest first, at most 200, total}: who is in the room now
     * (left_at null), for the host's "who joined" list. New joins then arrive as participant.joined.
     */
    public function participants(Request $request, string $session): JsonResponse
    {
        $inRoom = DeckParticipant::query()
            ->where('deck_session_id', $this->ownedSession($request, $session)->id)
            ->whereNull('left_at');

        return $this->okResponse([
            'participants' => (clone $inRoom)
                ->orderByDesc('joined_at')
                ->orderByDesc('id')
                ->limit(self::PARTICIPANT_LIST_LIMIT)
                ->get(['id', 'display_name', 'emoji_avatar', 'joined_at'])
                ->map(fn (DeckParticipant $participant) => [
                    'participant_id' => $participant->id,
                    'display_name' => $participant->display_name,
                    'emoji_avatar' => $participant->emoji_avatar,
                    'joined_at' => $participant->joined_at?->toISOString(),
                ])
                ->all(),
            'total' => $inRoom->count(),
        ]);
    }

    /** POST /quest-sessions/{session}/end */
    public function end(Request $request, string $session): JsonResponse
    {
        $session = $this->machine->end($this->ownedSession($request, $session));

        return $this->okResponse(SessionStatePresenter::host($session), 'Session ended.');
    }
}
