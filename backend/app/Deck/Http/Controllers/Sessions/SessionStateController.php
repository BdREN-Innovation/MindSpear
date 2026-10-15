<?php

namespace App\Deck\Http\Controllers\Sessions;

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\Controllers\DeckController;
use App\Deck\Http\Middleware\ResolveDeckParticipant;
use App\Deck\Http\Resources\SessionStatePresenter;
use App\Deck\Sessions\SessionStateMachine;
use App\Deck\Support\DeckFeature;
use App\Services\Live\ParticipantTokenService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * GET /quest-sessions/v2/{session}/state: the one full resync snapshot
 * (plan §3.1, §7.6), for both kinds of caller, like the aggregate and Q&A
 * feed routes:
 *
 * - With X-Participant-Token: that participant's view
 *   (SessionStatePresenter::participant). 404 for an unknown session or
 *   another product's, 401 when the token is invalid, expired, revoked or
 *   another session's.
 * - Without it: Sanctum, the host only (SessionStatePresenter::host). 401
 *   when signed out, 403 feature_disabled without Quest v2 (DeckFeature),
 *   404 for anyone but the host.
 *
 * GET {session}/participant-state stays as a participant-only alias.
 * Both apply an overdue timer first (SessionStateMachine::syncDue).
 */
class SessionStateController extends DeckController
{
    public function __construct(
        private readonly SessionStateMachine $machine,
        private readonly ResolveDeckParticipant $participantAuth,
    ) {}

    public function show(Request $request, string $session): JsonResponse
    {
        if ($request->headers->has(ParticipantTokenService::HEADER)) {
            $this->participantAuth->handle($request, fn () => response()->noContent());

            return $this->participantView($request);
        }

        if (! Auth::guard('sanctum')->user()) {
            throw DeckException::unauthorized('Unauthenticated.');
        }

        // What auth:sanctum does after authenticating, so $request->user() is the host.
        Auth::shouldUse('sanctum');
        DeckFeature::assertEnabled($request->user(), $this->product($request));

        $deckSession = $this->machine->syncDue($this->ownedSession($request, $session));

        return $this->okResponse(SessionStatePresenter::host($deckSession));
    }

    /** GET {session}/participant-state (deck.participant middleware). */
    public function participantState(Request $request): JsonResponse
    {
        return $this->participantView($request);
    }

    private function participantView(Request $request): JsonResponse
    {
        $deckSession = $this->machine->syncDue($this->participantSession($request));

        return $this->okResponse(SessionStatePresenter::participant($deckSession, $this->participant($request)));
    }
}
