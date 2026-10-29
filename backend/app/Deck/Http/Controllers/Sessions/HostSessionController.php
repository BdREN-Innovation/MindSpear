<?php

namespace App\Deck\Http\Controllers\Sessions;

use App\Deck\Http\Controllers\DeckController;
use App\Deck\Http\Requests\Sessions\AdvanceSessionRequest;
use App\Deck\Http\Resources\SessionStatePresenter;
use App\Deck\Sessions\SessionLauncher;
use App\Deck\Sessions\SessionStateMachine;
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

    /** POST /quest-sessions/{session}/advance {action, target_run_id?, force?} */
    public function advance(AdvanceSessionRequest $request, string $session): JsonResponse
    {
        $session = $this->machine->advance(
            $this->ownedSession($request, $session),
            $request->action(),
            $request->targetRunId(),
            $request->force(),
        );

        return $this->okResponse(SessionStatePresenter::host($session));
    }

    /** POST /quest-sessions/{session}/end */
    public function end(Request $request, string $session): JsonResponse
    {
        $session = $this->machine->end($this->ownedSession($request, $session));

        return $this->okResponse(SessionStatePresenter::host($session), 'Session ended.');
    }
}
