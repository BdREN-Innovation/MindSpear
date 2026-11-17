<?php

namespace App\Modules\FunGame\Http\Resources;

use App\Modules\FunGame\Models\FunGame;
use App\Modules\FunGame\Models\FunGameAnswer;
use App\Modules\FunGame\Models\FunGameParticipant;
use App\Modules\FunGame\Models\FunGameQuestion;
use App\Modules\FunGame\Models\FunGameSession;
use App\Modules\FunGame\Services\ScoringService;
use App\Modules\FunGame\Services\TimerService;

/**
 * Session payloads for players (public) and hosts.
 * Correct answers and live scores only ever reach the host; players see
 * their own question, and their results once the game is over.
 */
class SessionPresenter
{
    /** A player with no request for this long counts as offline on the host screen. */
    private const OFFLINE_AFTER_SECONDS = 60;

    public function __construct(
        private readonly TimerService $timer,
        private readonly ScoringService $scoring,
    ) {}

    public function state(FunGameSession $session, ?FunGameParticipant $participant = null): array
    {
        $game = $session->game;
        $questionIds = $session->questionIds();
        $counts = $session->participants()
            ->selectRaw('count(*) as total, count(finished_at) as finished')
            ->first();

        $state = [
            'id' => (string) $session->id,
            'status' => $session->status,
            'joinCode' => $session->join_code,
            'quiz' => [
                'id' => (string) $game->id,
                'title' => $game->title,
                'description' => $game->description ?? '',
                'instructions' => $game->instructions ?? '',
                // Questions each player answers; the pool can be larger.
                'questionCount' => $session->questionsPerPlayer(),
                'poolSize' => count($questionIds),
                'totalMarks' => round((float) FunGameQuestion::withTrashed()->whereIn('id', $session->sharedQuestionIds() ?? $questionIds)->sum('marks'), 2),
                'timer' => $this->timer->config($game, $session->timer_snapshot),
                'scoringMode' => $session->scoringMode(),
            ],
            'startsAt' => TimerService::iso($session->starts_at),
            'startedAt' => TimerService::iso($session->started_at),
            'joinClosesAt' => TimerService::iso($session->join_closes_at),
            'endsAt' => TimerService::iso($session->ends_at),
            'finishedAt' => TimerService::iso($session->finished_at),
            'serverTime' => TimerService::iso(now()),
            'participantCount' => (int) ($counts->total ?? 0),
            'finishedCount' => (int) ($counts->finished ?? 0),
        ];

        if ($participant) {
            $state['participantId'] = (string) $participant->id;
            $state['participantName'] = $participant->name;
            $state['participation'] = $participant->finished_at || $session->status === FunGameSession::STATUS_FINISHED
                ? 'submitted'
                : 'joined';
        }

        return $state;
    }

    /** Player view of a question: never includes the correct option. */
    public function question(FunGameQuestion $question): array
    {
        return [
            'id' => (string) $question->id,
            'type' => $question->type,
            'text' => $question->text,
            'imageUrl' => $question->image_url,
            'options' => array_values(array_map(
                fn (array $option) => ['id' => $option['id'], 'text' => $option['text']],
                $question->options,
            )),
            'marks' => $question->marks,
            'negativeMarks' => $question->negative_marks,
        ];
    }

    /**
     * Where a player is: the question on their screen (only that one) and its
     * deadline (per-question) or their personal deadline (total timer).
     */
    public function progress(FunGameSession $session, FunGameParticipant $p): array
    {
        $order = $p->question_order ?? [];
        $total = count($order) ?: $session->questionsPerPlayer();
        $open = ! $p->finished_at && $p->current_opened_at !== null && isset($order[$p->current_index]);
        $question = $open ? FunGameQuestion::withTrashed()->find($order[$p->current_index]) : null;

        return [
            'status' => $session->status,
            'finished' => (bool) $p->finished_at,
            'finishedAt' => TimerService::iso($p->finished_at),
            'index' => $p->current_index,
            'total' => $total,
            'question' => $question ? $this->question($question) : null,
            'openedAt' => TimerService::iso($open ? $p->current_opened_at : null),
            'deadline' => TimerService::iso($session->isPerQuestion() ? $p->current_deadline : $p->personal_deadline),
            /** Per-question: this question's time; total: the whole quiz's time (for the warning threshold). */
            'windowSeconds' => $question && $session->isPerQuestion()
                ? $this->timer->secondsForQuestion($session, $question->id)
                : $this->timer->totalSeconds($session),
            'startedAt' => TimerService::iso($p->first_opened_at),
            'serverTime' => TimerService::iso(now()),
        ];
    }

