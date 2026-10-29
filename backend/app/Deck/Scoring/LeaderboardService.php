<?php

namespace App\Deck\Scoring;

use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Support\Facades\Cache;

/**
 * Quiz session ranking (QUIZ_REDESIGN_PLAN.md §1.4).
 *
 * Ranking: every participant still in the session (left_at null) by
 * deck_participants.total_points desc (null = 0), then earliest joined_at
 * (created_at when null), then id. Equal totals share a rank (1, 2, 2, 4).
 * total_points only moves when a scored run is revealed
 * (QuizRuntime::applyRevealedPoints), so rankings never change while a run
 * takes answers. points_delta is what the participant earned on one slide
 * run: SUM(deck_participant_answers.points_awarded).
 *
 * Snapshots: ranking() "after run R" (R = null before any scored run) is
 * cached under leaderboard:deck_session:{id}:after:{R id or 0} for
 * CACHE_TTL_SECONDS and rebuilt on a miss, never replayed incrementally.
 * Each entry carries a fingerprint of the session's active participants
 * (count, max id, sum and id-weighted sum of total_points, latest
 * updated_at), so a join, a leave / return or a reveal rebuilds it without
 * an explicit forget().
 * forget() drops every snapshot of a session.
 *
 * "Latest scored run" (currentTopN, standing): the run with the highest
 * position at or before the session's current run whose state is reveal or
 * closed and whose type is a scored Quiz type (accepts answers,
 * hidden_until_reveal).
 */
class LeaderboardService
{
    public const CACHE_TTL_SECONDS = 3600;

    /** Run states after which a scored run counts as played (DeckSessionSlideRun::STATE_REVEAL is 'reveal'). */
    public const PLAYED_STATES = ['reveal', DeckSessionSlideRun::STATE_CLOSED];

    public function __construct(private readonly SlideTypeRegistry $types) {}

    /**
     * Top $n of the ranking, with points_delta from the latest scored run.
     *
     * @return list<array{rank:int, participant_id:int, display_name:?string, emoji_avatar:?string, total_points:int, points_delta:int}>
     */
    public function currentTopN(DeckSession $session, int $n = 10): array
    {
        if ($n < 1) {
            return [];
        }

        return array_slice($this->ranking($session, $this->latestScoredRun($session)), 0, $n);
    }

    /**
     * One participant's row of the ranking after $run (default: the latest
     * scored run); null when they are not in the session. For my-answer's
     * total_points / rank.
     *
     * @return array{rank:int, participant_id:int, display_name:?string, emoji_avatar:?string, total_points:int, points_delta:int}|null
     */
    public function standing(DeckSession $session, int $participantId, ?DeckSessionSlideRun $run = null): ?array
    {
        $run ??= $this->latestScoredRun($session);

        foreach ($this->ranking($session, $run) as $row) {
            if ($row['participant_id'] === $participantId) {
                return $row;
            }
        }

        return null;
    }

    /**
     * Points each participant earned on $run (participants who answered;
     * null points count as 0). [] when $run is not a run of $session.
     *
     * @return array<int, int> participant id => points
     */
    public function pointsDeltaAfterSlideRun(DeckSession $session, DeckSessionSlideRun $run): array
    {
        if ((int) $run->deck_session_id !== (int) $session->id) {
            return [];
        }

        return DeckParticipantAnswer::query()->toBase()
            ->where('slide_run_id', $run->id)
            ->groupBy('deck_participant_id')
            ->orderBy('deck_participant_id')
            ->selectRaw('deck_participant_id, COALESCE(SUM(points_awarded), 0) AS points')
            ->pluck('points', 'deck_participant_id')
            ->mapWithKeys(fn ($points, $id) => [(int) $id => (int) $points])
            ->all();
    }

    /**
     * Leaderboard movement for $run (slide.revealed `leaderboard_delta`):
     * ranking rows after $run, best first, at most $limit (null = everyone).
     * Cut it before broadcasting: 500 rows do not fit one Reverb publish.
     *
     * @return list<array{participant_id:int, points_delta:int, new_total:int, new_rank:int}>
     */
    public function revealDelta(DeckSession $session, DeckSessionSlideRun $run, ?int $limit = null): array
    {
        $rows = $this->ranking($session, $run);
        if ($limit !== null) {
            $rows = array_slice($rows, 0, max(0, $limit));
        }

        return array_map(fn (array $row) => [
            'participant_id' => $row['participant_id'],
            'points_delta' => $row['points_delta'],
            'new_total' => $row['total_points'],
            'new_rank' => $row['rank'],
        ], $rows);
    }

