<?php

namespace App\Deck\Http\Controllers\Sessions;

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\Controllers\DeckController;
use App\Deck\Http\Resources\SessionStatePresenter;
use App\Deck\Sessions\JoinCodeGenerator;
use App\Models\Deck\DeckSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Audience side of a live session: the public join-code lookup (the resync is SessionStateController). */
class AudienceSessionController extends DeckController
{
    /**
     * GET /quest-sessions/v2/by-code/{code} (public). Case-insensitive; only
     * live sessions of the route's product; 404 otherwise.
     */
    public function byCode(Request $request, string $code): JsonResponse
    {
        $joinCode = JoinCodeGenerator::normalise($code);

        $session = $joinCode === null ? null : DeckSession::query()
            ->with('deck')
            ->where('join_code', $joinCode)
            ->live()
            ->forProduct($this->product($request))
            ->first();

        if (! $session) {
            throw DeckException::notFound('Session not found.');
        }

        return $this->okResponse(SessionStatePresenter::lookup($session));
    }

    /**
     * GET /play/by-code/{code}: the join page's lookup. Join codes are unique
     * across products, so one request finds a live Quest or Quiz session and
     * reports its product (no per-product misses against the 404 limiter).
     */
    public function byCodeAnyProduct(string $code): JsonResponse
    {
        $joinCode = JoinCodeGenerator::normalise($code);

        $session = $joinCode === null ? null : DeckSession::query()
            ->with('deck')
            ->where('join_code', $joinCode)
            ->live()
            ->first();

        if (! $session) {
            throw DeckException::notFound('Session not found.');
        }

        return $this->okResponse(SessionStatePresenter::lookup($session));
    }
}