    public function stats(FunGameSession $session): array
    {
        $participants = $session->participants()->get(['id', 'last_seen_at', 'finished_at']);

        return [
            'participantCount' => $participants->count(),
            'finishedCount' => $participants->whereNotNull('finished_at')->count(),
            'offlineCount' => $participants->filter(fn ($p) => ! $p->finished_at && ! $this->online($p))->count(),
            'answeredCount' => FunGameAnswer::query()->whereIn('fun_game_participant_id', $participants->pluck('id'))->count(),
            'distribution' => [],
        ];
    }

    public function hostDetail(FunGameSession $session): array
    {
        return $this->state($session) + [
            'quizId' => (string) $session->fun_game_id,
            'publicChannelKey' => $session->public_channel_key,
            'joinUrl' => frontend_url('/attempt/fun-games/' . $session->join_code),
            'endedByHost' => $session->ended_by_host,
            'stats' => $this->stats($session),
            'finalisation' => $this->finalisation($session),
        ];
    }

    public function finalisation(FunGameSession $session): array
    {
        $steps = [
            ['key' => 'lockAnswers', 'label' => 'Lock answers'],
            ['key' => 'score', 'label' => 'Score answers'],
            ['key' => 'rank', 'label' => 'Rank players'],
            ['key' => 'publish', 'label' => 'Publish leaderboard'],
        ];
        $statuses = match ($session->status) {
            FunGameSession::STATUS_FINISHING => ['done', 'running', 'pending', 'pending'],
            FunGameSession::STATUS_FINISHED => ['done', 'done', 'done', 'done'],
            default => ['pending', 'pending', 'pending', 'pending'],
        };

        return array_map(
            fn ($step, $status) => $step + ['status' => $status, 'note' => null],
            $steps,
            $statuses,
        );
    }

    /**
     * Players: empty and "pending" until the session is finished.
     * Host: live standings with each player's progress while it runs.
     */
    public function leaderboard(FunGameSession $session, bool $forHost, ?FunGameParticipant $me = null): array
    {
        $base = [
            'scoringMode' => $session->scoringMode(),
            'totalParticipants' => $session->participants()->count(),
            'updatedAt' => TimerService::iso(now()),
            'scoredThroughIndex' => null,
        ];

        if ($session->status === FunGameSession::STATUS_FINISHED) {
            $entries = $session->participants()->orderBy('rank')->orderBy('id')->get()->map(
                fn (FunGameParticipant $p) => $this->entry($p, [
                    'score' => (float) $p->score,
                    'correct' => (int) $p->correct_count,
                    'incorrect' => (int) $p->incorrect_count,
                    'rank' => (int) $p->rank,
                    'time_ms' => $p->elapsed_ms,
                ], $forHost, $me),
            );

            return $base + ['status' => 'published', 'entries' => $entries->values()->all()];
        }

        if (! $forHost) {
            return $base + ['status' => 'pending', 'entries' => []];
        }

        $perPlayer = $session->questionsPerPlayer();
        $entries = $this->scoring->standings($session)->map(function (array $row) use ($me, $perPlayer) {
            $p = $row['participant'];
            $total = count($p->question_order ?? []) ?: $perPlayer;
            $entry = $this->entry($p, $row, true, $me);
            $entry['progress'] = [
                'done' => $p->finished_at ? $total : (int) ($p->current_index ?? 0),
                'total' => $total,
                'finished' => (bool) $p->finished_at,
            ];
            $entry['currentQuestionStatus'] = $p->finished_at
                ? 'finished'
                : ($p->current_opened_at === null ? 'waiting' : ($this->online($p) ? 'answering' : 'offline'));

            return $entry;
        });

        return $base + ['status' => 'live', 'entries' => $entries->values()->all()];
    }

