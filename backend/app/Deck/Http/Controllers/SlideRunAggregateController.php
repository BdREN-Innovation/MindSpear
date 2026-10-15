<?php

namespace App\Deck\Http\Controllers;

use App\Deck\Exceptions\DeckException;
use App\Deck\Participants\ParticipantReadAccess;
use App\Deck\Participants\SessionLookup;
use App\Deck\Participants\SlideRunResultsService;
use App\Deck\Sessions\SessionStateMachine;
use App\Deck\Support\DeckFeature;
use App\Services\Live\ParticipantTokenService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * GET /{sessions prefix}/{session}/slide-runs/{run}/aggregate[?page=N]
 *
 * Callable by the host (Sanctum, hosting this session: always answered) or a
 * participant (X-Participant-Token: only when the run's results are public,
 * else 403 results_hidden, also for a run the host has not reached yet). A
 * participant's token keeps working here after the session ended (review
 * screen, ParticipantReadAccess). A signed-in user who does not host the
 * session and sends no token gets 404; no credentials at all is 401. A host
 * without Quest v2 (DeckFeature) gets 403 feature_disabled, unless the
 * request carries a participant token (then it is a participant read).
 *
 * Like GET state, an overdue timer is applied first
 * (SessionStateMachine::syncDue), so a late timer job never leaves the
 * aggregate reporting voting / final=false after the deadline.
 */
class SlideRunAggregateController extends DeckController
{
    public function __construct(
        private readonly SlideRunResultsService $results,
        private readonly ParticipantReadAccess $access,
        private readonly SessionStateMachine $machine,
    ) {}

    public function show(Request $request, string $session, string $run): JsonResponse
    {
        $product = $this->product($request);
        $deckSession = SessionLookup::forProduct($session, $product);
        $page = $request->validate(['page' => ['sometimes', 'integer', 'min:1', 'max:100000']])['page'] ?? null;
        $page = $page === null ? null : (int) $page;

        $user = $request->user('sanctum');
        $sentToken = filled($request->header(ParticipantTokenService::HEADER));

        if ($user && Gate::forUser($user)->allows('manage', $deckSession)) {
            if (DeckFeature::enabled($user, $product)) {
                return $this->okResponse($this->results->forHost($this->sessionRun($this->machine->syncDue($deckSession), $run), $page));
            }

            // A host without Quest v2: 403, unless this is a participant's read (token sent).
            if (! $sentToken) {
                DeckFeature::assertEnabled($user, $product);
            }
        }

        $participant = $this->access->participant($request, $deckSession);
        if (! $participant) {
            throw $user && ! $sentToken ? DeckException::notFound('Session not found.') : DeckException::unauthorized();
        }

        return $this->okResponse($this->results->forParticipant($this->sessionRun($this->machine->syncDue($deckSession), $run), $page));
    }
}
