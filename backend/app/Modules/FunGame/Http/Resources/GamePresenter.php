<?php

namespace App\Modules\FunGame\Http\Resources;

use App\Modules\FunGame\Models\FunGame;
use App\Modules\FunGame\Models\FunGameQuestion;
use App\Modules\FunGame\Models\FunGameSession;
use App\Modules\FunGame\Services\TimerService;

/** Host-facing game payloads (camelCase, ids as strings). */
class GamePresenter
{
    public function __construct(private readonly TimerService $timer) {}

    /** draft | upcoming | lobby | live | completed — derived from the latest session. */
    public function status(FunGame $game, ?FunGameSession $latest): string
    {
        if ($game->status === FunGame::STATUS_DRAFT) {
            return 'draft';
        }

        return match ($latest?->status) {
            FunGameSession::STATUS_LIVE, FunGameSession::STATUS_FINISHING => 'live',
            FunGameSession::STATUS_FINISHED => 'completed',
            FunGameSession::STATUS_WAITING => $latest->starts_at && $latest->starts_at->isFuture() ? 'upcoming' : 'lobby',
            default => 'upcoming',
        };
    }

    /** Expects `questions_count`, `questions_sum_marks`, `sessions_count` and `latestSession` loaded. */
    public function summary(FunGame $game): array
    {
        $latest = $game->latestSession;

        return [
            'id' => (string) $game->id,
            'title' => $game->title,
            'description' => $game->description ?? '',
            'instructions' => $game->instructions ?? '',
            'status' => $this->status($game, $latest),
            'published' => $game->status === FunGame::STATUS_PUBLISHED,
            'questionCount' => (int) ($game->questions_count ?? $game->questions()->count()),
            'totalMarks' => round((float) ($game->questions_sum_marks ?? $game->questions()->sum('marks')), 2),
            'timer' => $this->timer->config($game),
            'scoringMode' => $game->scoring_mode ?: FunGame::SCORING_MARKS,
            'shuffleQuestions' => (bool) $game->shuffle_questions,
            'questionsPerPlayer' => $game->questions_per_player,
            'questionSelection' => $game->question_selection ?: FunGame::SELECTION_SAME,
            'startsAt' => TimerService::iso($latest?->starts_at),
            'latestSessionId' => $latest ? (string) $latest->id : null,
            'latestSessionStatus' => $latest?->status,
            'sourceQuizId' => $game->source_quiz_id ? (string) $game->source_quiz_id : null,
            'updatedAt' => TimerService::iso($game->updated_at),
            'sessionCount' => (int) ($game->sessions_count ?? $game->sessions()->count()),
        ];
    }

    public function detail(FunGame $game): array
    {
        $game->loadMissing(['questions', 'latestSession'])->loadCount(['questions', 'sessions'])->loadSum('questions', 'marks');

        return $this->summary($game) + [
            'defaultMarks' => $game->default_marks,
            'defaultNegativeMarks' => $game->default_negative_marks,
            // Both modes' settings, so switching modes in the editor never loses a value.
            'timerSettings' => [
                'mode' => $game->isPerQuestion() ? 'perQuestion' : 'total',
                'totalSeconds' => $game->total_seconds,
                'secondsPerQuestion' => $game->seconds_per_question,
            ],
            'locked' => $game->hasRunningSession(),
            'questions' => $game->questions->map(fn (FunGameQuestion $q) => $this->question($q))->values()->all(),
        ];
    }

    /** Admin view of a question: includes the correct option. */
    public function question(FunGameQuestion $question): array
    {
        return [
            'id' => (string) $question->id,
            'type' => $question->type,
            'text' => $question->text,
            'imageUrl' => $question->image_url,
            'options' => array_values($question->options),
            'correctOptionId' => $question->correct_option_id,
            'marks' => $question->marks,
            'negativeMarks' => $question->negative_marks,
            'secondsOverride' => $question->seconds_override,
        ];
    }
}
