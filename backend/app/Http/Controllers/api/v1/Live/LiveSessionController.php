<?php

namespace App\Http\Controllers\api\v1\Live;

use App\Http\Controllers\api\v1\ApiBaseController;
use App\Models\Quest\Quest;
use App\Models\Quest\QuestSession;
use App\Models\Quest\QuestTaskCompletion;
use App\Models\Quest\QuestTask;
use App\Models\Quiz\Question;
use App\Models\Quiz\Quiz;
use App\Models\Quiz\QuizSession;
use App\Services\Live\LiveAggregateService;
use App\Services\Live\LiveSessionService;
use App\Services\Live\ParticipantTokenService;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\PersonalAccessToken;

class LiveSessionController extends ApiBaseController
{
    public function __construct(
        private readonly LiveSessionService $liveSessions,
        private readonly ParticipantTokenService $participantTokens,
        private readonly LiveAggregateService $aggregates,
    ) {}

    /**
     * The host's view of a quick form's submissions in a session. They hold personal details, so
     * they are never part of the public aggregate broadcast; only the quest owner can read them.
     */
    public function questFormResponses(Request $request, int $id, int $sessionId, int $taskId): JsonResponse
    {
        $quest = Quest::find($id);

        if (! $quest) {
            return $this->notFoundResponse([], __('Quest not found.'));
        }

        if ((int) $quest->creator_id !== (int) auth()->id()) {
            return $this->forbiddenResponse([], __('You are not allowed to access this quest.'));
        }

        $sessionBelongs = QuestSession::whereKey($sessionId)->where('quest_id', $quest->id)->exists();
        $taskBelongs = QuestTask::whereKey($taskId)->where('quest_id', $quest->id)->exists();

        if (! $sessionBelongs || ! $taskBelongs) {
            return $this->notFoundResponse([], __('Quest session or task not found.'));
        }

        $responses = QuestTaskCompletion::with('participant:id,anonymous_details,user_id')
            ->where('task_id', $taskId)
            ->whereHas('participant', fn ($query) => $query->where('quest_session_id', $sessionId))
            ->latest('id')
            ->limit(200)
            ->get()
            ->map(fn (QuestTaskCompletion $completion) => [
                'id' => $completion->id,
                'participant' => $completion->participant?->anonymous_details['name'] ?? null,
                // Stored as {"0": field, "1": field, ...}; the view lists the fields.
                'answer_data' => array_values(array_filter(
                    (array) $completion->completion_data,
                    fn ($field) => is_array($field) && isset($field['type']),
                )),
            ])
            ->values();

        return $this->okResponse(['responses' => $responses], __('Form responses retrieved successfully.'));
    }

    public function questHostSession(Request $request, int $id): JsonResponse
    {
        $quest = Quest::find($id);

        if (! $quest) {
            return $this->notFoundResponse([], __('Quest not found.'));
        }

        if ((int) $quest->creator_id !== (int) auth()->id()) {
            return $this->forbiddenResponse([], __('You are not allowed to access this quest.'));
        }

        $session = QuestSession::with('quest')
            ->where('quest_id', $quest->id)
            ->where('running_status', true)
            ->latest()
            ->first();

        if (! $session) {
            return $this->notFoundResponse([], __('No active quest session found.'));
        }

        // A running session must be joinable (sessions started before hosting published the quest).
        if (! $quest->is_published) {
            $quest->update(['is_published' => true]);
        }

        $payload = array_merge(
            $this->liveSessions->state(LiveSessionService::MODULE_QUEST, $session),
            [
                'id' => $session->id,
                'session_id' => (string) $session->session_id,
                'title' => $session->title,
                'quest_id' => $session->quest_id,
                'timezone' => $session->timezone,
                'created_at' => optional($session->created_at)->toISOString(),
                'active_participants' => $this->liveSessions->activeParticipantsPayload($session),
                'join_link' => $quest->join_link,
                'join_code' => $quest->join_code,
            ],
        );

        return $this->okResponse([
            'session' => $payload,
        ], __('Active quest host session retrieved successfully.'));
    }

