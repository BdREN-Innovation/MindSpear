<?php

namespace App\Deck\Http\Controllers;

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\Resources\SessionStatePresenter;
use App\Deck\Participants\ParticipantReadAccess;
use App\Deck\Participants\SessionLookup;
use App\Deck\Participants\SlideRunResultsService;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /{sessions prefix}/{session}/review: the participant's post-session
 * review screen (plan §7.5, "My Answers" and "All Slides") in one read.
 *
 * The live participant state only ever carries the current run, and every
 * token is revoked when the session ends, so without this a participant
 * could not list the runs to review. Auth is ParticipantReadAccess, the same
 * rule as my-answer, aggregate and the Q&A feed: a live token, or one the
 * session end revoked. Only for ended sessions (409 invalid_state with
 * reason session_not_ended otherwise), so a live session never shows its
 * upcoming slides early.
 *
 * Response (snake_case, like the other live endpoints):
 *   {session_id, session: {id, deck_id, product, deck_title, theme, status, total_slides,
 *    started_at, ended_at, public_channel_key},
 *    participant: {id, display_name, emoji_avatar},
 *    runs: [serializeForParticipant(run) + {my_answer: my-answer shape (Quiz: with
 *           correctness for revealed runs) | null,
 *           results_visibility: 'public'|'host',
 *           aggregate: the type's aggregate | null}, ...] in position order,
 *    server_time}
 * `aggregate` follows GET .../aggregate for participants: only for runs whose
 * results are public and that the host reached; null otherwise. Q&A questions
 * come from GET .../slide-runs/{run}/qa/questions with the same token.
 */
class ParticipantReviewController extends DeckController
{
    public function __construct(
        private readonly ParticipantReadAccess $access,
        private readonly SlideRunResultsService $results,
    ) {}

    public function show(Request $request, string $session): JsonResponse
    {
        $deckSession = SessionLookup::forProduct($session, $this->product($request));
        $participant = $this->access->participant($request, $deckSession) ?? throw DeckException::unauthorized();

        if ($deckSession->status !== DeckSession::STATUS_ENDED) {
            throw DeckException::invalidState('The review opens when the session has ended.', [
                'reason' => 'session_not_ended',
                'session_status' => $deckSession->status,
            ]);
        }

        $runs = $deckSession->runs()->get()->each(fn (DeckSessionSlideRun $run) => $run->setRelation('session', $deckSession));
        $answers = DeckParticipantAnswer::query()
            ->where('deck_participant_id', $participant->id)
            ->whereIn('slide_run_id', $runs->modelKeys())
            ->get()
            ->keyBy('slide_run_id');

        return $this->okResponse([
            'session_id' => (int) $deckSession->id,
            'session' => [
                'id' => (int) $deckSession->id,
                'deck_id' => (int) $deckSession->deck_id,
                'product' => $deckSession->deck?->product,
                'deck_title' => $deckSession->deck?->title,
                'theme' => SessionStatePresenter::theme($deckSession),
                'status' => $deckSession->status,
                'total_slides' => $runs->count(),
                'started_at' => $deckSession->started_at?->toISOString(),
                'ended_at' => $deckSession->ended_at?->toISOString(),
                'public_channel_key' => $deckSession->public_channel_key,
            ],
            'participant' => [
                'id' => (int) $participant->id,
                'display_name' => $participant->display_name,
                'emoji_avatar' => $participant->emoji_avatar,
            ],
            // The session is over: quiz runs show their options in this participant's order, whatever their state.
            'runs' => $runs->map(fn (DeckSessionSlideRun $run) => SessionStatePresenter::participantRun($run, $participant, false) + [
                'my_answer' => isset($answers[$run->id]) ? SessionStatePresenter::myAnswer($answers[$run->id], $run, $participant) : null,
                'results_visibility' => $this->results->visibility($run),
                'aggregate' => $this->aggregate($run),
            ])->values()->all(),
            'server_time' => now()->toISOString(),
        ]);
    }

    /** What GET .../aggregate would give this participant, or null where it answers 403 results_hidden. */
    private function aggregate(DeckSessionSlideRun $run): mixed
    {
        try {
            return $this->results->forParticipant($run)['aggregate'];
        } catch (DeckException $e) {
            if ($e->errorCode === SlideRunResultsService::CODE_RESULTS_HIDDEN) {
                return null;
            }

            throw $e;
        }
    }
}
