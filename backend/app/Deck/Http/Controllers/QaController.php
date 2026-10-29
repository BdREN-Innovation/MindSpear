<?php

namespace App\Deck\Http\Controllers;

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\Requests\Qa\ModerateQaQuestionRequest;
use App\Deck\Http\Requests\Qa\QaFeedRequest;
use App\Deck\Http\Requests\Qa\SubmitQaQuestionRequest;
use App\Deck\Http\Resources\QaQuestionPresenter;
use App\Deck\Participants\ParticipantReadAccess;
use App\Deck\Participants\SessionLookup;
use App\Deck\Qa\SessionQaService;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckSession;
use App\Deck\Participants\ParticipantTokenService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * Live audience Q&A (plan §3.1, §3.4) under /api/v1/quest-sessions
 * (routes/deck/quest_qa.php). Rules live in SessionQaService; item shapes in
 * QaQuestionPresenter (snake_case, identical to the realtime payloads).
 */
class QaController extends DeckController
{
    public function __construct(
        private readonly SessionQaService $qa,
        private readonly ParticipantReadAccess $readAccess,
    ) {}

    /** POST {session}/slide-runs/{run}/qa/questions (participant) → 201 {question}. */
    public function store(SubmitQaQuestionRequest $request, string $session, string $run): JsonResponse
    {
        $participant = $this->participant($request);
        $slideRun = $this->sessionRun($this->participantSession($request), $run);

        $question = $this->qa->submit($slideRun, $participant, $request->body());

        return $this->createdResponse([
            'question' => QaQuestionPresenter::forParticipant($question, $participant, false),
        ], 'Question submitted.');
    }

    /** POST {session}/qa/questions/{question}/upvote (participant) → {question_id, slide_run_id, upvote_count, has_upvoted: true}. */
    public function upvote(Request $request, string $session, string $question): JsonResponse
    {
        $participant = $this->participant($request);
        $model = $this->qa->question($this->participantSession($request), $question);

        return $this->okResponse(QaQuestionPresenter::vote($model, $this->qa->upvote($model, $participant), true));
    }

    /** DELETE {session}/qa/questions/{question}/upvote (participant) → same shape, has_upvoted: false. */
    public function removeUpvote(Request $request, string $session, string $question): JsonResponse
    {
        $participant = $this->participant($request);
        $model = $this->qa->question($this->participantSession($request), $question);

        return $this->okResponse(QaQuestionPresenter::vote($model, $this->qa->removeUpvote($model, $participant), false));
    }

    /** PATCH {session}/qa/questions/{question} (host) → {question} in the host shape. */
    public function moderate(ModerateQaQuestionRequest $request, string $session, string $question): JsonResponse
    {
        $model = $this->qa->question($this->ownedSession($request, $session), $question);

        return $this->okResponse([
            'question' => QaQuestionPresenter::forHost($this->qa->moderate($model, $request->flags())),
        ]);
    }

    /**
     * GET {session}/slide-runs/{run}/qa/questions?sort=top|new&limit=N.
     * With an X-Participant-Token header: that participant's feed (token
     * checked exactly like deck.participant: 404 session, 401 token).
     * Without one: the signed-in host's moderation feed (401 when signed
     * out, 404 when not the host).
     */
    public function index(QaFeedRequest $request, string $session, string $run): JsonResponse
    {
        [$deckSession, $participant] = $this->viewer($request, $session);

        $feed = $this->qa->feed($this->sessionRun($deckSession, $run), $participant, $request->sort(), $request->limit());

        return $this->okResponse(QaQuestionPresenter::feed($feed));
    }

    /** @return array{0: DeckSession, 1: ?DeckParticipant} */
    /**
     * The feed reader: with X-Participant-Token a participant, resolved like
     * my-answer and aggregate (ParticipantReadAccess), so a participant whose
     * token the session end revoked can still read it on the review screen
     * (plan §7.5); otherwise the Sanctum host.
     */
    private function viewer(Request $request, string $sessionId): array
    {
        if ($request->headers->has(ParticipantTokenService::HEADER)) {
            $deckSession = SessionLookup::forProduct($sessionId, $this->product($request));
            $participant = $this->readAccess->participant($request, $deckSession) ?? throw DeckException::unauthorized();
            $participant->setRelation('session', $deckSession);

            return [$deckSession, $participant];
        }

        if (! Auth::guard('sanctum')->user()) {
            throw DeckException::unauthorized('Unauthenticated.');
        }

        // What auth:sanctum does after authenticating, so $request->user() is the host.
        Auth::shouldUse('sanctum');

        return [$this->ownedSession($request, $sessionId), null];
    }
}