    public function quizHostSession(Request $request, int $id): JsonResponse
    {
        $quiz = Quiz::find($id);

        if (! $quiz) {
            return $this->notFoundResponse([], __('Quiz not found.'));
        }

        if ((int) $quiz->user_id !== (int) auth()->id()) {
            return $this->forbiddenResponse([], __('You are not allowed to access this quiz.'));
        }

        $session = QuizSession::with('quiz')
            ->where('quiz_id', $quiz->id)
            ->where('is_host_live', true)
            ->where('running_status', true)
            ->latest()
            ->first();

        if (! $session) {
            return $this->notFoundResponse([], __('No active quiz session found.'));
        }

        $payload = array_merge(
            $this->liveSessions->state(LiveSessionService::MODULE_QUIZ, $session),
            [
                'id' => $session->id,
                'session_id' => (string) $session->getRawOriginal('session_id'),
                'title' => $session->title,
                'quiz_id' => $session->quiz_id,
                'timezone' => $session->timezone,
                'created_at' => optional($session->created_at)->toISOString(),
                'active_participants' => $this->liveSessions->activeParticipantsPayload($session),
                'join_link' => $session->join_link,
                'join_code' => $session->join_code,
            ],
        );

        return $this->okResponse([
            'session' => $payload,
        ], __('Active quiz host session retrieved successfully.'));
    }

    public function questState(Request $request, int $sessionId): JsonResponse
    {
        $session = QuestSession::with('quest')->find($sessionId);

        if (! $session) {
            return $this->notFoundResponse([], __('Quest session not found.'));
        }

        $isHost = $this->isQuestHost($request, $session);

        if ($response = $this->ensureQuestStateAccess($request, $session)) {
            return $response;
        }

        $state = $this->stateWithAggregate(LiveSessionService::MODULE_QUEST, $session);
        if ($isHost) {
            $state['active_participants'] = $this->liveSessions->activeParticipantsPayload($session);
        }

        return $this->okResponse([
            'state' => $state,
        ], __('Quest session state retrieved successfully.'));
    }

    public function changeQuestTask(Request $request, int $sessionId): JsonResponse
    {
        $validated = $request->validate([
            'task_id' => ['required', 'integer', 'exists:quest_tasks,id'],
            'timer_state' => ['nullable', 'array'],
        ]);

        $session = QuestSession::with('quest')->find($sessionId);

        if (! $session) {
            return $this->notFoundResponse([], __('Quest session not found.'));
        }

        if ($response = $this->ensureQuestOwner($session)) {
            return $response;
        }

        $task = QuestTask::where('quest_id', $session->quest_id)->find($validated['task_id']);

        if (! $task) {
            return $this->badRequestResponse([], __('The selected task does not belong to this quest session.'));
        }

        DB::transaction(function () use ($session, $task, $validated) {
            $session->update([
                'current_task_id' => $task->id,
                'timer_state' => $this->liveSessions->stampTimer($validated['timer_state'] ?? null),
            ]);

            $session->refresh();

            $payload = array_merge(
                $this->liveSessions->state(LiveSessionService::MODULE_QUEST, $session),
                [
                    'task_id' => $task->id,
                ],
            );

            $this->liveSessions->broadcastPublic(
                LiveSessionService::MODULE_QUEST,
                $session,
                'task.changed',
                $payload,
            );
        });

        return $this->okResponse([
            'state' => $this->liveSessions->state(LiveSessionService::MODULE_QUEST, $session->refresh()),
        ], __('Quest task changed successfully.'));
    }

    public function quizState(Request $request, int $sessionId): JsonResponse
    {
        $session = QuizSession::with('quiz')->find($sessionId);

        if (! $session) {
            return $this->notFoundResponse([], __('Quiz session not found.'));
        }

        $isHost = $this->isQuizHost($request, $session);

        if ($response = $this->ensureQuizStateAccess($request, $session)) {
            return $response;
        }

        $state = $this->stateWithAggregate(LiveSessionService::MODULE_QUIZ, $session);
        if ($isHost) {
            $state['active_participants'] = $this->liveSessions->activeParticipantsPayload($session);
        }

        return $this->okResponse([
            'state' => $state,
        ], __('Quiz session state retrieved successfully.'));
    }

