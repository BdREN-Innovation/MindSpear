<?php

namespace App\Deck\Results;

use App\Deck\Http\Resources\SessionStatePresenter;
use App\Deck\Legacy\LegacyDeckImport;
use App\Deck\Legacy\LegacyResults;
use App\Deck\Slides\SlideTypeRegistry;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * My Library > a quiz or quest > its sessions and their results (host only).
 *
 * - sessions(): every session the user hosted from a deck, newest first.
 * - results(): one session after the fact: each slide that takes answers and
 *   was reached, as the presenter saw it (participant view + final aggregate,
 *   SessionStatePresenter::presenterRun), plus every participant with their
 *   totals. Unlike the live leaderboard, people who closed their tab
 *   (left_at set) are still listed and ranked: they took part.
 * - csv(): the same participants, one column per slide with their answer.
 */
class SessionResultsService
{
    public function __construct(
        private readonly SlideTypeRegistry $registry,
        private readonly LegacyResults $legacy,
    ) {}

    /**
     * Sessions of the previous version's quiz / quest this deck was converted from
     * (LegacyDeckImport), grouped by source; opened through /legacy-results.
     *
     * @return list<array{source: string, id: int, title: string, sessions: list<array<string, mixed>>}>
     */
    public function legacySessions(Deck $deck, User $owner): array
    {
        $imports = LegacyDeckImport::query()
            ->where('deck_id', $deck->id)
            ->where('source_type', $deck->product)
            ->orderBy('source_id')
            ->get(['source_type', 'source_id']);

        $groups = [];
        foreach ($imports as $import) {
            $found = $this->legacy->show($owner, $import->source_type, (int) $import->source_id);
            if ($found !== null && $found['sessions'] !== []) {
                $groups[] = [
                    'source' => $found['source'],
                    'id' => $found['id'],
                    'title' => $found['title'],
                    'sessions' => $found['sessions'],
                ];
            }
        }

        return $groups;
    }

    /** @return list<array<string, mixed>> */
    public function sessions(Deck $deck, int $hostUserId): array
    {
        $sessions = DeckSession::query()
            ->where('deck_id', $deck->id)
            ->where('host_user_id', $hostUserId)
            ->orderByDesc('id')
            ->limit(500)
            ->get();

        $ids = $sessions->pluck('id')->all();
        $participants = $ids === [] ? collect() : DeckParticipant::query()->toBase()
            ->whereIn('deck_session_id', $ids)
            ->groupBy('deck_session_id')
            ->selectRaw('deck_session_id, COUNT(*) AS n')
            ->pluck('n', 'deck_session_id');
        $answers = $ids === [] ? collect() : DB::table('deck_participant_answers as a')
            ->join('deck_participants as p', 'p.id', '=', 'a.deck_participant_id')
            ->whereIn('p.deck_session_id', $ids)
            ->groupBy('p.deck_session_id')
            ->selectRaw('p.deck_session_id, COUNT(*) AS n')
            ->pluck('n', 'deck_session_id');

        return $sessions->map(fn (DeckSession $s) => [
            'id' => (int) $s->id,
            'status' => $s->status,
            'join_code' => $s->join_code,
            'created_at' => $s->created_at?->toISOString(),
            'started_at' => $s->started_at?->toISOString(),
            'ended_at' => $s->ended_at?->toISOString(),
            'participant_count' => (int) ($participants[$s->id] ?? 0),
            'answer_count' => (int) ($answers[$s->id] ?? 0),
        ])->values()->all();
    }

    public function results(DeckSession $session): array
    {
        $session->loadMissing('deck');
        $runs = $this->answerRuns($session);
        $scored = $session->deck?->product === Deck::PRODUCT_QUIZ;

        return [
            'session' => [
                'id' => (int) $session->id,
                'deck_id' => (int) $session->deck_id,
                'product' => $session->deck?->product,
                'deck_title' => $session->deck?->title,
                'theme' => SessionStatePresenter::theme($session),
                'status' => $session->status,
                'join_code' => $session->join_code,
                'started_at' => $session->started_at?->toISOString(),
                'ended_at' => $session->ended_at?->toISOString(),
            ],
            'scored' => $scored,
            'runs' => $runs->map(fn (DeckSessionSlideRun $run) => SessionStatePresenter::presenterRun($run))->values()->all(),
            'participants' => $this->participants($session, $runs),
            'server_time' => now()->toISOString(),
        ];
    }

