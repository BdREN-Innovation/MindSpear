<?php

namespace App\Deck\Http\Controllers;

use App\Deck\Broadcasts\Payloads\ParticipantCountUpdatedPayload;
use App\Deck\Exceptions\DeckException;
use App\Deck\Participants\ParticipantReadAccess;
use App\Deck\Participants\SessionLookup;
use App\Deck\Sessions\QuizRuntime;
use App\Deck\Participants\ParticipantTokenService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Gate;

/**
 * GET /quiz-sessions/{session}/leaderboard[?limit=N] (Quiz plan §2.1):
 * the top N players by total_points (LeaderboardService::currentTopN), with
 * each one's points_delta from the last revealed slide.
 *
 * - With X-Participant-Token: a participant of the session (also after the
 *   end, like my-answer: ParticipantReadAccess); `me` is their own
 *   {participant_id, total_points, rank}. 401 for a bad token.
 * - Without it: Sanctum, the host only. 401 signed out, 404 for anyone but
 *   the host; `me` null.
 *
 * limit: 1..config deck.quiz.leaderboard_max (default deck.quiz.leaderboard_size).
 */
class LeaderboardController extends DeckController
{
    public function __construct(
        private readonly ParticipantReadAccess $access,
        private readonly QuizRuntime $quiz,
    ) {}

    public function show(Request $request, string $session): JsonResponse
    {
        $product = $this->product($request);
        $max = QuizRuntime::clampSize(PHP_INT_MAX);
        $limit = $request->validate(['limit' => ['sometimes', 'integer', 'min:1', 'max:' . $max]])['limit'] ?? null;
        $n = QuizRuntime::clampSize($limit === null ? null : (int) $limit);

        $participant = null;

        if ($request->headers->has(ParticipantTokenService::HEADER)) {
            $deckSession = SessionLookup::forProduct($session, $product);
            $participant = $this->access->participant($request, $deckSession) ?? throw DeckException::unauthorized();
        } else {
            $user = Auth::guard('sanctum')->user() ?? throw DeckException::unauthorized('Unauthenticated.');

            $deckSession = SessionLookup::forProduct($session, $product);
            if (Gate::forUser($user)->denies('manage', $deckSession)) {
                throw DeckException::notFound('Session not found.');
            }
        }

        return $this->okResponse([
            'session_id' => (int) $deckSession->id,
            'status' => $deckSession->status,
            'top_n' => $n,
            'participant_count' => ParticipantCountUpdatedPayload::countFor($deckSession),
            'leaderboard' => $this->quiz->leaderboard($deckSession, $n),
            'me' => $participant ? $this->quiz->standing($deckSession, $participant) : null,
            'server_time' => now()->toISOString(),
        ]);
    }
}
