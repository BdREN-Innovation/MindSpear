<?php

namespace App\Modules\FunGame\Http\Controllers;

use App\Modules\FunGame\Http\Requests\StartSessionRequest;
use App\Modules\FunGame\Http\Resources\SessionPresenter;
use App\Modules\FunGame\Models\FunGameSession;
use App\Modules\FunGame\Services\SessionEngine;
use App\Modules\FunGame\Services\TimerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class HostSessionController extends FunGameController
{
    public function __construct(
        private readonly SessionEngine $engine,
        private readonly SessionPresenter $presenter,
        private readonly TimerService $timer,
    ) {}

    public function store(StartSessionRequest $request, int $game): JsonResponse
    {
        $model = $this->ownedGame($request, $game);
        $startsAt = $request->validated()['startsAt'] ?? null;
        $session = $this->engine->createSession($model, $startsAt ? Carbon::parse($startsAt) : null);

        return $this->createdResponse(['session' => $this->presenter->hostDetail($session->load('game'))], 'Lobby open.');
    }

    public function index(Request $request): JsonResponse
    {
        $statuses = array_filter(explode(',', (string) $request->query('status', '')));
        $sessions = FunGameSession::query()
            ->whereHas('game', fn ($q) => $q->where('user_id', $request->user()->id))
            ->when($statuses, fn ($q) => $q->whereIn('status', $statuses))
            ->with('game')
            ->withCount('participants')
            ->latest()
            ->limit(100)
            ->get();

        return $this->okResponse(['sessions' => $sessions->map(fn (FunGameSession $s) => [
            'id' => (string) $s->id,
            'quizId' => (string) $s->fun_game_id,
            'quizTitle' => $s->game->title,
            'status' => $s->status,
            'joinCode' => $s->join_code,
            'startsAt' => TimerService::iso($s->starts_at),
            'startedAt' => TimerService::iso($s->started_at),
            'finishedAt' => TimerService::iso($s->finished_at),
            'participantCount' => $s->participants_count,
            'timer' => $this->timer->config($s->game, $s->timer_snapshot),
        ])->all()]);
    }

    public function show(Request $request, int $session): JsonResponse
    {
        $model = $this->engine->sync($this->ownedSession($request, $session));

        return $this->okResponse(['session' => $this->presenter->hostDetail($model)]);
    }

    public function start(Request $request, int $session): JsonResponse
    {
        $model = $this->engine->start($this->ownedSession($request, $session));

        return $this->okResponse(['session' => $this->presenter->hostDetail($model)], 'Game started.');
    }

    public function end(Request $request, int $session): JsonResponse
    {
        $model = $this->engine->end($this->ownedSession($request, $session));

        return $this->okResponse(['session' => $this->presenter->hostDetail($model)], 'Game ended. Scoring now.');
    }

    public function leaderboard(Request $request, int $session): JsonResponse
    {
        $model = $this->engine->sync($this->ownedSession($request, $session));

        return $this->okResponse(['leaderboard' => $this->presenter->leaderboard($model, true)]);
    }

    public function participants(Request $request, int $session): JsonResponse
    {
        $model = $this->ownedSession($request, $session);

        return $this->okResponse(['participants' => $model->participants()->orderBy('joined_at')->get()
            ->map(fn ($p) => $this->presenter->participantSummary($p))->all()]);
    }
}
