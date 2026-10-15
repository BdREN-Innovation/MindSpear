<?php

namespace App\Deck\Http\Middleware;

use App\Deck\Http\DeckRoutes;
use App\Deck\Support\DeckFeature;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * `deck.feature` — authoring and host-only routes: 403 feature_disabled
 * unless the signed-in user has the route product's v2 (DeckFeature). Put it
 * after auth:sanctum. Dual host/participant routes (state, aggregate, Q&A
 * feed) check DeckFeature on their host branch instead.
 */
class EnsureDeckFeatureEnabled
{
    public const ALIAS = 'deck.feature';

    public function handle(Request $request, Closure $next): Response
    {
        DeckFeature::assertEnabled($request->user(), DeckRoutes::product($request));

        return $next($request);
    }
}