    public function personalResult(FunGameSession $session, FunGameParticipant $participant): array
    {
        // This player's own questions (a draw from the pool, or all of them).
        $ids = $participant->question_order ?: ($session->sharedQuestionIds() ?? array_slice($session->questionIds(), 0, $session->questionsPerPlayer()));
        $answers = FunGameAnswer::query()
            ->where('fun_game_participant_id', $participant->id)
            ->whereIn('fun_game_question_id', $ids)
            ->get()
            ->keyBy('fun_game_question_id');
        $answered = $answers->count();
        $questions = FunGameQuestion::withTrashed()->whereIn('id', $ids)->get(['id', 'marks']);
        $speed = $session->scoringMode() === FunGame::SCORING_SPEED;
        $maxMarks = round((float) $questions->sum('marks'), 2);
        $common = [
            'scoringMode' => $session->scoringMode(),
            'answered' => $answered,
            'maxMarks' => $speed ? round($maxMarks * ScoringService::SPEED_POINTS_PER_MARK) : $maxMarks,
        ];

        if ($session->status !== FunGameSession::STATUS_FINISHED) {
            return $common + [
                'status' => 'pending',
                'marks' => 0,
                'correct' => 0,
                'incorrect' => 0,
                'unanswered' => count($ids) - $answered,
                'accuracy' => 0,
                'rank' => null,
                'totalParticipants' => null,
                'timeMs' => null,
                'averageAnswerMs' => null,
            ];
        }

        $correct = (int) $participant->correct_count;
        $responses = $answers->pluck('response_ms')->filter(fn ($v) => $v !== null);
        // The sheet follows the order this player saw the questions in.
        $order = $participant->question_order ?: $ids;

        return $common + [
            'status' => 'final',
            'marks' => (float) $participant->score,
            'correct' => $correct,
            'incorrect' => (int) $participant->incorrect_count,
            'unanswered' => (int) $participant->unanswered_count,
            'accuracy' => $answered ? round($correct / $answered, 4) : 0,
            'rank' => $participant->rank,
            'totalParticipants' => $session->participants()->count(),
            'timeMs' => $participant->elapsed_ms,
            'averageAnswerMs' => $responses->isEmpty() ? null : (int) round($responses->avg()),
            'answerSheet' => collect($order)->values()->map(function (int $id, int $index) use ($answers) {
                $answer = $answers->get($id);

                return [
                    'questionId' => (string) $id,
                    'index' => $index,
                    'outcome' => ! $answer ? 'unanswered' : ($answer->is_correct ? 'correct' : 'incorrect'),
                    'points' => $answer?->points,
                    'responseMs' => $answer?->response_ms,
                ];
            })->all(),
        ];
    }

    public function participantSummary(FunGameParticipant $p): array
    {
        return [
            'id' => (string) $p->id,
            'name' => $p->name,
            'email' => $p->email,
            'joinedAt' => TimerService::iso($p->joined_at),
            'lastSeenAt' => TimerService::iso($p->last_seen_at),
            'finishedAt' => TimerService::iso($p->finished_at),
            'online' => $this->online($p),
        ];
    }

    private function online(FunGameParticipant $p): bool
    {
        return (bool) ($p->last_seen_at && $p->last_seen_at->gte(now()->subSeconds(self::OFFLINE_AFTER_SECONDS)));
    }

    /** @param array{score: float, correct: int, incorrect: int, rank: int, time_ms: ?int} $row */
    private function entry(FunGameParticipant $p, array $row, bool $forHost, ?FunGameParticipant $me): array
    {
        $answered = $row['correct'] + $row['incorrect'];
        $entry = [
            'rank' => $row['rank'],
            'participantId' => (string) $p->id,
            'name' => $p->name,
            'score' => round($row['score'], 2),
            'correct' => $row['correct'],
            'accuracy' => $answered ? round($row['correct'] / $answered, 4) : 0,
            'timeMs' => $row['time_ms'],
            'isMe' => $me !== null && $me->id === $p->id,
        ];
        if ($forHost) {
            $entry['email'] = $p->email;
        }

        return $entry;
    }
}
