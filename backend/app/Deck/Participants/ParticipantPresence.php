<?php

namespace App\Deck\Participants;

use App\Deck\Broadcasts\DeckBroadcaster;
use App\Deck\Sessions\SessionStateMachine;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckSession;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Whether a participant is still in the room (deck_participants.left_at
 * null). Every count, auto-reveal check and leaderboard only considers
 * participants who have not left (ParticipantCountUpdatedPayload::countFor,
 * answeredCountFor, LeaderboardService), so a closed tab no longer holds a
 * quiz run open or shows up on the leaderboard.
 *
 * - leave(): POST .../participants/leave. Stamps left_at (once), then after
 *   the commit broadcasts `participant.count.updated` and, in a quiz, lets
 *   the current run reveal if everyone still in the room has answered. The
 *   token stays valid, so the same device can come back.
 * - returned(): the participant is back (a rejoin with their token, or an
 *   answer from them): clears left_at and broadcasts the count. Points and
 *   answers were never touched by leaving.
 * Both are conditional UPDATEs, so repeating them (a double leave, a rejoin
 * of someone who never left) changes and broadcasts nothing.
 */
class ParticipantPresence
{
    public function __construct(private readonly DeckBroadcaster $broadcaster) {}

    /** True when this call marked $participant as gone. */
    public function leave(DeckSession $session, DeckParticipant $participant): bool
    {
        $now = now();
        $changed = DeckParticipant::query()
            ->whereKey($participant->id)
            ->where('deck_session_id', $session->id)
            ->whereNull('left_at')
            ->update(['left_at' => $now, 'updated_at' => $now]) > 0;

        if (! $changed) {
            return false;
        }

        $participant->forceFill(['left_at' => $now]);
        $this->broadcaster->broadcastParticipantCount($session);

        if ($session->current_slide_run_id !== null) {
            $runId = (int) $session->current_slide_run_id;
            DB::afterCommit(function () use ($session, $runId) {
                try {
                    app(SessionStateMachine::class)->revealIfAllAnswered($session, $runId);
                } catch (Throwable $exception) {
                    // The leave is committed; the host or the timer still reveals.
                    report($exception);
                }
            });
        }

        return true;
    }

    /** True when $participant had left and is now back in the room. */
    public function returned(DeckSession $session, DeckParticipant $participant): bool
    {
        if ($participant->left_at === null) {
            return false;
        }

        $changed = DeckParticipant::query()
            ->whereKey($participant->id)
            ->where('deck_session_id', $session->id)
            ->whereNotNull('left_at')
            ->update(['left_at' => null, 'updated_at' => now()]) > 0;

        $participant->forceFill(['left_at' => null]);

        if ($changed) {
            $this->broadcaster->broadcastParticipantCount($session);
        }

        return $changed;
    }
}
