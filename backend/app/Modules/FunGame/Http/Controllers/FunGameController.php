<?php

namespace App\Modules\FunGame\Http\Controllers;

use App\Http\Controllers\api\v1\ApiBaseController;
use App\Modules\FunGame\Models\FunGame;
use App\Modules\FunGame\Models\FunGameSession;
use App\Modules\FunGame\Services\FunGameException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/** Ownership lookups shared by the host controllers. Other people's games look like 404s. */
abstract class FunGameController extends ApiBaseController
{
    protected function ownedGame(Request $request, int|string $gameId): FunGame
    {
        $game = FunGame::find($gameId);
        if (! $game || Gate::forUser($request->user())->denies('manage', $game)) {
            throw FunGameException::notFound('Game not found.');
        }

        return $game;
    }

    protected function ownedSession(Request $request, int|string $sessionId): FunGameSession
    {
        $session = FunGameSession::with('game')->find($sessionId);
        if (! $session || ! $session->game || Gate::forUser($request->user())->denies('manage', $session->game)) {
            throw FunGameException::notFound('Session not found.');
        }

        return $session;
    }

    protected function ensureEditable(FunGame $game): void
    {
        if ($game->hasRunningSession()) {
            throw FunGameException::conflict('Questions and timer can\'t change while a session is running.');
        }
    }
}
