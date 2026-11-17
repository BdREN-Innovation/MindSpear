<?php

namespace App\Deck\Http\Middleware;

use App\Deck\Exceptions\DeckException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Rejects answer submissions whose body is larger than
 * config('deck.max_answer_body_kb') with 413 {code: payload_too_large,
 * max_kb}. Runs before participant auth and validation, so an oversized
 * body never reaches the database or the validator's wildcard expansion.
 */
class LimitAnswerBodySize
{
    public const CODE = 'payload_too_large';

    public function handle(Request $request, Closure $next): Response
    {
        $maxKb = max(1, (int) config('deck.max_answer_body_kb', 32));
        $limit = $maxKb * 1024;

        $declared = $request->header('Content-Length');
        $declared = is_numeric($declared) ? (int) $declared : 0;

        if ($declared > $limit || strlen((string) $request->getContent()) > $limit) {
            throw new DeckException("The answer is too large (at most {$maxKb} KB).", 413, self::CODE, ['max_kb' => $maxKb]);
        }

        return $next($request);
    }
}
