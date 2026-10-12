<?php

namespace App\Modules\FunGame\Http\Controllers;

use App\Http\Controllers\api\v1\ApiBaseController;
use App\Modules\FunGame\Http\Requests\SubmitAnswerRequest;
use App\Modules\FunGame\Http\Resources\SessionPresenter;
use App\Modules\FunGame\Models\FunGameParticipant;
use App\Modules\FunGame\Models\FunGameSession;
use App\Modules\FunGame\Services\FunGameException;
use App\Modules\FunGame\Services\ParticipantTokens;
use App\Modules\FunGame\Services\PlayerEngine;
use App\Modules\FunGame\Services\SessionEngine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Endpoints for a joined player, authenticated by X-Participant-Token.
 * A player only ever receives the question currently on their screen.
 */
class ParticipantSessionController extends ApiBaseController
{
    public function __construct(
        private readonly SessionEngine $engine,
        private readonly PlayerEngine $players,
        private readonly SessionPresenter $presenter,
        private readonly ParticipantTokens $tokens,
    ) {}

    public function state(Request $request, int $session): JsonResponse
    {
        [$s, $p] = $this->resolve($request, $session);

        return $this->okResponse([
            'session' => $this->presenter->state($s, $p->refresh()),
            'progress' => $this->presenter->progress($s, $p),
        ]);
    }

    /** The question on the player's screen now (opened on first request), or that they're done. */
    public function current(Request $request, int $session): JsonResponse
    {
        [$s, $p] = $this->resolve($request, $session);

        return $this->okResponse(['progress' => $this->players->current($s, $p)]);
    }

    /** Answer (or skip, with optionId null) the current question; returns the next one. */
    public function answer(SubmitAnswerRequest $request, int $session): JsonResponse
    {
        [$s, $p] = $this->resolve($request, $session);
        $data = $request->validated();
        $result = $this->players->submit($s, $p, (int) $data['questionId'], $data['optionId'] ?? null);
        if ($result['progress']['finished']) {
            // The last player finishing can end the session.
            $this->engine->sync($s);
        }

        return $this->okResponse($result, $result['ack']['accepted'] ? 'Answer saved.' : 'Answer not accepted.');
    }

    public function myResult(Request $request, int $session): JsonResponse
    {
        [$s, $p] = $this->resolve($request, $session);

        return $this->okResponse(['result' => $this->presenter->personalResult($s, $p->refresh())]);
    }

    public function leaderboard(Request $request, int $session): JsonResponse
    {
        [$s, $p] = $this->resolve($request, $session);

        return $this->okResponse(['leaderboard' => $this->presenter->leaderboard($s, false, $p)]);
    }

    /** @return array{0: FunGameSession, 1: FunGameParticipant} */
    private function resolve(Request $request, int $sessionId): array
    {
        $session = FunGameSession::with('game')->find($sessionId);
        if (! $session) {
            throw FunGameException::notFound('Session not found.');
        }
        $participant = $this->tokens->resolve($request, $session);
        if (! $participant) {
            throw FunGameException::unauthorized();
        }

        return [$this->engine->sync($session), $participant];
    }
}
