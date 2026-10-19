<?php

namespace App\Http\Controllers\api\v1\Quest;

use App\Exports\Quests\QuestSessionAttemptExportGrouped;
use App\Exports\Quests\QuestSessionAttemptExportVertical;
use App\Exports\Quests\QuestSessionAttemptsExport;
use App\Exports\Quests\QuestSessionsExport;
use App\Http\Controllers\api\v1\ApiBaseController;
use App\Http\Requests\Quest\QuestAttempt\JoinByCodeRequest;
use App\Http\Requests\Quest\QuestAttempt\JoinByLinkRequest;
use App\Http\Requests\Quest\QuestAttempt\StartAttemptRequest;
use App\Http\Requests\Quest\QuestAttempt\RecordTaskCompletionRequest;
use App\Http\Requests\Quest\QuestAttempt\UpdateStatusRequest;
use App\Models\Quest\Quest;
use App\Models\Quest\QuestParticipant;
use App\Models\Quest\QuestSession;
use App\Models\Quest\QuestTask;
use App\Models\Quest\QuestTaskCompletion;
use App\Services\Live\LiveAggregateService;
use App\Services\Live\LiveSessionService;
use App\Services\Live\ParticipantTokenService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Maatwebsite\Excel\Facades\Excel;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class QuestAttemptController extends ApiBaseController
{
    /**
     * Start a new quest attempt.
     */
    public function startAttempt(StartAttemptRequest $request, int $questId): JsonResponse
    {
        DB::beginTransaction();

        try {
            $validated = $request->validated();
            $quest = Quest::find($questId);

            if (! $quest) {
                return $this->notFoundResponse([], __('Quest not found'));
            }

            $userId = $validated['user_id'];

            // Check for latest Quest Session
            $existingSession = QuestSession::where('quest_id', $quest->id)
                ->latest()
                ->first();

            if (! $existingSession) {
                return $this->notFoundResponse([], __('No active session found for this quest.'));
            }

            $existingAttempt = $this->checkExistingAttempt($quest, $existingSession, $userId, $request);

            if ($existingAttempt) {
                return $this->badRequestResponse([], __('You already have an active attempt for this quest session.'));
            }

            $attempt = QuestParticipant::create([
                'quest_id' => $questId,
                'user_id' => $userId,
                'quest_session_id' => $existingSession->id,
                'is_anonymous' => $validated['is_anonymous'],
                'anonymous_details' => $validated['anonymous_details'] ?? null,
                'start_time' => now(),
                'end_time' => null,
                'status' => 'In Progress',
            ]);

            $participantToken = app(ParticipantTokenService::class)->issue($attempt, $existingSession);
            $liveSessions = app(LiveSessionService::class);
            $liveSessions->ensurePublicChannelKey($existingSession);
            $liveSessions->broadcastParticipantJoined(LiveSessionService::MODULE_QUEST, $existingSession, (int) $attempt->id);

            DB::commit();

            return $this->okResponse(
                [
                    'attempt' => app(ParticipantTokenService::class)->sanitizeParticipant($attempt),
                    'participant_token' => $participantToken,
                    'public_channel_key' => $existingSession->public_channel_key,
                    'public_channel' => $liveSessions->publicChannel(LiveSessionService::MODULE_QUEST, $existingSession->public_channel_key),
                ],
                __('Quest attempt started successfully')
            );
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error starting quest attempt: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while starting the quest attempt')
            );
        }
    }

    public function recordAnswer(RecordTaskCompletionRequest $request, int $attemptId): JsonResponse
    {
        DB::beginTransaction();

        try {
            $validated = $request->validated();
            $attempt = QuestParticipant::find($attemptId);

            if (! $attempt) {
                return $this->notFoundResponse([], __('Quest attempt not found'));
            }

            if ($attempt->status !== 'In Progress') {
                return $this->badRequestResponse([], __('This quest attempt is no longer active'));
            }

            if (! app(ParticipantTokenService::class)->validateRequest($request, $attempt)) {
                DB::rollBack();

                return $this->unauthorizedResponse([], __('Invalid or expired participant token.'));
            }

            // Check prerequisites
            if (! $this->checkPrerequisites($attemptId, $validated['task_id'])) {
                return $this->badRequestResponse(
                    [],
                    __('You must complete all prerequisite tasks before completing this task')
                );
            }

            $completionData = $validated['completion_data'];

            $completion = QuestTaskCompletion::updateOrCreate(
                [
                    'participant_id' => $attemptId,
                    'task_id' => $validated['task_id'],
                ],
                [
                    'completion_data' => $completionData,
                    'status' => 'Completed', // Assuming completion means the task is done
                    'completed_at' => now(),
                ]
            );

            if ($attempt->quest_session_id) {
                $session = $attempt->questSession;

                if ($session) {
                    app(LiveSessionService::class)->broadcastHost(LiveSessionService::MODULE_QUEST, $session, 'answer.submitted', [
                        'session_id' => $attempt->quest_session_id,
                        'participant_id' => $attempt->id,
                        'task_id' => (int) $validated['task_id'],
                    ]);
                    app(LiveAggregateService::class)->recordAnswer(
                        LiveSessionService::MODULE_QUEST,
                        (int) $attempt->quest_session_id,
                        (int) $validated['task_id'],
                    );
                }
            }

            DB::commit();

            return $this->okResponse(
                ['completion' => $completion],
                __('Completion recorded successfully')
            );
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error recording completion: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while recording the completion')
            );
        }
    }

    /**
     * Update the status of a quest attempt.
     */
    public function updateStatus(UpdateStatusRequest $request, int $attemptId): JsonResponse
    {
        DB::beginTransaction();

        try {
            $validated = $request->validated();
            $attempt = QuestParticipant::with(['quest', 'user', 'taskCompletions.task'])
                ->find($attemptId);

            if (! $attempt) {
                return $this->notFoundResponse([], __('Quest attempt not found'));
            }

            if ($attempt->status !== 'In Progress') {
                return $this->badRequestResponse(
                    [],
                    __('Cannot update status of a completed or abandoned attempt')
                );
            }

            if (! app(ParticipantTokenService::class)->validateRequest($request, $attempt)) {
                DB::rollBack();

                return $this->unauthorizedResponse([], __('Invalid or expired participant token.'));
            }

            if (strtolower($validated['status']) === 'completed') {
                $attempt->end_time = $validated['end_time'] ?? now();
            }

            $attempt->status = $validated['status'];
            $attempt->save();

            $this->broadcastAttemptStatus($attempt, $validated['status']);

            DB::commit();

            return $this->okResponse(
                ['attempt' => $attempt],
                __('Quest attempt status updated successfully')
            );
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error updating quest status: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while updating the quest status')
            );
        }
    }

    public function getAttemptDetails($attemptId)
    {
        try {
            $attempt = QuestParticipant::with(['quest', 'user', 'taskCompletions.task'])
                ->find($attemptId);

            if (! $attempt) {
                return $this->notFoundResponse([], __('Quest attempt not found'));
            }

            return $this->okResponse(
                ['attempt' => $attempt],
                __('Quest attempt details retrieved successfully')
            );
        } catch (\Exception $e) {
            Log::error('Error getting attempt details: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quest attempt details')
            );
        }
    }

    public function getUserCurrentAttempts(): JsonResponse
    {
        try {
            $userId = auth()->id();
            $attempts = QuestParticipant::with(['quest', 'user', 'taskCompletions.task'])
                ->respondentId($userId)
                ->Status('In Progress')
                ->get();

            if ($attempts->isEmpty()) {
                return $this->notFoundResponse([], __('No current quest attempts found'));
            }

            return $this->okResponse(
                ['attempts' => $attempts],
                __('Current quest attempts retrieved successfully')
            );
        } catch (\Exception $e) {
            Log::error('Error getting user attempts: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving your quest attempts')
            );
        }
    }

    public function getUserAttemptHistory(Request $request): JsonResponse
    {
        try {
            $userId = auth()->id();
            $attempts = QuestParticipant::respondentId($userId)
                ->questIdNotNull();

            $attempts = $attempts->orderByColumn(
                $request->input('order_by', 'created_at'),
                $request->input('order_direction', 'desc')
            );

            // You might want to add pagination here
            $attempts = $attempts->paginate($request->input('per_page', 10));

            return $this->okResponse(
                ['attempts' => $attempts],
                __('Quest attempt history retrieved successfully')
            );
        } catch (\Exception $e) {
            Log::error('Error getting user attempt history: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving your quest attempt history')
            );
        }
    }

    /**
     * Get quest details by join link.
     */
    public function getQuestDetailsByJoinLink(string $joinLink): JsonResponse
    {
        try {
            $quest = Quest::with(['tasks'])
                ->where('join_link', $joinLink)
                ->where('is_published', true)
                ->whereNull('deleted_at')
                ->first();

            if (! $quest) {
                return $this->notFoundResponse([], __('Quest not found or not available.'));
            }

            $questSession = QuestSession::where('quest_id', $quest->id)
                ->where('running_status', true)
                ->latest()
                ->first();

            if (! $questSession) {
                return $this->badRequestResponse([], __('Quest live session has ended.'));
            }

            $liveSessions = app(LiveSessionService::class);
            $liveSessions->ensurePublicChannelKey($questSession);

            return $this->okResponse(
                [
                    'quest' => $quest,
                    'questSession' => $questSession,
                    'public_channel_key' => $questSession->public_channel_key,
                    'public_channel' => $liveSessions->publicChannel(LiveSessionService::MODULE_QUEST, $questSession->public_channel_key),
                ],
                __('Quest details retrieved successfully.')
            );
        } catch (\Exception $e) {
            Log::error('Error retrieving quest details: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('Failed to retrieve quest details. Please try again.')
            );
        }
    }

    /**
     * Join a quest using the join link.
     */
    public function joinByLink(JoinByLinkRequest $request, string $joinLink): JsonResponse
    {
        DB::beginTransaction();

        try {
            $quest = $this->getActiveQuestByJoinLink($joinLink);

            if (! $quest) {
                return $this->notFoundResponse([], __('Quest not found.'));
            }

            // $validationResponse = $this->validateQuestAvailability($quest);

            // if ($validationResponse) {
            //     return $validationResponse;
            // }

            $userId = auth()->id();

            if ($quest->logged_in_users_only && ! $userId) {
                return $this->unauthorizedResponse(
                    [],
                    __('You need to be logged in to join this quest.')
                );
            }

            // Check for latest Quest Session
            $existingSession = QuestSession::where('quest_id', $quest->id)
                ->where('running_status', true)
                ->latest()
                ->first();

            if (! $existingSession) {
                return $this->badRequestResponse([], __('Quest has been end.'));
            }

            $existingAttempt = $this->checkExistingAttempt($quest, $existingSession, $userId, $request);

            if ($existingAttempt) {
                return $existingAttempt;
            }

            $anonymousName = $request->input('anonymous_name');

            if (! $userId && ! $anonymousName) {
                return $this->badRequestResponse(
                    [],
                    __('Anonymous name is required for anonymous users.')
                );
            }

            if (! $userId) {
                $anonymousName = $this->generateUniqueAnonymousName($quest, $anonymousName);
            }

            $attempt = $this->createNewAttempt($quest, $existingSession, $userId, $request);
            $participantToken = app(ParticipantTokenService::class)->issue($attempt, $existingSession);
            $liveSessions = app(LiveSessionService::class);
            $liveSessions->ensurePublicChannelKey($existingSession);
            $liveSessions->broadcastParticipantJoined(LiveSessionService::MODULE_QUEST, $existingSession, (int) $attempt->id);

            DB::commit();

            return $this->createdResponse(
                [
                    'quest' => $quest,
                    'attempt' => app(ParticipantTokenService::class)->sanitizeParticipant($attempt),
                    'participant_token' => $participantToken,
                    'public_channel_key' => $existingSession->public_channel_key,
                    'public_channel' => $liveSessions->publicChannel(LiveSessionService::MODULE_QUEST, $existingSession->public_channel_key),
                ],
                __('Quest attempt started successfully.')
            );
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Quest join and attempt failed: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('Failed to join quest. Please try again.')
            );
        }
    }

    /**
     * Find a live quest by the code on the host's screen ("T915122"; the letter, case, spaces and
     * dashes are optional). The join page sent the digits only and this matched the whole code, so
     * every code was "not found"; it also took the latest session even after it had ended.
     */
    public function joinByCode(JoinByCodeRequest $request): JsonResponse
    {
        try {
            $code = strtoupper(preg_replace('/[\s-]+/', '', (string) $request->join_code));
            // Stored without the letter; the model adds it for display.
            $digits = ltrim($code, 'T');

            $quest = Quest::where('join_code', $digits)
                ->where('is_published', true)
                ->whereNull('deleted_at')
                ->first();

            if (! $quest) {
                return $this->notFoundResponse([], __("There's no quest with that code. Check the code on the host's screen."));
            }

            $userId = Auth::guard('api')->id();

            if ($quest->logged_in_users_only && ! $userId) {
                return $this->unauthorizedResponse([], __('You need to be logged in to join this quest.'));
            }

            $existingSession = QuestSession::where('quest_id', $quest->id)
                ->where('running_status', true)
                ->latest('id')
                ->first();

            if (! $existingSession) {
                return $this->badRequestResponse([], __("This quest isn't live right now. Ask the host to start it."));
            }

            app(LiveSessionService::class)->ensurePublicChannelKey($existingSession);

            return $this->okResponse([
                'quest' => $quest,
                'session' => $existingSession,
                'public_channel_key' => $existingSession->public_channel_key,
                'public_channel' => app(LiveSessionService::class)->publicChannel(LiveSessionService::MODULE_QUEST, $existingSession->public_channel_key),
            ], __('Quest retrieved successfully.'));
        } catch (\Exception $e) {
            Log::error('Quest join by code failed: ' . $e->getMessage());

            return $this->serverErrorResponse([], __('Failed to join quest. Please try again.'));
        }
    }

    /**
     * Update quest attempt status by join link.
     */
    public function updateStatusByJoinLink(UpdateStatusRequest $request, string $joinLink): JsonResponse
    {
        DB::beginTransaction();

        try {
            $quest = $this->getActiveQuestByJoinLink($joinLink);

            if (! $quest) {
                return $this->notFoundResponse([], __('Quest not found or not available.'));
            }

            // $validationResponse = $this->validateQuestAvailability($quest);

            // if ($validationResponse) {
            //     return $validationResponse;
            // }

            $userId = auth()->id();

            if (! $userId) {
                return $this->unauthorizedResponse(
                    [],
                    __('You need to be logged in to update the quest status.')
                );
            }

            // // Check for latest Quest Session
            $existingSession = QuestSession::where('quest_id', $quest->id)
                ->latest()
                ->first();

            if (! $existingSession) {
                return $this->notFoundResponse([], __('No active session found for this quest.'));
            }

            $attempt = QuestParticipant::where('quest_id', $quest->id)
                ->where('user_id', $userId)
                ->where('quest_session_id', $existingSession->id)
                ->where('status', 'In Progress')
                ->first();

            if (! $attempt) {
                return $this->notFoundResponse([], __('No active attempt found for this quest.'));
            }

            if (strtolower($request->status) === 'completed') {
                $attempt->end_time = $request->input('end_time') ?? now();
            }

            $attempt->status = $request->status;
            $attempt->save();

            $this->broadcastAttemptStatus($attempt, $request->status);

            DB::commit();

            return $this->okResponse(
                ['attempt' => $attempt],
                __('Quest attempt status updated successfully.')
            );
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error updating quest attempt status: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('Failed to update quest attempt status. Please try again.')
            );
        }
    }

    /**
     * Get attempt result by attempt ID.
     */
    public function getAttemptResult(int $attemptId): JsonResponse
    {
        try {
            $attempt = QuestParticipant::with(['quest', 'user', 'taskCompletions.task'])
                ->find($attemptId);

            if (! $attempt) {
                return $this->notFoundResponse([], __('Quest attempt not found'));
            }

            if (strtolower($attempt->status) !== 'completed') {
                return $this->badRequestResponse(
                    [],
                    __('This quest attempt is not completed yet')
                );
            }

            if (strtolower($attempt->status) === 'abandoned') {
                return $this->badRequestResponse(
                    [],
                    __('This quest attempt was abandoned and cannot be retrieved')
                );
            }

            return $this->okResponse(
                ['attempt' => $attempt],
                __('Quest attempt result retrieved successfully')
            );
        } catch (\Exception $e) {
            Log::error('Error getting attempt result: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quest attempt result')
            );
        }
    }

    /**
     * Get quest leaderboard by quest ID.
     */
    public function getQuestLeaderboard(int $questId, Request $request): JsonResponse
    {
        try {
            $quest = Quest::find($questId);

            if (! $quest) {
                return $this->notFoundResponse([], __('Quest not found'));
            }

            //            if ($quest->creator_id !== auth()->id()) {
            //                return $this->forbiddenResponse([], __('You are not allowed to access this quest.'));
            //            }

            // Check if this quest has any ranking tasks
            $hasRankingTasks = QuestTask::where('quest_id', $questId)
                ->where('task_type', 'option_ranking')
                ->exists();

            $rankingResults = null;
            $leaderboardData = null;

            if ($hasRankingTasks) {
                // Get all ranking tasks for this quest
                $rankingTasks = QuestTask::where('quest_id', $questId)
                    ->where('task_type', 'option_ranking')
                    ->with(['completions.participant.user'])
                    ->get();

                $taskResults = [];
                $overallOptionScores = [];

                foreach ($rankingTasks as $task) {
                    $taskScores = [];

                    foreach ($task->completions as $completion) {
                        $rankingData = $completion->completion_data['option_ranking'] ?? [];

                        // Calculate scores for each option in this completion
                        foreach ($rankingData as $position => $optionId) {
                            $points = 4 - $position; // 1st=4, 2nd=3, 3rd=2, 4th=1

                            // Add to task-specific scores
                            if (! isset($taskScores[$optionId])) {
                                $taskScores[$optionId] = 0;
                            }
                            $taskScores[$optionId] += $points;

                            // Add to overall scores across all tasks
                            if (! isset($overallOptionScores[$optionId])) {
                                $overallOptionScores[$optionId] = 0;
                            }
                            $overallOptionScores[$optionId] += $points;
                        }
                    }

                    // Format task results with option:score pairs
                    $formattedTaskScores = [];
                    foreach ($taskScores as $optionId => $score) {
                        $formattedTaskScores[] = "{$optionId}:{$score}";
                    }

                    $taskResults[] = [
                        'task_id' => $task->id,
                        'task_name' => $task->title,
                        'quest_id' => $questId,
                        'option_scores' => $formattedTaskScores,
                        'raw_scores' => $taskScores,
                    ];
                }

                // Format overall option scores
                $formattedOverallScores = [];
                foreach ($overallOptionScores as $optionId => $score) {
                    $formattedOverallScores[] = "{$optionId}:{$score}";
                }

                $rankingResults = [
                    'task_breakdown' => $taskResults,
                    'overall_scores' => $formattedOverallScores,
                    'raw_overall_scores' => $overallOptionScores,
                ];
            }

            // Always get the completion time leaderboard (for all participants)
            $leaderboardData = QuestParticipant::where('quest_id', $questId)
                ->with(['user'])
                ->orderByRaw('EXTRACT(EPOCH FROM end_time - start_time) ASC');

            if ($request->has('quest_session_id')) {
                $leaderboardData->where('quest_session_id', $request->input('quest_session_id'));
            }

            if ($request->has('limit')) {
                $leaderboardData->limit($request->input('limit'));
            }

            $leaderboardData = $leaderboardData->groupBy('quest_session_id', 'id')
                ->get();

            return $this->okResponse(
                [
                    'quest' => $quest,
                    'ranking_results' => $rankingResults,
                    'leaderboard' => $leaderboardData,
                ],
                __('Quest leaderboard retrieved successfully')
            );

        } catch (\Exception $e) {
            Log::error('Error getting quest leaderboard: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quest leaderboard')
            );
        }
    }

    /**
     * Get the quest leaderboard session list by quest ID.
     */
    public function getQuestLeaderboardSessionList(Request $request, $questId): JsonResponse
    {
        try {
            $quest = Quest::find($questId);

            if (! $quest) {
                return $this->notFoundResponse([], __('Quest not found'));
            }

            //            if ($quest->creator_id !== auth()->id()) {
            //                return $this->forbiddenResponse([], __('You are not allowed to access this quest.'));
            //            }

            $questSessions = QuestSession::where('quest_id', $questId)
                ->orderBy('created_at', 'desc')
                ->withCount('participants')
                ->whereHas('participants', function ($q) {
                    // optional: add filters on participants if needed for future use cases
                }, '>=', 0)
                ->paginate($request->input('per_page', 10));

            // $sessionParticipants = QuestSession::where('quest_id', $questId)
            //     ->withCount('participants')
            //     ->get('participants_count');

            return $this->okResponse(
                [
                    'quest' => $quest,
                    'questSessions' => $questSessions,
                ],
                __('Quest sessions retrieved successfully')
            );

        } catch (\Exception $e) {
            Log::error('Error getting quest sessions: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quest sessions')
            );
        }
    }

    /**
     * Export quest sessions to Excel
     */
    public function downloadSessionLeaderboardExcel(int $questId, Request $request): BinaryFileResponse|JsonResponse
    {
        try {
            $quest = Quest::find($questId);

            if (! $quest) {
                return $this->notFoundResponse([], __('Quest not found'));
            }

            // Get filtered data based on request parameters
            $questSessions = $this->getFilteredSessions($questId, $request);

            return Excel::download(new QuestSessionsExport($questSessions, $quest), "quest_{$questId}_sessions.xlsx");

        } catch (\Exception $e) {
            Log::error('Error exporting quest sessions to Excel: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quest leaderboard')
            );
        }
    }

    /**
     * Export quest sessions to CSV
     */
    public function downloadSessionLeaderboardCsv(int $questId, Request $request): JsonResponse|BinaryFileResponse
    {
        try {
            $quest = Quest::find($questId);

            if (! $quest) {
                return $this->notFoundResponse([], __('Quest not found'));
            }

            // Get filtered data based on request parameters
            $questSessions = $this->getFilteredSessions($questId, $request);

            return Excel::download(new QuestSessionsExport($questSessions, $quest), "quest_{$questId}_sessions.csv", \Maatwebsite\Excel\Excel::CSV, [
                'Content-Type' => 'text/csv',
            ]);

        } catch (\Exception $e) {
            Log::error('Error exporting quest sessions to CSV: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quest leaderboard')
            );
        }
    }

    /**
     * Get filtered sessions based on request parameters
     */
    private function getFilteredSessions(int $questId, Request $request)
    {
        $query = QuestSession::where('quest_id', $questId)
            ->withCount('participants')
            ->orderBy('created_at', 'desc');

        // Add your filter logic here based on request parameters
        if ($request->has('date_from') && $request->filled('date_from')) {
            $query->whereDate('created_at', '>=', $request->date_from);
        }

        if ($request->has('date_to') && $request->filled('date_to')) {
            $query->whereDate('created_at', '<=', $request->date_to);
        }

        if ($request->has('participants_min') && $request->filled('participants_min')) {
            $query->having('participants_count', '>=', $request->participants_min);
        }

        if ($request->has('participants_max') && $request->filled('participants_max')) {
            $query->having('participants_count', '<=', $request->participants_max);
        }

        return $query->get();
    }

    /**
     * Export quest session attempts to Excel
     */
    public function downloadSessionAttemptsExcel(int $sessionId): BinaryFileResponse|JsonResponse
    {
        try {
            $questSession = QuestSession::with([
                'participants.user', // Make sure this includes the basic participant info
                'participants.taskCompletions.task',
            ])->find($sessionId);

            if (! $questSession) {
                return $this->notFoundResponse([], __('Quest session not found'));
            }

            // Add unique tasks to the session object
            $uniqueTasks = $questSession->participants
                ->flatMap(function ($participant) {
                    return $participant->taskCompletions;
                })
                ->pluck('task')
                ->unique('id')
                ->values();

            // dd($questSession->participants);
            // Get all task completions
            // $allCompletions = $questSession->participants->flatMap(function ($participant) {
            //         return $participant->taskCompletions;
            //     })->values();

            return Excel::download(new QuestSessionAttemptsExport($questSession, $uniqueTasks), "quest_{$questSession->quest_id}_session_{$sessionId}_attempts.xlsx");

        } catch (\Exception $e) {
            Log::error('Error exporting quest session attempts to Excel: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quest session attempts')
            );
        }
    }

    /**
     * Export quest session attempts to CSV
     */
    public function downloadSessionAttemptsCsv(int $sessionId): BinaryFileResponse|JsonResponse
    {
        try {
            $questSession = QuestSession::with([
                'participants.user', // Make sure this includes the basic participant info
                'participants.taskCompletions.task',
            ])->find($sessionId);

            if (! $questSession) {
                return $this->notFoundResponse([], __('Quest session not found'));
            }

            // Add unique tasks to the session object
            $uniqueTasks = $questSession->participants
                ->flatMap(function ($participant) {
                    return $participant->taskCompletions;
                })
                ->pluck('task')
                ->unique('id')
                ->values();

            return Excel::download(new QuestSessionAttemptsExport($questSession, $uniqueTasks), "quest_{$questSession->quest_id}_session_{$sessionId}_attempts.csv", \Maatwebsite\Excel\Excel::CSV, [
                'Content-Type' => 'text/csv',
            ]);

        } catch (\Exception $e) {
            Log::error('Error exporting quest session attempts to CSV: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quest session attempts')
            );
        }
    }

    /**
     * Export quest session attempts to Vertical Excel
     */
    public function downloadSessionAttemptsVerticalExcel(int $sessionId): BinaryFileResponse|JsonResponse
    {
        try {
            $questSession = QuestSession::with([
                'participants.user', // Make sure this includes the basic participant info
                'participants.taskCompletions.task',
            ])->find($sessionId);

            if (! $questSession) {
                return $this->notFoundResponse([], __('Quest session not found'));
            }

            // Add unique tasks to the session object
            $uniqueTasks = $questSession->participants
                ->flatMap(function ($participant) {
                    return $participant->taskCompletions;
                })
                ->pluck('task')
                ->unique('id')
                ->values();

            // dd($questSession->participants);
            // Get all task completions
            // $allCompletions = $questSession->participants->flatMap(function ($participant) {
            //         return $participant->taskCompletions;
            //     })->values();

            return Excel::download(new QuestSessionAttemptExportVertical($questSession, $uniqueTasks), "quest_{$questSession->quest_id}_session_{$sessionId}_attempts.xlsx");

        } catch (\Exception $e) {
            Log::error('Error exporting quest session attempts to Excel: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quest session attempts')
            );
        }
    }

    /**
     * Export quest session attempts to Vertical CSV
     */
    public function downloadSessionAttemptsVerticalCsv(int $sessionId): BinaryFileResponse|JsonResponse
    {
        try {
            $questSession = QuestSession::with([
                'participants.user', // Make sure this includes the basic participant info
                'participants.taskCompletions.task',
            ])->find($sessionId);

            if (! $questSession) {
                return $this->notFoundResponse([], __('Quest session not found'));
            }

            // Add unique tasks to the session object
            $uniqueTasks = $questSession->participants
                ->flatMap(function ($participant) {
                    return $participant->taskCompletions;
                })
                ->pluck('task')
                ->unique('id')
                ->values();

            return Excel::download(new QuestSessionAttemptExportVertical($questSession, $uniqueTasks), "quest_{$questSession->quest_id}_session_{$sessionId}_attempts.csv", \Maatwebsite\Excel\Excel::CSV, [
                'Content-Type' => 'text/csv',
            ]);
        } catch (\Exception $e) {
            Log::error('Error exporting quest session attempts to CSV: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quest session attempts')
            );
        }
    }

    /**
     * Export quest session attempts to Excel Grouped
     */
    public function downloadSessionAttemptsGroupedExcel(int $sessionId): BinaryFileResponse|JsonResponse
    {
        try {
            $questSession = QuestSession::with([
                'participants.user', // Make sure this includes the basic participant info
                'participants.taskCompletions.task',
            ])->find($sessionId);

            if (! $questSession) {
                return $this->notFoundResponse([], __('Quest session not found'));
            }

            // Add unique tasks to the session object
            $uniqueTasks = $questSession->participants
                ->flatMap(function ($participant) {
                    return $participant->taskCompletions;
                })
                ->pluck('task')
                ->unique('id')
                ->values();

            // dd($questSession->participants);
            // Get all task completions
            // $allCompletions = $questSession->participants->flatMap(function ($participant) {
            //         return $participant->taskCompletions;
            //     })->values();

            return Excel::download(new QuestSessionAttemptExportGrouped($questSession, $uniqueTasks), "quest_{$questSession->quest_id}_session_{$sessionId}_attempts.xlsx");

        } catch (\Exception $e) {
            Log::error('Error exporting quest session attempts to Excel: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quest session attempts')
            );
        }
    }

    /**
     * Export quest session attempts to CSV Grouped
     */
    public function downloadSessionAttemptsGroupedCsv(int $sessionId): BinaryFileResponse|JsonResponse
    {
        try {
            $questSession = QuestSession::with([
                'participants.user', // Make sure this includes the basic participant info
                'participants.taskCompletions.task',
            ])->find($sessionId);

            if (! $questSession) {
                return $this->notFoundResponse([], __('Quest session not found'));
            }

            // Add unique tasks to the session object
            $uniqueTasks = $questSession->participants
                ->flatMap(function ($participant) {
                    return $participant->taskCompletions;
                })
                ->pluck('task')
                ->unique('id')
                ->values();

            return Excel::download(new QuestSessionAttemptExportGrouped($questSession, $uniqueTasks), "quest_{$questSession->quest_id}_session_{$sessionId}_attempts.csv", \Maatwebsite\Excel\Excel::CSV, [
                'Content-Type' => 'text/csv',
            ]);

        } catch (\Exception $e) {
            Log::error('Error exporting quest session attempts to CSV: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quest session attempts')
            );
        }
    }

    /**
     * Get quest leaderboard by quest ID.
     */
    public function getQuestLeaderboardSessionDetails(int $sessionId, Request $request): JsonResponse
    {
        try {
            $questSession = QuestSession::find($sessionId);

            if (! $questSession) {
                return $this->notFoundResponse([], __('Quest session not found'));
            }

            if (! $questSession->quest) {
                return $this->notFoundResponse([], __('Associated quest not found'));
            }

            // Check if this quest has any ranking tasks
            $hasRankingTasks = QuestTask::where('quest_id', $questSession->quest_id)
                ->where('task_type', 'option_ranking')
                ->exists();

            $rankingResults = null;
            $leaderboardData = null;

            if ($hasRankingTasks) {
                // Get all ranking tasks for this quest
                $rankingTasks = QuestTask::where('quest_id', $questSession->quest_id)
                    ->where('task_type', 'option_ranking')
                    ->with(['completions.participant.user'])
                    ->get();

                $taskResults = [];
                $overallOptionScores = [];

                foreach ($rankingTasks as $task) {
                    $taskScores = [];

                    foreach ($task->completions as $completion) {
                        $rankingData = $completion->completion_data['option_ranking'] ?? [];

                        // Calculate scores for each option in this completion
                        foreach ($rankingData as $position => $optionId) {
                            $points = 4 - $position; // 1st=4, 2nd=3, 3rd=2, 4th=1

                            // Add to task-specific scores
                            if (! isset($taskScores[$optionId])) {
                                $taskScores[$optionId] = 0;
                            }
                            $taskScores[$optionId] += $points;

                            // Add to overall scores across all tasks
                            if (! isset($overallOptionScores[$optionId])) {
                                $overallOptionScores[$optionId] = 0;
                            }
                            $overallOptionScores[$optionId] += $points;
                        }
                    }

                    // Format task results with option:score pairs
                    $formattedTaskScores = [];
                    foreach ($taskScores as $optionId => $score) {
                        $formattedTaskScores[] = "{$optionId}:{$score}";
                    }

                    $taskResults[] = [
                        'task_id' => $task->id,
                        'task_name' => $task->title,
                        'quest_id' => $questSession->quest_id,
                        'option_scores' => $formattedTaskScores,
                        'raw_scores' => $taskScores,
                    ];
                }

                // Format overall option scores
                $formattedOverallScores = [];
                foreach ($overallOptionScores as $optionId => $score) {
                    $formattedOverallScores[] = "{$optionId}:{$score}";
                }

                $rankingResults = [
                    'task_breakdown' => $taskResults,
                    'overall_scores' => $formattedOverallScores,
                    'raw_overall_scores' => $overallOptionScores,
                ];
            }

            // Always get the completion time leaderboard (for all participants)
            $leaderboardData = QuestParticipant::where('quest_id', $questSession->quest_id)
                ->with(['user', 'taskCompletions'])
                ->orderByRaw('EXTRACT(EPOCH FROM end_time - start_time) ASC')
                ->where('quest_session_id', $sessionId);

            if ($request->has('limit')) {
                $leaderboardData->limit($request->input('limit'));
            }

            $leaderboardData = $leaderboardData->groupBy('quest_session_id', 'id')
                ->get();

            return $this->okResponse(
                [
                    'quest' => $questSession->quest,
                    'ranking_results' => $rankingResults,
                    'leaderboard' => $leaderboardData,
                ],
                __('Quest leaderboard retrieved successfully')
            );

        } catch (\Exception $e) {
            Log::error('Error getting quest leaderboard: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quest leaderboard')
            );
        }
    }

    /**
     * Get quest leaderboard session details with combined score.
     */
    public function getQuestLeaderboardSessionDetailsWithCombinedScore(int $sessionId): JsonResponse
    {
        try {
            $questSession = QuestSession::find($sessionId);

            if (! $questSession) {
                return $this->notFoundResponse([], __('Quest session not found'));
            }

            if ($questSession->running_status) {
                return $this->okResponse(
                    [],
                    __('Quest session is running. Leaderboard data will be available after the session ends.')
                );
            }

            // Get tasks for this quest with their completions from participants in this session
            $questTasks = QuestTask::where('quest_id', $questSession->quest_id)
                ->with(['completions' => function ($query) use ($sessionId) {
                    $query->whereHas('participant', function ($q) use ($sessionId) {
                        $q->where('quest_session_id', $sessionId);
                    })
                        ->select('id', 'task_id', 'completion_data->selected_option as selected_option');
                }])
                ->get();

            // Process each task to count option selections
            foreach ($questTasks as $task) {
                // How many players answered. The option counts don't say: a scale's are averages, a
                // ranking's are scores, and a multiple-answer pick counts once per option.
                $task->responses_count = $task->completions->count();

                if ($task->task_type == 'quick_form') {
                    $questions = $task->task_data['questions'] ?? [];
                    $optionsCount = [];

                    // Initialize all counts to 0 for each option per question using array indices
                    foreach ($questions as $index => $question) {
                        $questionId = (string) $index; // Use array index as question ID
                        $optionsCount[$questionId] = [];

                        if (! empty($question['options'])) {
                            // Use array indices for options as well
                            foreach ($question['options'] as $optionIndex => $option) {
                                $optionId = (string) $optionIndex;
                                $optionsCount[$questionId][$optionId] = [
                                    'count' => 0,
                                    'text' => $option['text'] ?? $option['label'] ?? 'Option ' . ($optionIndex + 1),
                                ];
                            }
                        }
                    }

                    // Count selections from completions
                    foreach ($task->completions as $completion) {
                        $selectedOptionRaw = $completion->selected_option;

                        if ($selectedOptionRaw) {
                            $decoded = json_decode($selectedOptionRaw, true);

                            if (is_array($decoded)) {
                                foreach ($decoded as $questionIndex => $value) {
                                    $questionId = (string) $questionIndex;

                                    if (isset($optionsCount[$questionId])) {
                                        // If checkbox (array of values)
                                        if (is_array($value)) {
                                            foreach ($value as $optionIndex) {
                                                $optionId = (string) $optionIndex;
                                                if (isset($optionsCount[$questionId][$optionId])) {
                                                    $optionsCount[$questionId][$optionId]['count']++;
                                                }
                                            }
                                        } else {
                                            // Radio/dropdown (single value)
                                            $optionId = (string) $value;
                                            if (isset($optionsCount[$questionId][$optionId])) {
                                                $optionsCount[$questionId][$optionId]['count']++;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Convert to object format to preserve keys in JSON
                    $task->optionsCount = (object) $optionsCount;
                } elseif ($task->task_type == 'scaling' || $task->task_type == 'scales') {
                    $scaleMin = $task->task_data['minNumber'] ?? 1;
                    $scaleMax = $task->task_data['maxNumber'] ?? 5;
                    $highestValue = ceil($scaleMax / 5) * 5; // Round up to nearest multiple of 5

                    $optionsCount = [];
                    $positionSums = [];
                    $positionCounts = [];

                    // Initialize arrays to store sums and counts for each position
                    foreach ($task->completions as $completion) {
                        $selectedOption = $completion->selected_option ?? null;

                        if ($selectedOption !== null) {
                            // Parse the string as JSON array - handle both string and array formats
                            if (is_string($selectedOption)) {
                                $selectedValues = json_decode($selectedOption, true);
                            } else {
                                $selectedValues = $selectedOption;
                            }

                            if (is_array($selectedValues)) {
                                // For each position in the array, accumulate the sum and count
                                foreach ($selectedValues as $position => $value) {
                                    // 0 is a statement the player left unrated (scales start at 1).
                                    if (! is_numeric($value) || (float) $value == 0.0) {
                                        continue;
                                    }
                                    if (! isset($positionSums[$position])) {
                                        $positionSums[$position] = 0;
                                        $positionCounts[$position] = 0;
                                    }
                                    $positionSums[$position] += $value;
                                    $positionCounts[$position]++;
                                }
                            }
                        }
                    }

                    // Calculate the scaled average for each position
                    foreach ($positionSums as $position => $sum) {
                        $count = $positionCounts[$position];
                        if ($count > 0) {
                            $average = $sum / $count;
                            $calculatedValue = $average * $highestValue;

                            $myCalculatedValue = $sum / ($highestValue * $count) * 100;

                            $optionsCount[(string) $position] = [
                                'count' => (int) round($myCalculatedValue),
                                'count_raw' => $count,
                                'count_position' => count($positionCounts),
                                'sum' => $sum,
                                'calculated_value' => $calculatedValue,
                                'average' => $average,
                                'highest_value' => $highestValue,
                                'my_calculated_value' => $myCalculatedValue,
                                'text' => $task->task_data['questions'][$position]['text'] ?? 'Option ' . ($position + 1),
                            ];
                        }
                    }

                    // Fill in statements nobody rated
                    $statements = $task->task_data['questions'] ?? [];
                    $maxPosition = max(count($statements) - 1, ! empty($positionSums) ? max(array_keys($positionSums)) : 0);
                    for ($i = 0; $i <= $maxPosition; $i++) {
                        $key = (string) $i;
                        if (! isset($optionsCount[$key])) {
                            $optionsCount[$key] = [
                                'count' => 0,
                                'average' => 0,
                                'text' => $statements[$i]['text'] ?? 'Option ' . ($i + 1),
                            ];
                        }
                    }

                    // Keyed by the statement's position in task_data.questions, which stays in its
                    // original order: re-sorting it here gave statements each other's results, as the
                    // client reads these keys by index (the chart sorts by itself).
                    ksort($optionsCount, SORT_NUMERIC);
                    $task->optionsCount = (object) $optionsCount;
                } elseif ($task->task_type == 'ranking') {
                    $numOptions = count($task->task_data['questions']);
                    $totalCompletions = count($task->completions);

                    // The highest rank (1st place) gets the highest value, which is numOptions
                    $highestRankValue = $numOptions;
                    $highestValue = $highestRankValue * $totalCompletions; // Max possible sum

                    $optionsCount = [];
                    $optionSums = array_fill(0, $numOptions, 0); // Initialize sums for each option

                    // Calculate sums for each option
                    foreach ($task->completions as $completion) {
                        $selectedOption = $completion->selected_option ?? null;

                        if ($selectedOption !== null) {
                            // Parse the string as JSON array
                            if (is_string($selectedOption)) {
                                $rankingArray = json_decode($selectedOption, true);
                            } else {
                                $rankingArray = $selectedOption;
                            }

                            if (is_array($rankingArray)) {
                                // The array represents the ranking order
                                // Index = position in array, Value = option index
                                // Position 0 = 1st place (highest rank), gets highest value
                                foreach ($rankingArray as $position => $optionIndex) {
                                    // Rank value: 1st place = highestRankValue, 2nd place = highestRankValue-1, etc.
                                    $rankValue = $highestRankValue - $position;
                                    $optionSums[$optionIndex] += $rankValue;
                                }
                            }
                        }
                    }

                    // Find the maximum sum to normalize percentages (so highest = 100%)
                    $maxSum = max($optionSums);

                    // Calculate the percentage and prepare optionsCount
                    foreach ($optionSums as $optionIndex => $sum) {
                        // Normalize percentage so highest sum = 100%
                        $percentage = $maxSum > 0 ? ($sum * 100) / $maxSum : 0;
                        $average = $totalCompletions > 0 ? $sum / $totalCompletions : 0;

                        $optionsCount[(string) $optionIndex] = [
                            'count' => (int) round($percentage),
                            'sum' => $sum,
                            'average' => $average,
                            'highest_value' => $highestValue,
                            'text' => $task->task_data['questions'][$optionIndex]['text'] ?? 'Option ' . ($optionIndex + 1),
                        ];
                    }

                    // Fill in any missing options
                    for ($i = 0; $i < $numOptions; $i++) {
                        $key = (string) $i;
                        if (! isset($optionsCount[$key])) {
                            $optionsCount[$key] = [
                                'count' => 0,
                                'sum' => 0,
                                'average' => 0,
                                'highest_value' => $highestValue,
                                'text' => $task->task_data['questions'][$i]['text'] ?? 'Option ' . ($i + 1),
                            ];
                        }
                    }

                    // Sort by count descending
                    uasort($optionsCount, function ($a, $b) {
                        return $b['count'] - $a['count'];
                    });

                    // Convert to object format
                    $task->optionsCount = (object) $optionsCount;

                    // Reorder the questions array to match the sorted optionsCount order
                    // Create a copy of task_data to avoid the "indirect modification" error
                    $taskData = $task->task_data;
                    $sortedQuestions = [];

                    foreach (array_keys((array) $task->optionsCount) as $optionIndex) {
                        $sortedQuestions[] = $taskData['questions'][$optionIndex];
                    }

                    $taskData['questions'] = $sortedQuestions;
                    $task->task_data = $taskData;
                } elseif ($task->task_type == 'sorting' || $task->task_type == 'shorting') {
                    $numOptions = count($task->task_data['questions']);
                    $totalCompletions = count($task->completions);

                    // The highest rank (1st place) gets the highest value, which is numOptions
                    $highestRankValue = $numOptions;
                    $highestValue = $highestRankValue * $totalCompletions; // Max possible sum

                    $optionsCount = [];
                    $optionSums = array_fill(0, $numOptions, 0); // Initialize sums for each option

                    // Calculate sums for each option
                    foreach ($task->completions as $completion) {
                        $selectedOption = $completion->selected_option ?? null;

                        if ($selectedOption !== null) {
                            // Parse the string as JSON array
                            if (is_string($selectedOption)) {
                                $rankingArray = json_decode($selectedOption, true);
                            } else {
                                $rankingArray = $selectedOption;
                            }

                            if (is_array($rankingArray)) {
                                // The array represents the ranking order
                                // Index = position in array, Value = option index
                                // Position 0 = 1st place (highest rank), gets highest value
                                foreach ($rankingArray as $position => $optionIndex) {
                                    // Rank value: 1st place = highestRankValue, 2nd place = highestRankValue-1, etc.
                                    $rankValue = $highestRankValue - $position;
                                    $optionSums[$optionIndex] += $rankValue;
                                }
                            }
                        }
                    }

                    // Find the maximum sum to normalize percentages (so highest = 100%)
                    $maxSum = max($optionSums);

                    // Calculate the percentage and prepare optionsCount
                    foreach ($optionSums as $optionIndex => $sum) {
                        // Normalize percentage so highest sum = 100%
                        $percentage = $maxSum > 0 ? ($sum * 100) / $maxSum : 0;
                        $average = $totalCompletions > 0 ? $sum / $totalCompletions : 0;

                        $optionsCount[(string) $optionIndex] = [
                            'count' => (int) round($percentage),
                            'sum' => $sum,
                            'average' => $average,
                            'highest_value' => $highestValue,
                            'text' => $task->task_data['questions'][$optionIndex]['text'] ?? 'Option ' . ($optionIndex + 1),
                        ];
                    }

                    // Fill in any missing options
                    for ($i = 0; $i < $numOptions; $i++) {
                        $key = (string) $i;
                        if (! isset($optionsCount[$key])) {
                            $optionsCount[$key] = [
                                'count' => 0,
                                'sum' => 0,
                                'average' => 0,
                                'highest_value' => $highestValue,
                                'text' => $task->task_data['questions'][$i]['text'] ?? 'Option ' . ($i + 1),
                            ];
                        }
                    }

                    // Sort by count descending
                    uasort($optionsCount, function ($a, $b) {
                        return $b['count'] - $a['count'];
                    });

                    // Convert to object format
                    $task->optionsCount = (object) $optionsCount;

                    // Reorder the questions array to match the sorted optionsCount order
                    // Create a copy of task_data to avoid the "indirect modification" error
                    $taskData = $task->task_data;
                    $sortedQuestions = [];

                    foreach (array_keys((array) $task->optionsCount) as $optionIndex) {
                        $sortedQuestions[] = $taskData['questions'][$optionIndex];
                    }

                    $taskData['questions'] = $sortedQuestions;
                    $task->task_data = $taskData;
                } else {
                    // For other task types (ranking, etc.)
                    $optionsCount = [];
                    $questions = $task->task_data['questions'] ?? [];

                    // Initialize count = 0 for each option using array indices
                    foreach ($questions as $index => $question) {
                        $optionsCount[(string) $index] = [
                            'count' => 0,
                            'text' => $question['text'] ?? $question['label'] ?? 'Option ' . ($index + 1),
                        ];
                    }

                    // Count selections from completions
                    foreach ($task->completions as $completion) {
                        $selectedOption = $completion->selected_option ?? null;

                        if ($selectedOption !== null) {
                            $decoded = json_decode($selectedOption, true);

                            if (is_array($decoded)) {
                                // Multiple selected options (array of indices like [2, 1, 0])
                                foreach ($decoded as $optionIndex) {
                                    $optionKey = (string) $optionIndex;
                                    if (isset($optionsCount[$optionKey])) {
                                        $optionsCount[$optionKey]['count']++;
                                    }
                                }
                            } else {
                                // Single selected option (index)
                                $optionKey = (string) $selectedOption;
                                if (isset($optionsCount[$optionKey])) {
                                    $optionsCount[$optionKey]['count']++;
                                }
                            }
                        }
                    }

                    // Convert to object format to preserve keys in JSON
                    $task->optionsCount = (object) $optionsCount;
                }
            }

            return $this->okResponse(
                [
                    'questSession' => $questSession,
                    'questTasks' => $questTasks,
                ],
                __('Quest combined scores retrieved successfully')
            );

        } catch (\Exception $e) {
            Log::error('Error getting combined scores: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the combined scores')
            );
        }
    }

    /**
     * Get an active quest by joining the link.
     */
    protected function getActiveQuestByJoinLink(string $joinLink): ?Quest
    {
        return Quest::where('join_link', $joinLink)
            ->where('is_published', true)
            ->whereNull('deleted_at')
            ->first();
    }

    /**
     * Validate quest availability.
     */
    protected function validateQuestAvailability(Quest $quest): ?JsonResponse
    {
        $now = now();

        if ($now < $quest->start_datetime) {
            return $this->forbiddenResponse([], __('This quest is not start yet.'));
        }

        if ($now > $quest->end_datetime) {
            return $this->forbiddenResponse([], __('This quest has already ended.'));
        }

        return null;
    }

    /**
     * Check for existing attempt.
     */
    protected function checkExistingAttempt(
        Quest $quest,
        ?QuestSession $existingSession,
        ?int $userId,
        $request
    ): ?JsonResponse {
        if ($userId) {
            $existingAttempt = QuestParticipant::where('quest_id', $quest->id)
                ->where('user_id', $userId)
                ->where('quest_session_id', $existingSession->id)
                ->where('status', 'In Progress')
                ->first();

            if ($existingAttempt) {
                return $this->okResponse([
                    'quest' => $quest,
                    'attempt' => $existingAttempt,
                ], __('You already have an active attempt for this quest session.'));
            }
        }

        return null;
    }

    /**
     * Generate unique anonymous name.
     */
    protected function generateUniqueAnonymousName(Quest $quest, string $anonymousName): string
    {
        $baseName = $anonymousName;
        $counter = 1;

        while (QuestParticipant::where('quest_id', $quest->id)
            ->where('is_anonymous', true)
            ->whereJsonContains('anonymous_details->name', $anonymousName)
            ->exists()) {
            $anonymousName = $baseName . '_' . $counter;
            $counter++;
        }

        return $anonymousName;
    }

    /**
     * Create new quest attempt.
     */
    protected function createNewAttempt(
        Quest $quest,
        QuestSession $questSession,
        ?int $userId,
        $request
    ): QuestParticipant {
        return QuestParticipant::create([
            'quest_id' => $quest->id,
            'quest_session_id' => $questSession->id,
            'user_id' => $userId,
            'is_anonymous' => ! $userId,
            'anonymous_details' => ! $userId ? [
                'name' => $request->input('anonymous_name'),
                'email' => $request->input('anonymous_email'),
            ] : null,
            'start_time' => now(),
            'end_time' => null,
            'score' => 0,
            'status' => 'In Progress',
        ]);
    }

    /**
     * Get latest session ID for a quest.
     */
    protected function getLatestSessionId(int $questId): ?int
    {
        $latestSession = QuestSession::where('quest_id', $questId)
            ->latest()
            ->first();

        return $latestSession ? $latestSession->id : null;
    }

    /**
     * Check if all prerequisites are completed before submitting a task
     */
    protected function checkPrerequisites(int $participantId, int $taskId): bool
    {
        $task = QuestTask::with('prerequisites')->findOrFail($taskId);

        if ($task->prerequisites->isEmpty()) {
            return true; // No prerequisites, so it's allowed
        }

        // Get all prerequisite task IDs
        $prerequisiteIds = $task->prerequisites->pluck('id')->toArray();

        // Check if all prerequisites are completed for this participant
        $completedCount = QuestTaskCompletion::where('participant_id', $participantId)
            ->whereIn('task_id', $prerequisiteIds)
            ->where('status', 'Completed')
            ->count();

        return $completedCount === count($prerequisiteIds);
    }

    private function broadcastAttemptStatus(QuestParticipant $attempt, string $status): void
    {
        $session = $attempt->questSession;

        if (! $session) {
            return;
        }

        $payload = [
            'session_id' => $session->id,
            'participant_id' => $attempt->id,
            'status' => $attempt->status,
            'ended_at' => optional($attempt->end_time)->toISOString(),
        ];

        app(LiveSessionService::class)->broadcastHost(
            LiveSessionService::MODULE_QUEST,
            $session,
            'participant.status.updated',
            $payload,
        );

        if (in_array(strtolower($status), ['completed', 'abandoned'], true)) {
            app(ParticipantTokenService::class)->revokeParticipant($attempt);
        }

        if (strtolower($status) === 'completed') {
            app(LiveSessionService::class)->broadcastParticipantCompleted(
                LiveSessionService::MODULE_QUEST,
                $session,
                $attempt,
                $payload,
            );
        }
    }
}
