<?php

namespace App\Deck\Http\Controllers;

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\Requests\SubmitDeckAnswerRequest;
use App\Deck\Participants\AnswerSubmissionService;
use App\Deck\Participants\ParticipantReadAccess;
use App\Deck\Participants\SessionLookup;
use App\Models\Deck\DeckParticipantAnswer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/** Participant answers (X-Participant-Token). */
class ParticipantAnswerController extends DeckController
{
    public function __construct(
        private readonly AnswerSubmissionService $answers,
        private readonly ParticipantReadAccess $access,
    ) {}

    /**
     * POST /{sessions prefix}/{session}/slide-runs/{run}/answers
     * Body {answer_payload} → 204. 404 run not in the session, 409 invalid_state
     * (data.reason: no_answers | session_not_live | not_current_slide | not_voting | time_up),
     * 413 payload_too_large, 422 answer_payload.*.
     */
    public function store(SubmitDeckAnswerRequest $request, string $session, string $run): Response
    {
        $deckSession = $this->participantSession($request);

        $this->answers->submit(
            $deckSession,
            $this->participant($request),
            $this->sessionRun($deckSession, $run),
            (array) $request->validated('answer_payload', []),
        );

        return response()->noContent();
    }

    /**
     * GET /{sessions prefix}/{session}/slide-runs/{run}/my-answer
     * → {slide_run_id, answer_payload (as stored), time_to_answer_ms, submitted_at}; 404 when none.
     * Read-only, so it also accepts the token of an ended session (ParticipantReadAccess):
     * the post-session review screen lists the participant's own answers.
     *
     * @throws DeckException 404 session/run not found or no answer, 401 no valid token
     */
    public function show(Request $request, string $session, string $run): JsonResponse
    {
        $deckSession = SessionLookup::forProduct($session, $this->product($request));
        $participant = $this->access->participant($request, $deckSession) ?? throw DeckException::unauthorized();
        $slideRun = $this->sessionRun($deckSession, $run);

        $answer = DeckParticipantAnswer::query()
            ->where('deck_participant_id', $participant->id)
            ->where('slide_run_id', $slideRun->id)
            ->first();

        if (! $answer) {
            throw DeckException::notFound('You have not answered this slide.');
        }

        return $this->okResponse([
            'slide_run_id' => $slideRun->id,
            'answer_payload' => ($answer->answer_payload ?? []) === [] ? (object) [] : $answer->answer_payload,
            'time_to_answer_ms' => $answer->time_to_answer_ms,
            'submitted_at' => $answer->submitted_at?->toISOString(),
        ]);
    }
}