    /** @return iterable<list<string|int|null>> rows, header first */
    public function csv(DeckSession $session): iterable
    {
        $runs = $this->answerRuns($session);
        $participants = $this->participants($session, $runs);
        $scored = $session->deck?->product === Deck::PRODUCT_QUIZ;

        $header = $scored ? ['Rank', 'Name', 'Points', 'Correct', 'Answered', 'Joined'] : ['Name', 'Answered', 'Joined'];
        foreach ($runs->values() as $i => $run) {
            $title = trim((string) $run->title_snapshot);
            $header[] = 'Q' . ($i + 1) . ($title !== '' ? ': ' . mb_substr($title, 0, 80) : '');
        }
        yield $header;

        $answers = DeckParticipantAnswer::query()
            ->whereIn('slide_run_id', $runs->pluck('id'))
            ->get(['deck_participant_id', 'slide_run_id', 'answer_payload', 'is_correct'])
            ->groupBy('deck_participant_id');

        foreach ($participants as $p) {
            $row = $scored
                ? [$p['rank'], $p['display_name'], $p['total_points'], $p['correct'], $p['answered'], $p['joined_at']]
                : [$p['display_name'], $p['answered'], $p['joined_at']];
            $mine = ($answers[$p['participant_id']] ?? collect())->keyBy('slide_run_id');
            foreach ($runs as $run) {
                $answer = $mine[$run->id] ?? null;
                if (! $answer) {
                    $row[] = '';

                    continue;
                }
                $text = AnswerText::format($answer->answer_payload ?? [], $run->options_snapshot ?? []);
                $mark = $answer->is_correct === null ? '' : ($answer->is_correct ? ' ✓' : ' ✗');
                $row[] = $text . $mark;
            }
            yield $row;
        }
    }

    /** Runs that take answers and were reached (left `waiting`), in slide order. */
    private function answerRuns(DeckSession $session): Collection
    {
        return $session->runs()
            ->where('state', '!=', DeckSessionSlideRun::STATE_WAITING)
            ->get()
            ->filter(function (DeckSessionSlideRun $run) {
                $type = (string) $run->type_snapshot;

                return $this->registry->has($type) && $this->registry->for($type)->acceptsAnswers();
            })
            ->each(fn (DeckSessionSlideRun $run) => $run->setRelation('session', $session))
            ->values();
    }

    /**
     * Everyone who joined, best first: points (quiz), then answered, then join time.
     * Ties on points share a rank (1, 2, 2, 4), as on the live leaderboard.
     *
     * @return list<array{rank:?int, participant_id:int, display_name:?string, emoji_avatar:?string, total_points:int, answered:int, correct:int, joined_at:?string, left:bool}>
     */
    private function participants(DeckSession $session, Collection $runs): array
    {
        $counts = DeckParticipantAnswer::query()->toBase()
            ->whereIn('slide_run_id', $runs->pluck('id'))
            ->groupBy('deck_participant_id')
            ->selectRaw('deck_participant_id, COUNT(*) AS answered, COUNT(*) FILTER (WHERE is_correct) AS correct')
            ->get()
            ->keyBy('deck_participant_id');

        $rows = DeckParticipant::query()
            ->where('deck_session_id', $session->id)
            ->get(['id', 'display_name', 'emoji_avatar', 'total_points', 'joined_at', 'created_at', 'left_at'])
            ->map(fn (DeckParticipant $p) => [
                'participant_id' => (int) $p->id,
                'display_name' => $p->display_name,
                'emoji_avatar' => $p->emoji_avatar,
                'total_points' => (int) ($p->total_points ?? 0),
                'answered' => (int) ($counts[$p->id]->answered ?? 0),
                'correct' => (int) ($counts[$p->id]->correct ?? 0),
                'joined_at' => ($p->joined_at ?? $p->created_at)?->toISOString(),
                'left' => $p->left_at !== null,
            ])
            ->sort(fn ($a, $b) => [$b['total_points'], $b['answered'], $a['joined_at'] ?? '', $a['participant_id']]
                <=> [$a['total_points'], $a['answered'], $b['joined_at'] ?? '', $b['participant_id']])
            ->values();

        $rank = 0;
        $previous = null;

        return $rows->map(function (array $row, int $index) use (&$rank, &$previous) {
            if ($row['total_points'] !== $previous) {
                $rank = $index + 1;
                $previous = $row['total_points'];
            }

            return ['rank' => $rank] + $row;
        })->all();
    }
}
