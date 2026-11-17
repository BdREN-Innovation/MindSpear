<?php

namespace App\Modules\FunGame\Http\Controllers;

use App\Http\Controllers\api\v1\ApiBaseController;
use App\Modules\FunGame\Http\Requests\JoinSessionRequest;
use App\Modules\FunGame\Http\Resources\SessionPresenter;
use App\Modules\FunGame\Models\FunGameSession;
use App\Modules\FunGame\Services\FunGameException;
use App\Modules\FunGame\Services\SessionEngine;
use App\Modules\FunGame\Services\TimerService;
use Illuminate\Http\JsonResponse;

/** No login: anyone with the join code (from the QR) can look up and join a game. */
class PublicJoinController extends ApiBaseController
{
    public function __construct(
        private readonly SessionEngine $engine,
        private readonly SessionPresenter $presenter,
        private readonly TimerService $timer,
    ) {}

    public function show(string $joinCode): JsonResponse
    {
        $session = $this->engine->sync($this->session($joinCode));
        $game = $session->game;

        return $this->okResponse([
            'session' => [
                'id' => (string) $session->id,
                'status' => $session->status,
                'joinCode' => $session->join_code,
                'startsAt' => TimerService::iso($session->starts_at),
                'participantCount' => $session->participants()->count(),
                'joinOpen' => $session->isJoinOpen(),
                'joinClosesAt' => TimerService::iso($session->join_closes_at),
                'serverTime' => TimerService::iso(now()),
            ],
            'game' => [
                'title' => $game->title,
                'description' => $game->description ?? '',
                'instructions' => $game->instructions ?? '',
                'questionCount' => $session->questionsPerPlayer(),
                'timer' => $this->timer->config($game, $session->timer_snapshot),
            ],
        ]);
    }

    public function join(JoinSessionRequest $request, string $joinCode): JsonResponse
    {
        $session = $this->session($joinCode);
        $data = $request->validated();
        $result = $this->engine->join($session, $data['name'], $data['email']);
        $session = FunGameSession::with('game')->find($session->id);

        return $this->okResponse([
            'participantToken' => $result['token'],
            'participantId' => (string) $result['participant']->id,
            'rejoined' => $result['rejoined'],
            'publicChannelKey' => $session->public_channel_key,
            'session' => $this->presenter->state($session, $result['participant']),
        ], $result['rejoined'] ? 'Welcome back.' : 'Joined.');
    }

    private function session(string $joinCode): FunGameSession
    {
        $session = FunGameSession::with('game')
            ->where('join_code', strtoupper(trim($joinCode)))
            ->first();
        if (! $session || ! $session->game || $session->game->trashed()) {
            throw FunGameException::notFound('No game found for this code. Check it and try again.');
        }

        return $session;
    }
}