    public function changeQuizQuestion(Request $request, int $sessionId): JsonResponse
    {
        $validated = $request->validate([
            'question_id' => ['required', 'integer', 'exists:questions,id'],
            'timer_state' => ['nullable', 'array'],
        ]);

        $session = QuizSession::with('quiz')->find($sessionId);

        if (! $session) {
            return $this->notFoundResponse([], __('Quiz session not found.'));
        }

        if ($response = $this->ensureQuizOwner($session)) {
            return $response;
        }

        $question = Question::where('quiz_id', $session->quiz_id)->find($validated['question_id']);

        if (! $question) {
            return $this->badRequestResponse([], __('The selected question does not belong to this quiz session.'));
        }

        DB::transaction(function () use ($session, $question, $validated) {
            $session->update([
                'current_question_id' => $question->id,
                'timer_state' => $this->liveSessions->stampTimer($validated['timer_state'] ?? null),
            ]);

            $session->refresh();

            $payload = array_merge(
                $this->liveSessions->state(LiveSessionService::MODULE_QUIZ, $session),
                [
                    'question_id' => $question->id,
                ],
            );

            $this->liveSessions->broadcastPublic(
                LiveSessionService::MODULE_QUIZ,
                $session,
                'question.changed',
                $payload,
            );
        });

        return $this->okResponse([
            'state' => $this->liveSessions->state(LiveSessionService::MODULE_QUIZ, $session->refresh()),
        ], __('Quiz question changed successfully.'));
    }

    private function ensureQuestOwner(QuestSession $session): ?JsonResponse
    {
        if (! $session->quest || $session->quest->creator_id !== auth()->id()) {
            return $this->forbiddenResponse([], __('You are not allowed to access this quest session.'));
        }

        return null;
    }

    private function stateWithAggregate(string $module, QuestSession|QuizSession $session): array
    {
        $state = $this->liveSessions->state($module, $session);
        $state['current_aggregate'] = $this->aggregates->currentSnapshot($module, $session);

        return $state;
    }

    private function ensureQuestStateAccess(Request $request, QuestSession $session): ?JsonResponse
    {
        if ($this->isQuestHost($request, $session)) {
            return null;
        }

        if ($this->participantTokens->participantForSession($request, LiveSessionService::MODULE_QUEST, (int) $session->id)) {
            return null;
        }

        $user = $this->resolveLiveUser($request);

        return $user
            ? $this->forbiddenResponse([], __('You are not allowed to access this quest session.'))
            : $this->unauthorizedResponse([], __('A valid host session or participant token is required.'));
    }

    private function ensureQuizStateAccess(Request $request, QuizSession $session): ?JsonResponse
    {
        if ($this->isQuizHost($request, $session)) {
            return null;
        }

        if ($this->participantTokens->participantForSession($request, LiveSessionService::MODULE_QUIZ, (int) $session->id)) {
            return null;
        }

        $user = $this->resolveLiveUser($request);

        return $user
            ? $this->forbiddenResponse([], __('You are not allowed to access this quiz session.'))
            : $this->unauthorizedResponse([], __('A valid host session or participant token is required.'));
    }

    private function ensureQuizOwner(QuizSession $session): ?JsonResponse
    {
        if (! $session->quiz || $session->quiz->user_id !== auth()->id()) {
            return $this->forbiddenResponse([], __('You are not allowed to access this quiz session.'));
        }

        return null;
    }

    private function isQuestHost(Request $request, QuestSession $session): bool
    {
        $user = $this->resolveLiveUser($request);

        return (bool) $user
            && (bool) $session->quest
            && (int) $session->quest->creator_id === (int) $user->id;
    }

    private function isQuizHost(Request $request, QuizSession $session): bool
    {
        $user = $this->resolveLiveUser($request);

        return (bool) $user
            && (bool) $session->quiz
            && (int) $session->quiz->user_id === (int) $user->id;
    }

    private function resolveLiveUser(Request $request): ?Authenticatable
    {
        $user = $request->user('api')
            ?? $request->user('sanctum')
            ?? $request->user()
            ?? auth('api')->user();

        if ($user) {
            return $user;
        }

        $token = $request->bearerToken();
        if (! is_string($token) || $token === '') {
            return null;
        }

        $accessToken = PersonalAccessToken::findToken($token);
        $tokenable = $accessToken?->tokenable;

        return $tokenable instanceof Authenticatable ? $tokenable : null;
    }
}
