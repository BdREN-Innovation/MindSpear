<?php

namespace App\Deck\Http\Middleware;

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\DeckRoutes;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckSession;
use App\Deck\Participants\ParticipantTokenService;
use Closure;
use Illuminate\Http\Request;
use LogicException;
use Symfony\Component\HttpFoundation\Response;

/**
 * `deck.participant[:param]` — anonymous participant auth for session routes.
 *
 * Loads the session named by the {session} route parameter (or :param):
 * 404 when it does not exist or belongs to another product than the route.
 * Then resolves X-Participant-Token for that session through
 * ParticipantTokenService: 401 when the header is missing or the token is
 * unknown, expired or revoked. On success the participant (with its
 * `session` relation set) and the session are stored on the request; read
 * them with ResolveDeckParticipant::participant($request) / ::session($request).
 */
class ResolveDeckParticipant
{
    public const ALIAS = 'deck.participant';

    public const PARTICIPANT = 'deckParticipant';

    public const SESSION = 'deckSession';

    public function __construct(private readonly ParticipantTokenService $tokens) {}

    public function handle(Request $request, Closure $next, string $parameter = 'session'): Response
    {
        $session = $this->resolveSession($request, $parameter);

        $participant = $this->tokens->participantForDeckSession($request, $session);
        if (! $participant) {
            throw DeckException::unauthorized();
        }

        $participant->setRelation('session', $session);
        $request->attributes->set(self::PARTICIPANT, $participant);
        $request->attributes->set(self::SESSION, $session);

        return $next($request);
    }

    /** The participant resolved by this middleware. */
    public static function participant(Request $request): DeckParticipant
    {
        $participant = $request->attributes->get(self::PARTICIPANT);

        if (! $participant instanceof DeckParticipant) {
            throw new LogicException('No deck participant on this request; add the deck.participant middleware to the route.');
        }

        return $participant;
    }

    /** The session the participant belongs to (deck relation loaded). */
    public static function session(Request $request): DeckSession
    {
        $session = $request->attributes->get(self::SESSION);

        if (! $session instanceof DeckSession) {
            throw new LogicException('No deck session on this request; add the deck.participant middleware to the route.');
        }

        return $session;
    }

    /** Rate-limit key for participant routes: the token's hash, or the IP without one. */
    public static function throttleKey(Request $request): string
    {
        $token = $request->header(ParticipantTokenService::HEADER);

        return is_string($token) && $token !== ''
            ? 'pt:' . hash('sha256', $token)
            : 'ip:' . $request->ip();
    }

    private function resolveSession(Request $request, string $parameter): DeckSession
    {
        $value = $request->route($parameter);

        $session = $value instanceof DeckSession
            ? $value->loadMissing('deck')
            : (($id = DeckRoutes::id($value)) !== null ? DeckSession::with('deck')->find($id) : null);

        $product = DeckRoutes::productOf($request->route());

        if (! $session || ! $session->deck || ($product !== null && $session->deck->product !== $product)) {
            throw DeckException::notFound('Session not found.');
        }

        return $session;
    }
}