    /** Drops every cached snapshot of $session. */
    public function forget(DeckSession $session): void
    {
        $keys = [self::cacheKey((int) $session->id, null)];
        foreach (DeckSessionSlideRun::query()->where('deck_session_id', $session->id)->pluck('id') as $runId) {
            $keys[] = self::cacheKey((int) $session->id, (int) $runId);
        }

        Cache::deleteMultiple($keys);
    }

    public static function cacheKey(int $sessionId, ?int $runId): string
    {
        return "leaderboard:deck_session:{$sessionId}:after:" . ($runId ?? 0);
    }

    /** The latest played scored run at or before the current slide; null before any. */
    public function latestScoredRun(DeckSession $session): ?DeckSessionSlideRun
    {
        $current = $session->current_slide_run_id
            ? DeckSessionSlideRun::query()->whereKey($session->current_slide_run_id)->value('position_snapshot')
            : null;

        return DeckSessionSlideRun::query()
            ->where('deck_session_id', $session->id)
            ->whereIn('state', self::PLAYED_STATES)
            ->when($current !== null, fn ($query) => $query->where('position_snapshot', '<=', $current))
            ->orderByDesc('position_snapshot')
            ->orderByDesc('id')
            ->get(['id', 'deck_session_id', 'type_snapshot', 'position_snapshot', 'state'])
            ->first(fn (DeckSessionSlideRun $run) => $this->isScored((string) $run->type_snapshot));
    }

    /**
     * Full ranking after $run, from the cache when the participants have not changed.
     *
     * @return list<array{rank:int, participant_id:int, display_name:?string, emoji_avatar:?string, total_points:int, points_delta:int}>
     */
    public function ranking(DeckSession $session, ?DeckSessionSlideRun $run): array
    {
        $key = self::cacheKey((int) $session->id, $run?->id);
        $fingerprint = $this->fingerprint($session);

        $cached = Cache::get($key);
        if (is_array($cached) && ($cached['fingerprint'] ?? null) === $fingerprint && is_array($cached['rows'] ?? null)) {
            return $cached['rows'];
        }

        $rows = $this->build($session, $run);
        Cache::put($key, ['fingerprint' => $fingerprint, 'rows' => $rows], self::CACHE_TTL_SECONDS);

        return $rows;
    }

    private function build(DeckSession $session, ?DeckSessionSlideRun $run): array
    {
        $deltas = $run ? $this->pointsDeltaAfterSlideRun($session, $run) : [];

        $participants = DeckParticipant::query()->toBase()
            ->where('deck_session_id', $session->id)
            ->whereNull('left_at')
            ->orderByRaw('COALESCE(total_points, 0) DESC')
            ->orderByRaw('COALESCE(joined_at, created_at) ASC NULLS LAST')
            ->orderBy('id')
            ->get(['id', 'display_name', 'emoji_avatar', 'total_points']);

        $rows = [];
        $rank = 0;
        $previous = null;
        foreach ($participants->values() as $index => $participant) {
            $total = (int) ($participant->total_points ?? 0);
            if ($total !== $previous) {
                $rank = $index + 1;
                $previous = $total;
            }

            $rows[] = [
                'rank' => $rank,
                'participant_id' => (int) $participant->id,
                'display_name' => $participant->display_name,
                'emoji_avatar' => $participant->emoji_avatar,
                'total_points' => $total,
                'points_delta' => $deltas[(int) $participant->id] ?? 0,
            ];
        }

        return $rows;
    }

    /** Changes whenever a participant joins, leaves the table or gains / loses points. */
    private function fingerprint(DeckSession $session): string
    {
        $row = DeckParticipant::query()->toBase()
            ->where('deck_session_id', $session->id)
            ->whereNull('left_at')
            ->selectRaw('COUNT(*) AS n, COALESCE(MAX(id), 0) AS max_id, COALESCE(SUM(COALESCE(total_points, 0)), 0) AS points,'
                . ' COALESCE(SUM(COALESCE(total_points, 0)::bigint * id), 0) AS weighted, MAX(updated_at) AS updated')
            ->first();

        return implode('|', [$row->n ?? 0, $row->max_id ?? 0, $row->points ?? 0, $row->weighted ?? 0, $row->updated ?? '']);
    }

    private function isScored(string $type): bool
    {
        if (! $this->types->has($type)) {
            return false;
        }

        $type = $this->types->for($type);

        return $type->acceptsAnswers() && $type->revealModel() === SlideTypeContract::REVEAL_HIDDEN;
    }
}
