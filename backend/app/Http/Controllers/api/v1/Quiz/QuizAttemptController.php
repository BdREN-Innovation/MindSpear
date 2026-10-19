<?php

namespace App\Http\Controllers\api\v1\Quiz;

use App\Exports\Quizzes\QuizSessionAttemptExportGrouped;
use App\Exports\Quizzes\QuizSessionAttemptExportVertical;
use App\Exports\Quizzes\QuizSessionAttemptsExport;
use App\Exports\Quizzes\QuizSessionsExport;
use App\Http\Controllers\api\v1\ApiBaseController;
use App\Http\Requests\Quiz\QuizAttempt\JoinByCodeRequest;
use App\Http\Requests\Quiz\QuizAttempt\JoinRequest;
use App\Http\Requests\Quiz\QuizAttempt\RecordAnswerRequest;
use App\Http\Requests\Quiz\QuizAttempt\StartAttemptRequest;
use App\Http\Requests\Quiz\QuizAttempt\UpdateStatusRequest;
use App\Models\Quiz\Question;
use App\Models\Quiz\Quiz;
use App\Models\Quiz\QuizParticipant;
use App\Models\Quiz\QuizSession;
use App\Models\Quiz\UserQuizAnswer;
use App\Services\Live\LiveAggregateService;
use App\Services\Live\LiveSessionService;
use App\Services\Live\ParticipantTokenService;
use App\Services\Quiz\LegacyQuizScorer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use Maatwebsite\Excel\Facades\Excel;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class QuizAttemptController extends ApiBaseController
{
    /**
     * Start a new quiz attempt.
     */
    public function startAttempt(StartAttemptRequest $request, int $sessionId): JsonResponse
    {
        try {
            DB::beginTransaction();
            $validated = $request->validated();
            $session = QuizSession::find($sessionId);

            if (! $session) {
                return $this->notFoundResponse([], __('Quiz session not found'));
            }

            $quizId = $session->quiz_id;

            $quiz = Quiz::find($quizId);

            if (! $quiz) {
                return $this->notFoundResponse([], __('Quiz not found'));
            }

            $userId = $validated['user_id'];

            // Check for latest Quest Session
            $existingSession = QuizSession::where('quiz_id', $quizId)
                ->where('id', $sessionId)
                ->latest()
                ->first();

            if (! $existingSession) {
                return $this->notFoundResponse([], __('No active session found for this quiz.'));
            }

            $existingAttempt = $this->checkExistingAttemptQuiz($quiz, $existingSession, $userId, $request);

            if ($existingAttempt) {
                return $this->badRequestResponse([], __('You already have an active attempt for this quiz session.'));
            }

            $attempt = QuizParticipant::create([
                'quiz_id' => $quizId,
                'user_id' => $userId,
                'quiz_session_id' => $existingSession->id,
                'is_anonymous' => $validated['is_anonymous'],
                'anonymous_details' => $validated['anonymous_details'] ?? null,
                'start_time' => now(),
                'end_time' => null,
                'score' => 0,
                'status' => 'In Progress',
            ]);

            $participantToken = app(ParticipantTokenService::class)->issue($attempt, $existingSession);
            $liveSessions = app(LiveSessionService::class);
            $liveSessions->ensurePublicChannelKey($existingSession);
            $liveSessions->broadcastParticipantJoined(LiveSessionService::MODULE_QUIZ, $existingSession, (int) $attempt->id);

            DB::commit();

            return $this->okResponse(
                [
                    'attempt' => app(ParticipantTokenService::class)->sanitizeParticipant($attempt->load(['quiz', 'user'])),
                    'participant_token' => $participantToken,
                    'public_channel_key' => $existingSession->public_channel_key,
                    'public_channel' => $liveSessions->publicChannel(LiveSessionService::MODULE_QUIZ, $existingSession->public_channel_key),
                ],
                __('Quiz attempt started successfully')
            );
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error starting quiz attempt: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while starting the quiz attempt')
            );
        }
    }

    /**
     * Record answers of attempt.
     */
    public function recordAnswer(RecordAnswerRequest $request, $attemptId): JsonResponse
    {
        try {
            Log::info('QuizAttemptController@recordAnswer invoked', [
                'attempt_id' => $attemptId,
                'payload' => $request->all(),
                'headers' => request()->headers->all(),
            ]);

            DB::beginTransaction();

            // Validate with explicit catch to surface errors instead of 500
            try {
                $validated = $request->validated();
            } catch (ValidationException $ve) {
                Log::warning('recordAnswer validation failed', [
                    'attempt_id' => $attemptId,
                    'errors' => $ve->errors(),
                ]);

                return $this->unprocessableResponse([
                    'validation_errors' => $ve->errors(),
                ], __('Validation Error'));
            }
            $attempt = QuizParticipant::find($attemptId);

            if (! $attempt) {
                return $this->notFoundResponse([], __('Quiz attempt not found'));
            }

            if (strtolower($attempt->status) !== 'in progress') {
                return $this->badRequestResponse([], __('This quiz attempt is no longer active'));
            }

            if (! app(ParticipantTokenService::class)->validateRequest($request, $attempt)) {
                DB::rollBack();

                return $this->unauthorizedResponse([], __('Invalid or expired participant token.'));
            }

            // Ensure answer_data is always an associative array (column is non-null JSON)
            $answerData = (array) ($validated['answer_data'] ?? []);

            // If client sent a list of objects like [{k:v},{k2:v2}], merge into one object
            $isList = array_keys($answerData) === range(0, count($answerData) - 1);
            if ($isList) {
                $merged = [];
                foreach ($answerData as $part) {
                    if (is_array($part)) {
                        $merged = array_merge($merged, $part);
                    }
                }
                $answerData = $merged;
            }

            // Append a normalized timestamp string to avoid serializing objects inside JSON column
            $answerData['start_time_now'] = $answerData['start_time'] ?? now() ?? '';
            $answerData['end_time_now'] = $answerData['end_time'] ?? now() ?? '';

            Log::info('recordAnswer after validation and normalization', [
                'attempt_id' => $attemptId,
                'question_id' => $validated['question_id'] ?? null,
            ]);

            Log::info('recordAnswer about to upsert via query builder', [
                'attempt_id' => $attemptId,
            ]);

            // In a live session, time the answer by the server's clock from when the host opened the
            // question: the browser's figure was 12 hours off (it read the host's start time as AM),
            // and a reconnecting player's clock can't be trusted. Game mode breaks ties on it.
            $timeTaken = (int) ($validated['time_taken_seconds'] ?? 0);
            $liveSession = $attempt->quiz_session_id ? $attempt->quizSession : null;
            if ($liveSession && (int) $liveSession->current_question_id === (int) $validated['question_id']) {
                $timer = is_array($liveSession->timer_state) ? $liveSession->timer_state : null;
                $elapsed = app(LiveSessionService::class)->secondsSinceTimerStart($timer);
                if ($elapsed !== null) {
                    $timeTaken = is_numeric($timer['duration_seconds'] ?? null)
                        ? min($elapsed, (int) $timer['duration_seconds'])
                        : $elapsed;
                }
            }

            // Use query builder to avoid Eloquent memory usage, and handle created_at only on insert
            $now = now();
            $values = [
                'answer_data' => json_encode($answerData, JSON_UNESCAPED_UNICODE),
                'time_taken_seconds' => $timeTaken,
                'updated_at' => $now,
            ];

            $updated = UserQuizAnswer::query()
                ->where('quiz_participant_id', $attemptId)
                ->where('question_id', $validated['question_id'])
                ->update($values);

            if ($updated === 0) {
                $data = UserQuizAnswer::query()->insert([
                    'quiz_participant_id' => $attemptId,
                    'question_id' => $validated['question_id'],
                    'answer_data' => $values['answer_data'],
                    'time_taken_seconds' => $values['time_taken_seconds'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            } else {
                $data = $answerData;
            }

            if ($attempt->quiz_session_id) {
                $session = $attempt->quizSession;

                if ($session) {
                    app(LiveSessionService::class)->broadcastHost(LiveSessionService::MODULE_QUIZ, $session, 'answer.submitted', [
                        'session_id' => $attempt->quiz_session_id,
                        'participant_id' => $attempt->id,
                        'question_id' => (int) $validated['question_id'],
                    ]);
                    app(LiveAggregateService::class)->recordAnswer(
                        LiveSessionService::MODULE_QUIZ,
                        (int) $attempt->quiz_session_id,
                        (int) $validated['question_id'],
                    );
                }
            }

            DB::commit();

            return $this->okResponse([
                'answer' => [
                    'quiz_participant_id' => (int) $attemptId,
                    'question_id' => (int) $validated['question_id'],
                    'answer_data' => $answerData,
                    'time_taken_seconds' => $timeTaken,
                ],
            ], __('Answer recorded successfully'));
        } catch (QueryException $qe) {
            DB::rollBack();
            Log::error('DB error recording answer', [
                'message' => $qe->getMessage(),
                'code' => $qe->getCode(),
                'attempt_id' => $attemptId,
            ]);

            return $this->serverErrorResponse([], __('Database error while recording the answer'));
        } catch (\Throwable $e) {
            DB::rollBack();
            Log::error('Error recording answer', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
                'attempt_id' => $attemptId,
                'payload' => $request->all(),
            ]);

            return $this->serverErrorResponse(
                [],
                __('An error occurred while recording the answer')
            );
        }
    }

    /**
     * Status update of attempt.
     */
    public function updateStatus(UpdateStatusRequest $request, int $attemptId): JsonResponse
    {
        DB::beginTransaction();

        try {
            $validated = $request->validated();
            $attempt = QuizParticipant::with(['quiz', 'user', 'userQuizAnswers.question'])
                ->find($attemptId);

            if (! $attempt) {
                return $this->notFoundResponse([], __('Quiz attempt not found'));
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
                $this->completeAttempt($attempt);
            }

            $attempt->status = $validated['status'];
            $attempt->save();

            $this->broadcastAttemptStatus($attempt, $validated['status']);

            DB::commit();

            return $this->okResponse(
                ['attempt' => $attempt],
                __('Quiz attempt status updated successfully')
            );
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error updating quiz status: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while updating the quiz status')
            );
        }
    }

    /**
     * Get attempt details.
     */
    public function getAttemptDetails(int $attemptId): JsonResponse
    {
        try {
            $attempt = QuizParticipant::with(['quiz', 'user', 'userQuizAnswers.question'])
                ->find($attemptId);

            if (! $attempt) {
                return $this->notFoundResponse([], __('Quiz attempt not found'));
            }

            return $this->okResponse(
                ['attempt' => $attempt],
                __('Quiz attempt details retrieved successfully')
            );
        } catch (\Exception $e) {
            Log::error('Error getting attempt details: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quiz attempt details')
            );
        }
    }

    /**
     * Get current user attempts.
     */
    public function getUserCurrentAttempts(): JsonResponse
    {
        try {
            $userId = Auth::guard('api')->id();
            $attempts = QuizParticipant::with(['quiz', 'user'])
                ->UserId($userId)
                ->Status('In Progress')
                ->get();

            if ($attempts->isEmpty()) {
                return $this->notFoundResponse([], __('No current quiz attempts found'));
            }

            return $this->okResponse(
                ['attempts' => $attempts],
                __('Current quiz attempts retrieved successfully')
            );
        } catch (\Exception $e) {
            Log::error('Error getting user attempts: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving your quiz attempts')
            );
        }
    }

    /**
     * Get user attempt history.
     */
    public function getUserAttemptHistory(Request $request): JsonResponse
    {
        try {
            $userId = Auth::guard('api')->id();
            $attempts = QuizParticipant::UserId($userId)
                ->QuizIdNotNull();

            $attempts = $attempts->orderByColumn(
                $request->input('order_by', 'created_at'),
                $request->input('order_direction', 'desc')
            );

            // You might want to add pagination here
            $attempts = $attempts->paginate($request->input('per_page', 10));

            return $this->okResponse(
                ['attempts' => $attempts],
                __('Quiz attempt history retrieved successfully')
            );
        } catch (\Exception $e) {
            Log::error('Error getting user attempt history: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving your quiz attempt history')
            );
        }
    }

    /**
     * Get quiz details by join link.
     */
    public function getQuizDetailsByJoinLink(string $joinLink): JsonResponse
    {
        try {
            $quiz = Quiz::with([
                'questions',
                'sessions' => function ($query) use ($joinLink) {
                    $query->where('join_link', $joinLink);
                },
            ])
                ->whereHas('sessions', function ($query) use ($joinLink) {
                    $query->where('join_link', $joinLink);
                })
                ->whereNull('deleted_at')
                ->first();

            if (! $quiz) {
                // An ended session's link is cleared, so this is also what a late player sees.
                return $this->notFoundResponse([], __('This quiz link is no longer active. The quiz may have ended.'));
            }

            $now = now();
            $session = $quiz->sessions->first();

            if (! $session) {
                return $this->notFoundResponse([], __('Quiz session not found or not available.'));
            }

            if ($now < $session->start_datetime) {
                return $this->badRequestResponse([], __('This quiz session is not open yet.'));
            }

            if ($now > $session->end_datetime) {
                return $this->badRequestResponse([], __('This quiz session has already closed.'));
            }

            app(LiveSessionService::class)->ensurePublicChannelKey($session);

            return $this->okResponse(
                [
                    'quiz' => $quiz,
                    'quizSession' => $session,
                    'session' => $session,
                    'public_channel_key' => $session->public_channel_key,
                    'public_channel' => app(LiveSessionService::class)
                        ->publicChannel(LiveSessionService::MODULE_QUIZ, $session->public_channel_key),
                ],
                __('Quiz details retrieved successfully.')
            );
        } catch (\Exception $e) {
            Log::error('Error retrieving quiz details: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('Failed to retrieve quiz details. Please try again.')
            );
        }
    }

    /**
     * Join a quiz using join link.
     */
    public function join(JoinRequest $request, string $joinLink): JsonResponse
    {
        DB::beginTransaction();

        try {
            $quizSession = QuizSession::where('join_link', $joinLink)->first();

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz session not found or not available.'));
            }

            // $validationResponse = $this->validateQuestAvailability($quest);

            // if ($validationResponse) {
            //     return $validationResponse;
            // }

            $userId = auth()->id();

            // if ($quizSession->quiz->logged_in_users_only && ! $userId) {
            //     return $this->unauthorizedResponse(
            //         [],
            //         __('You need to be logged in to join this quiz.')
            //     );
            // }

            $existingAttempt = $this->checkExistingAttemptQuiz($quizSession->quiz, $quizSession, $userId, $request);

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
                $anonymousName = $this->generateUniqueAnonymousName($quizSession->quiz, $anonymousName);
            }

            $attempt = $this->createNewAttemptQuiz($quizSession->quiz, $quizSession, $userId, $request);
            $participantToken = app(ParticipantTokenService::class)->issue($attempt, $quizSession);
            $liveSessions = app(LiveSessionService::class);
            $liveSessions->ensurePublicChannelKey($quizSession);
            $liveSessions->broadcastParticipantJoined(LiveSessionService::MODULE_QUIZ, $quizSession, (int) $attempt->id);

            DB::commit();

            return $this->createdResponse(
                [
                    'quiz' => $quizSession->quiz,
                    'session' => $quizSession,
                    'attempt' => app(ParticipantTokenService::class)->sanitizeParticipant($attempt),
                    'participant_token' => $participantToken,
                    'public_channel_key' => $quizSession->public_channel_key,
                    'public_channel' => $liveSessions->publicChannel(LiveSessionService::MODULE_QUIZ, $quizSession->public_channel_key),
                ],
                __('Quiz attempt started successfully.')
            );
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Quiz join and attempt failed: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('Failed to join quiz. Please try again.')
            );
        }
    }
    // {
    //     DB::beginTransaction();

    //     try {
    //         $quiz = $this->getActiveQuizByJoinLink($joinLink);

    //         if (! $quiz) {
    //             return $this->notFoundResponse([], __('Quiz not found or not available.'));
    //         }

    //         $validationResponse = $this->validateQuizAvailability($quiz);

    //         if ($validationResponse) {
    //             return $validationResponse;
    //         }

    //         $userId = Auth::guard('api')->id();

    //         if ($quiz->logged_in_users_only && ! $userId) {
    //             return $this->unauthorizedResponse(
    //                 [],
    //                 __('You need to be logged in to join this quiz.')
    //             );
    //         }

    //         $existingAttempt = $this->checkExistingAttempt($quiz, $userId, $request);

    //         if ($existingAttempt) {
    //             return $existingAttempt;
    //         }

    //         $anonymousName = $request->input('anonymous_name');

    //         if (! $userId && ! $anonymousName) {
    //             return $this->badRequestResponse(
    //                 [],
    //                 __('Anonymous name is required for anonymous users.')
    //             );
    //         }

    //         if (! $userId) {
    //             $anonymousName = $this->generateUniqueAnonymousName($quiz, $anonymousName);
    //         }

    //         $attempt = $this->createNewAttempt($quiz, $userId, $request);

    //         DB::commit();

    //         return $this->createdResponse(
    //             [
    //                 'quiz' => $quiz,
    //                 'attempt' => $attempt,
    //             ],
    //             __('Quiz attempt started successfully.')
    //         );
    //     } catch (\Exception $e) {
    //         DB::rollBack();
    //         Log::error('Quiz join and attempt failed: ' . $e->getMessage());

    //         return $this->serverErrorResponse(
    //             [],
    //             __('Failed to join quiz. Please try again.')
    //         );
    //     }
    // }

    /**
     * Find a quiz session by the code on the host's screen ("Q611576"; the letter, case, spaces
     * and dashes are optional). The join page sent the digits only and this matched the whole
     * code, so every code was "not found"; it also opened a transaction it never committed.
     */
    public function joinByCode(JoinByCodeRequest $request): JsonResponse
    {
        try {
            $code = strtoupper(preg_replace('/[\s-]+/', '', (string) $request->join_code));
            // Stored without the letter; the model adds it for display.
            $digits = ltrim($code, 'Q');

            $quizSession = QuizSession::with('quiz')
                ->where('join_code', $digits)
                ->where('running_status', true)
                ->latest('id')
                ->first();

            if (! $quizSession || ! $quizSession->quiz) {
                return $this->notFoundResponse([], __("There's no quiz running with that code. Check the code on the host's screen."));
            }

            if ($quizSession->end_datetime && now()->greaterThan($quizSession->end_datetime)) {
                return $this->badRequestResponse([], __('This quiz session has already closed.'));
            }

            app(LiveSessionService::class)->ensurePublicChannelKey($quizSession);

            return $this->okResponse([
                'quiz' => $quizSession->quiz,
                'session' => $quizSession,
                'public_channel_key' => $quizSession->public_channel_key,
                'public_channel' => app(LiveSessionService::class)->publicChannel(LiveSessionService::MODULE_QUIZ, $quizSession->public_channel_key),
            ], __('Quiz retrieved successfully.'));
        } catch (\Exception $e) {
            Log::error('Quiz join by code failed: ' . $e->getMessage());

            return $this->serverErrorResponse([], __('Failed to join quiz. Please try again.'));
        }
    }
    // {
    //     DB::beginTransaction();

    //     try {
    //         $quiz = Quiz::where('join_code', $request->join_code)
    //             ->where('is_published', true)
    //             ->whereNull('deleted_at')
    //             ->first();

    //         if (! $quiz) {
    //             return $this->notFoundResponse([], __('Quiz not found or not available.'));
    //         }

    //         if (! $quiz->is_published || ! $quiz->open_datetime || ! $quiz->close_datetime) {
    //             return $this->forbiddenResponse([], __('This quiz is not currently live.'));
    //         }

    //         $validationResponse = $this->validateQuizAvailability($quiz);

    //         if ($validationResponse) {
    //             return $validationResponse;
    //         }

    //         $userId = Auth::guard('api')->id();

    //         if ($quiz->logged_in_users_only && ! $userId) {
    //             return $this->unauthorizedResponse(
    //                 [],
    //                 __('You need to be logged in to join this quiz.')
    //             );
    //         }

    //         $existingAttempt = $this->checkExistingAttempt($quiz, $userId, $request);

    //         if ($existingAttempt) {
    //             return $existingAttempt;
    //         }

    //         $anonymousName = $request->input('anonymous_name');

    //         if (! $userId && ! $anonymousName) {
    //             return $this->badRequestResponse(
    //                 [],
    //                 __('Anonymous name is required for anonymous users.')
    //             );
    //         }

    //         if (! $userId) {
    //             $anonymousName = $this->generateUniqueAnonymousName($quiz, $anonymousName);
    //         }

    //         $attempt = $this->createNewAttempt($quiz, $userId, $request);

    //         DB::commit();

    //         return $this->createdResponse(
    //             [
    //                 'quiz' => $quiz,
    //                 'attempt' => $attempt,
    //             ],
    //             __('Quiz attempt started successfully.')
    //         );
    //     } catch (\Exception $e) {
    //         DB::rollBack();
    //         Log::error('Quiz join by code failed: ' . $e->getMessage());

    //         return $this->serverErrorResponse(
    //             [],
    //             __('Failed to join quiz. Please try again.')
    //         );
    //     }
    // }

    /**
     * Update quiz attempt status by join link.
     */
    public function updateStatusByJoinLink(UpdateStatusRequest $request, string $joinLink): JsonResponse
    {
        DB::beginTransaction();

        try {
            $quizSession = $this->getActiveQuizSessionByJoinLink($joinLink);

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz session not found or not available.'));
            }

            $validationResponse = $this->validateQuizSessionAvailability($quizSession);

            if ($validationResponse) {
                return $validationResponse;
            }

            $userId = Auth::guard('api')->id();

            if (! $userId) {
                return $this->unauthorizedResponse(
                    [],
                    __('You need to be logged in to update the quiz status.')
                );
            }

            $attempt = QuizParticipant::where('quiz_id', $quizSession->quiz_id)
                ->where('quiz_session_id', $quizSession->id)
                ->where('user_id', $userId)
                ->where('status', 'In Progress')
                ->first();

            if (! $attempt) {
                return $this->notFoundResponse([], __('No active attempt found for this quiz.'));
            }

            if (strtolower($request->status) === 'completed') {
                $this->completeAttempt($attempt);
            }

            $attempt->status = $request->status;
            $attempt->save();

            $this->broadcastAttemptStatus($attempt, $request->status);

            DB::commit();

            return $this->okResponse(
                ['attempt' => $attempt],
                __('Quiz attempt status updated successfully.')
            );
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error updating quiz attempt status: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('Failed to update quiz attempt status. Please try again.')
            );
        }
    }

    /**
     * Get attempt result by attempt ID.
     */
    public function getAttemptResult(int $attemptId): JsonResponse
    {
        try {
            $attempt = QuizParticipant::with(['quiz', 'user', 'userQuizAnswers.question'])
                ->find($attemptId);

            if (! $attempt) {
                return $this->notFoundResponse([], __('Quiz attempt not found'));
            }

            if (strtolower($attempt->status) !== 'completed') {
                return $this->badRequestResponse(
                    [],
                    __('This quiz attempt is not completed yet')
                );
            }

            if (strtolower($attempt->status) === 'abandoned') {
                return $this->badRequestResponse(
                    [],
                    __('This quiz attempt was abandoned and cannot be retrieved')
                );
            }

            return $this->okResponse(
                ['attempt' => $attempt],
                __('Quiz attempt result retrieved successfully')
            );
        } catch (\Exception $e) {
            Log::error('Error getting attempt result: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quiz attempt result')
            );
        }
    }

    /**
     * Get quiz leaderboard.
     */
    public function getQuizLeaderboard(int $quizId, Request $request): JsonResponse
    {
        try {
            $quiz = Quiz::find($quizId);

            if (! $quiz) {
                return $this->notFoundResponse([], __('Quiz not found'));
            }

            $leaderboard = QuizParticipant::with(['quiz', 'user'])
                ->where('quiz_id', $quizId)
                ->orderByDesc('score')
                ->orderByRaw('EXTRACT(EPOCH FROM end_time - start_time) ASC')
                ->orderByRaw('EXTRACT(EPOCH FROM end_time - start_time) ASC')
                ->limit($request->input('limit', 10))
                ->get();

            if ($leaderboard->isEmpty()) {
                return $this->notFoundResponse([], __('No completed attempts found for this quiz'));
            }

            $leaderboard->each->makeHidden('quiz');

            return $this->okResponse(
                ['quiz' => $quiz, 'leaderboard' => $leaderboard],
                __('Quiz leaderboard retrieved successfully')
            );
        } catch (\Exception $e) {
            Log::error('Error getting quiz leaderboard: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quiz leaderboard')
            );
        }
    }

    /**
     * Get quiz session leaderboard.
     */
    public function getQuizSessionLeaderboard(int $quizSessionId, Request $request): JsonResponse
    {
        try {
            $quizSession = QuizSession::find($quizSessionId);

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz session not found'));
            }

            $leaderboard = QuizParticipant::with(['quiz', 'user', 'quizSession'])
                ->where('quiz_session_id', $quizSessionId)
                ->orderByDesc('score')
                ->orderByRaw('EXTRACT(EPOCH FROM end_time - start_time) ASC')
                ->orderByRaw('EXTRACT(EPOCH FROM end_time - start_time) ASC')
                ->limit($request->input('limit', 10))
                ->get();

            if ($leaderboard->isEmpty()) {
                return $this->notFoundResponse([], __('No completed attempts found for this quiz'));
            }

            $leaderboard->each->makeHidden('quiz');

            return $this->okResponse(
                ['quizSession' => $quizSession, 'leaderboard' => $leaderboard],
                __('Quiz leaderboard retrieved successfully')
            );
        } catch (\Exception $e) {
            Log::error('Error getting quiz leaderboard: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quiz leaderboard')
            );
        }
    }

    /**
     * Get quiz leaderboard session list by quiz ID.
     */
    public function getQuizLeaderboardSessionList(int $quizId, Request $request): JsonResponse
    {
        try {
            $quiz = Quiz::find($quizId);

            if (! $quiz) {
                return $this->notFoundResponse([], __('Quiz not found'));
            }

            $quizSessions = QuizSession::where('quiz_id', $quizId);

            // Apply filters if provided
            if ($request->has('is_host_live')) {
                $quizSessions->isHostLive($request->input('is_host_live'));
            }

            $quizSessions = $quizSessions->orderBy('created_at', 'desc')
                ->withCount('participants')
                // Sessions anyone joined ("> 1" hid every session with a single player).
                ->whereHas('participants')
                ->paginate($request->input('per_page', 10));

            return $this->okResponse(
                [
                    'quiz' => $quiz,
                    'quizSessions' => $quizSessions,
                ],
                __('Quiz sessions retrieved successfully')
            );

        } catch (\Exception $e) {
            Log::error('Error getting quiz sessions: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quiz sessions')
            );
        }
    }

    /**
     * Get quiz leaderboard by quiz session ID.
     */
    public function getQuizLeaderboardSessionDetails(int $sessionId, Request $request): JsonResponse
    {
        try {
            $quizSession = QuizSession::find($sessionId);

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz session not found'));
            }

            if (! $quizSession->quiz) {
                return $this->notFoundResponse([], __('Associated quiz not found'));
            }

            // Check if this quiz has any questions
            $questions = Question::where('quiz_id', $quizSession->quiz_id)
                ->exists();

            $rankingResults = null;
            $leaderboardData = null;

            if ($questions) {
                // Get all question answers for this quiz
                $questionAnswers = Question::where('quiz_id', $quizSession->quiz_id)
                    ->with(['userQuizAnswers.quizParticipant.user'])
                    ->get();

                $questionResults = [];
                $overallOptionScores = [];

                foreach ($questionAnswers as $questionAnswer) {
                    $answerResults = [];

                    // Format task results with option:score pairs
                    $formattedAnswerScores = [];
                    foreach ($answerResults as $optionId => $score) {
                        $formattedAnswerScores[] = "{$optionId}:{$score}";
                    }

                    $answerResults[] = [
                        'question_id' => $questionAnswer->id,
                        'question_name' => $questionAnswer->title,
                        'quiz_id' => $quizSession->quiz_id,
                        'option_scores' => $formattedAnswerScores,
                        'raw_scores' => $answerResults,
                    ];
                }

                // Format overall option scores
                $formattedOverallScores = [];
                foreach ($overallOptionScores as $optionId => $score) {
                    $formattedOverallScores[] = "{$optionId}:{$score}";
                }

                $rankingResults = [
                    'question_breakdown' => $questionResults,
                    'overall_scores' => $formattedOverallScores,
                    'raw_overall_scores' => $overallOptionScores,
                ];
            }

            // Always get the completion time leaderboard (for all participants)
            $leaderboardData = QuizParticipant::where('quiz_id', $quizSession->quiz_id)
                ->where('quiz_session_id', $sessionId)
                ->with(['user', 'userQuizAnswers'])
                ->orderByRaw('EXTRACT(EPOCH FROM end_time - start_time) ASC');

            if ($request->has('limit')) {
                $leaderboardData->limit($request->input('limit'));
            }

            $leaderboardData = $leaderboardData->groupBy('quiz_session_id', 'id')
                ->get();

            return $this->okResponse(
                [
                    'quiz' => $quizSession->quiz,
                    'quizSession' => $quizSession,
                    // 'ranking_results' => $rankingResults,
                    'leaderboard' => $leaderboardData,
                ],
                __('Quiz leaderboard retrieved successfully')
            );

        } catch (\Exception $e) {
            Log::error('Error getting quiz leaderboard: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quiz leaderboard')
            );
        }
    }

    /**
     * Get quiz session question answers.
     */
    public function getQuizSessionQuestionAnswers(int $sessionId, int $questionId, Request $request): JsonResponse
    {
        try {
            $quizSession = QuizSession::find($sessionId);

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz session not found'));
            }

            $question = Question::where('quiz_id', $quizSession->quiz_id)
                ->where('id', $questionId)
                ->first();

            if (! $question) {
                return $this->notFoundResponse([], __('Question not found in this quiz session'));
            }

            $answers = UserQuizAnswer::whereHas('quizParticipant', function ($q) use ($sessionId) {
                $q->where('quiz_session_id', $sessionId);
            })
                ->where('question_id', $questionId)
                ->with(['quizParticipant.user'])
                ->get();

            // Get correct answer index from question
            $correctAnswerIndex = $question->options['correct_answer'] ?? null;

            // Initialize variables for tracking fastest correct answer
            $fastestTime = null;
            $fastestParticipants = [];

            if ($correctAnswerIndex !== null) {
                // Filter correct answers only
                $correctAnswers = $answers->filter(function ($answer) use ($correctAnswerIndex) {
                    return isset($answer->answer_data['selected_option']) &&
                        $answer->answer_data['selected_option'] == $correctAnswerIndex;
                });

                if ($correctAnswers->isNotEmpty()) {
                    // Find the minimum time_taken_seconds among correct answers
                    $fastestTime = $correctAnswers->min('time_taken_seconds');

                    // Get all participants with the fastest time_taken_seconds
                    $fastestParticipants = $correctAnswers->filter(function ($answer) use ($fastestTime) {
                        return $answer->time_taken_seconds == $fastestTime;
                    })->map(function ($answer) {
                        return [
                            'participant_id' => $answer->quiz_participant_id,
                            'participant_name' => $answer->quizParticipant->anonymous_details['name'] ?? 'Anonymous',
                            'time_taken_seconds' => $answer->time_taken_seconds,
                            'selected_option' => $answer->answer_data['selected_option'] ?? null,
                            'answer_id' => $answer->id,
                            'start_time' => $answer->answer_data['start_time'] ?? null,
                            'end_time' => $answer->answer_data['end_time'] ?? null,
                            'start_time_now' => $answer->answer_data['start_time_now'] ?? null,
                            'end_time_now' => $answer->answer_data['end_time_now'] ?? null,
                        ];
                    })->values()->toArray();
                }
            }

            // Get the first fastest participant (if any) for backward compatibility
            $fastestCorrectAnswer = ! empty($fastestParticipants) ? $fastestParticipants[0] : null;

            // If we want to remove start_time from the main fastest_correct_answer object
            if ($fastestCorrectAnswer) {
                $fastestCorrectAnswerWithoutTimes = [
                    'participant_id' => $fastestCorrectAnswer['participant_id'],
                    'participant_name' => $fastestCorrectAnswer['participant_name'],
                    'time_taken_seconds' => $fastestCorrectAnswer['time_taken_seconds'],
                    'selected_option' => $fastestCorrectAnswer['selected_option'],
                    'answer_id' => $fastestCorrectAnswer['answer_id'],
                ];
            }

            return $this->okResponse(
                [
                    'quizSession' => $quizSession,
                    'question' => $question,
                    'answers' => $answers,
                    'correct_answer_index' => $correctAnswerIndex,
                    'fastest_correct_answer' => $fastestCorrectAnswerWithoutTimes ?? null,
                    'all_fastest_correct_participants' => $fastestParticipants,
                    'fastest_time' => $fastestTime,
                ],
                __('Question answers retrieved successfully')
            );

        } catch (\Exception $e) {
            Log::error('Error getting question answers: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the question answers')
            );
        }
    }

    /**
     * Get quiz session answered questions.
     */
    public function getQuizSessionAnsweredQuestions(int $sessionId, Request $request): JsonResponse
    {
        try {
            $quizSession = QuizSession::find($sessionId);

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz session not found'));
            }

            $answeredQuestions = UserQuizAnswer::whereHas('quizParticipant', function ($q) use ($sessionId) {
                $q->where('quiz_session_id', $sessionId);
            })
                ->with(['question', 'quizParticipant.user'])
                ->get();

            // Group answers by participant and calculate scores
            $participantScores = [];
            $questionsByParticipant = [];

            foreach ($answeredQuestions as $answer) {
                $participantId = $answer->quiz_participant_id;
                $question = $answer->question;
                $selectedOption = $answer->answer_data['selected_option'] ?? null;
                $correctAnswer = $question->options['correct_answer'] ?? null;
                $questionPoints = $question->points ?? 0;
                $participant = $answer->quizParticipant;
                $timeTaken = $answer->time_taken_seconds ?? 0;

                // Initialize participant if not exists
                if (! isset($participantScores[$participantId])) {
                    $participantScores[$participantId] = [
                        'participant_id' => $participantId,
                        'user' => $participant->user,
                        'anonymous_details' => $participant->anonymous_details,
                        'is_anonymous' => $participant->is_anonymous,
                        'total_score' => 0,
                        'total_time_taken' => 0,
                        'correct_answers' => 0,
                        'total_questions_answered' => 0,
                        'answered_questions' => [],
                    ];
                }

                // Check if answer is correct
                $isCorrect = $this->isAnswerCorrect(
                    $question->question_type,
                    $selectedOption,
                    $correctAnswer,
                    $question->options['choices'] ?? []
                );

                // Calculate points for this question
                $pointsEarned = $isCorrect ? $questionPoints : 0;

                // Add question details to participant
                $questionDetails = [
                    'question_id' => $question->id,
                    'question_text' => $question->question_text,
                    'question_type' => $question->question_type,
                    'question_points' => $questionPoints,
                    'selected_option' => $selectedOption,
                    'correct_answer' => $correctAnswer,
                    'is_correct' => $isCorrect,
                    'points_earned' => $pointsEarned,
                    'answer_id' => $answer->id,
                    'time_taken_seconds' => $timeTaken,
                    'answered_at' => $answer->created_at,
                ];

                $participantScores[$participantId]['answered_questions'][] = $questionDetails;
                $participantScores[$participantId]['total_score'] += $pointsEarned;
                $participantScores[$participantId]['total_time_taken'] += $timeTaken;
                $participantScores[$participantId]['total_questions_answered']++;

                if ($isCorrect) {
                    $participantScores[$participantId]['correct_answers']++;
                }
            }

            // Calculate accuracy for each participant
            foreach ($participantScores as &$participant) {
                $participant['accuracy_percentage'] = $participant['total_questions_answered'] > 0
                    ? round(($participant['correct_answers'] / $participant['total_questions_answered']) * 100, 2)
                    : 0;
            }

            // Sort participants based on quiz mode
            $participantScores = $this->sortParticipantsByMode(
                $participantScores,
                $quizSession->quiz_mode
            );

            return $this->okResponse(
                [
                    'quizSession' => $quizSession,
                    'participantScores' => array_values($participantScores),
                    'sorting_mode' => $quizSession->quiz_mode ?? 'default',
                    'summary' => [
                        'total_participants' => count($participantScores),
                        'highest_score' => ! empty($participantScores) ? max(array_column($participantScores, 'total_score')) : 0,
                        'average_score' => ! empty($participantScores) ? round(array_sum(array_column($participantScores, 'total_score')) / count($participantScores), 2) : 0,
                        'average_time_taken' => ! empty($participantScores) ? round(array_sum(array_column($participantScores, 'total_time_taken')) / count($participantScores), 2) : 0,
                    ],
                    // Still include all answered questions for backward compatibility
                    'answeredQuestions' => $answeredQuestions,
                ],
                __('Answered questions retrieved successfully')
            );

        } catch (\Exception $e) {
            Log::error('Error getting answered questions: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the answered questions')
            );
        }
    }

    /**
     * Export quiz sessions to Excel
     */
    public function downloadSessionLeaderboardExcel(int $quizId, Request $request): BinaryFileResponse|JsonResponse
    {
        try {
            $quiz = Quiz::find($quizId);

            if (! $quiz) {
                return $this->notFoundResponse([], __('Quiz not found'));
            }

            // Get filtered data based on request parameters
            $quizSessions = $this->getFilteredSessions($quizId, $request);

            return Excel::download(new QuizSessionsExport($quizSessions, $quiz), "quiz_{$quizId}_sessions.xlsx");

        } catch (\Exception $e) {
            Log::error('Error exporting quiz sessions to Excel: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quiz leaderboard')
            );
        }
    }

    /**
     * Export quiz sessions to CSV
     */
    public function downloadSessionLeaderboardCsv(int $quizId, Request $request): JsonResponse|BinaryFileResponse
    {
        try {
            $quiz = Quiz::find($quizId);

            if (! $quiz) {
                return $this->notFoundResponse([], __('Quiz not found'));
            }

            // Get filtered data based on request parameters
            $quizSessions = $this->getFilteredSessions($quizId, $request);

            return Excel::download(new QuizSessionsExport($quizSessions, $quiz), "quiz_{$quizId}_sessions.csv", \Maatwebsite\Excel\Excel::CSV, [
                'Content-Type' => 'text/csv',
            ]);

        } catch (\Exception $e) {
            Log::error('Error exporting quiz sessions to CSV: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quiz leaderboard')
            );
        }
    }

    /**
     * Export quiz session attempts to Excel
     */
    public function downloadSessionAttemptsExcel(int $sessionId): BinaryFileResponse|JsonResponse
    {
        try {
            $quizSession = QuizSession::with([
                'participants.user', // Make sure this includes the basic participant info
                'participants.userQuizAnswers.question',
            ])->find($sessionId);

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz session not found'));
            }

            // Add unique tasks to the session object
            $uniqueTasks = $quizSession->participants
                ->flatMap(function ($participant) {
                    return $participant->userQuizAnswers;
                })
                ->pluck('question')
                ->unique('id')
                ->values();

            return Excel::download(new QuizSessionAttemptsExport($quizSession, $uniqueTasks), "quiz_{$quizSession->quiz_id}_session_{$sessionId}_attempts.xlsx");

        } catch (\Exception $e) {
            Log::error('Error exporting quiz session attempts to Excel: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quiz session attempts')
            );
        }
    }

    /**
     * Export quiz session attempts to CSV
     */
    public function downloadSessionAttemptsCsv(int $sessionId): BinaryFileResponse|JsonResponse
    {
        try {
            $quizSession = QuizSession::with([
                'participants.user', // Make sure this includes the basic participant info
                'participants.userQuizAnswers.question',
            ])->find($sessionId);

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz session not found'));
            }

            // Add unique tasks to the session object
            $uniqueQuestions = $quizSession->participants
                ->flatMap(function ($participant) {
                    return $participant->userQuizAnswers;
                })
                ->pluck('question')
                ->unique('id')
                ->values();

            return Excel::download(new QuizSessionAttemptsExport($quizSession, $uniqueQuestions), "quiz_{$quizSession->quiz_id}_session_{$sessionId}_attempts.csv", \Maatwebsite\Excel\Excel::CSV, [
                'Content-Type' => 'text/csv',
            ]);

        } catch (\Exception $e) {
            Log::error('Error exporting quiz session attempts to CSV: ' . $e->getMessage());

            return $this->serverErrorResponse(
                [],
                __('An error occurred while retrieving the quiz session attempts')
            );
        }
    }

    /**
     * Export quiz session attempts to Excel Grouped
     */
    public function downloadSessionAttemptsGroupedExcel(int $sessionId): BinaryFileResponse|JsonResponse
    {
        try {
            $quizSession = QuizSession::with([
                'participants.user', // Make sure this includes the basic participant info
                'participants.userQuizAnswers.question',
            ])->find($sessionId);

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz session not found'));
            }

            // Add unique tasks to the session object
            $uniqueQuestions = $quizSession->participants
                ->flatMap(function ($participant) {
                    return $participant->userQuizAnswers;
                })
                ->pluck('question')
                ->unique('id')
                ->values();

            return Excel::download(new QuizSessionAttemptExportGrouped($quizSession, $uniqueQuestions), "quest_{$quizSession->quest_id}_session_{$sessionId}_attempts.xlsx");

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
            $quizSession = QuizSession::with([
                'participants.user', // Make sure this includes the basic participant info
                'participants.userQuizAnswers.question',
            ])->find($sessionId);

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz session not found'));
            }

            // Add unique tasks to the session object
            $uniqueTasks = $quizSession->participants
                ->flatMap(function ($participant) {
                    return $participant->taskCompletions;
                })
                ->pluck('question')
                ->unique('id')
                ->values();

            return Excel::download(new QuizSessionAttemptExportGrouped($quizSession, $uniqueTasks), "quest_{$quizSession->quest_id}_session_{$sessionId}_attempts.csv", \Maatwebsite\Excel\Excel::CSV, [
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
            $quizSession = QuizSession::with([
                'participants.user', // Make sure this includes the basic participant info
                'participants.userQuizAnswers.question',
            ])->find($sessionId);

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz session not found'));
            }

            // Add unique tasks to the session object
            $uniqueTasks = $quizSession->participants
                ->flatMap(function ($participant) {
                    return $participant->taskCompletions;
                })
                ->pluck('question')
                ->unique('id')
                ->values();

            return Excel::download(new QuizSessionAttemptExportVertical($quizSession, $uniqueTasks), "quest_{$quizSession->quest_id}_session_{$sessionId}_attempts.xlsx");

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
            $quizSession = QuizSession::with([
                'participants.user', // Make sure this includes the basic participant info
                'participants.userQuizAnswers.question',
            ])->find($sessionId);

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz session not found'));
            }

            // Add unique tasks to the session object
            $uniqueTasks = $quizSession->participants
                ->flatMap(function ($participant) {
                    return $participant->taskCompletions;
                })
                ->pluck('question')
                ->unique('id')
                ->values();

            return Excel::download(new QuizSessionAttemptExportVertical($quizSession, $uniqueTasks), "quest_{$quizSession->quest_id}_session_{$sessionId}_attempts.csv", \Maatwebsite\Excel\Excel::CSV, [
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
     * Get filtered sessions based on request parameters
     */
    private function getFilteredSessions(int $quizId, Request $request)
    {
        $query = QuizSession::where('quiz_id', $quizId)
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
     * Sort participants based on quiz mode
     */
    private function sortParticipantsByMode(array $participantScores, ?string $quizMode): array
    {
        // Convert to array for sorting
        $participantScores = array_values($participantScores);

        switch ($quizMode) {
            case 'game':
                // For game mode: Sort by highest score, then by lowest time
                usort($participantScores, function ($a, $b) {
                    // First compare by total score (descending)
                    if ($b['total_score'] !== $a['total_score']) {
                        return $b['total_score'] <=> $a['total_score'];
                    }

                    // If scores are equal, compare by total time taken (ascending)
                    return $a['total_time_taken'] <=> $b['total_time_taken'];
                });
                break;

            case 'quiz':
                // For quiz mode: Sort by highest score only
                usort($participantScores, function ($a, $b) {
                    return $b['total_score'] <=> $a['total_score'];
                });
                break;

            default:
                // Default: Sort by highest score only
                usort($participantScores, function ($a, $b) {
                    return $b['total_score'] <=> $a['total_score'];
                });
                break;
        }

        return $participantScores;
    }

    /**
     * Check if the answer is correct based on question type
     */
    private function isAnswerCorrect(string $questionType, $selectedOption, $correctAnswer, array $choices = []): bool
    {
        if (is_null($selectedOption) || is_null($correctAnswer)) {
            return false;
        }

        switch ($questionType) {
            case 'quiz_single_choice':
            case 'true_false_choice':
            case 'fill_in_the_blanks_choice':
                // For single choice, true/false, fill in blanks
                return $selectedOption == $correctAnswer;

            case 'quiz_multiple_choice':
            case 'fill_in_the_blanks_multiple_choice':
                // The player sends "0,2"; the same all-or-nothing rule as the score.
                return app(LegacyQuizScorer::class)->sameIndexSet($selectedOption, $correctAnswer);

            case 'sort_answer_choice':
            case 'sort_answer':
            case 'short_answer_choice':
            case 'short_answer':
                // The player types the answer; the same rule as the score.
                return app(LegacyQuizScorer::class)->shortAnswerMatches($selectedOption, ['choices' => $choices, 'correct_answer' => $correctAnswer]);

            default:
                return false;
        }
    }

    /**
     * Complete the attempt by calculating score.
     */
    protected function completeAttempt(QuizParticipant $attempt): void
    {
        app(LegacyQuizScorer::class)->complete($attempt);
    }

    /**
     * Get active quiz by join link.
     */
    protected function getActiveQuizByJoinLink(string $joinLink): ?Quiz
    {
        return Quiz::where('join_link', $joinLink)
            ->where('is_published', true)
            ->whereNull('deleted_at')
            ->first();
    }

    /**
     * Get active quiz by join link.
     */
    protected function getActiveQuizSessionByJoinLink(string $joinLink): ?QuizSession
    {
        return QuizSession::where('join_link', $joinLink)->first();
    }

    /**
     * Validate quiz availability.
     */
    protected function validateQuizAvailability(Quiz $quiz): ?JsonResponse
    {
        $now = now();

        if ($now < $quiz->open_datetime) {
            return $this->forbiddenResponse([], __('This quiz is not open yet.'));
        }

        if ($now > $quiz->close_datetime) {
            return $this->forbiddenResponse([], __('This quiz has already closed.'));
        }

        return null;
    }

    /**
     * Validate quiz availability.
     */
    protected function validateQuizSessionAvailability(QuizSession $quizSession): ?JsonResponse
    {
        $now = now();

        if ($now < $quizSession->start_datetime) {
            return $this->forbiddenResponse([], __('This quiz is not open yet.'));
        }

        if ($now > $quizSession->end_datetime) {
            return $this->forbiddenResponse([], __('This quiz has already closed.'));
        }

        return null;
    }

    /**
     * Check for existing attempt.
     */
    protected function checkExistingAttempt(
        Quiz $quiz,
        ?int $userId,
        $request
    ): ?JsonResponse {
        if ($userId) {
            $existingAttempt = QuizParticipant::where('quiz_id', $quiz->id)
                ->where('user_id', $userId)
                ->where('status', 'In Progress')
                ->first();

            if ($existingAttempt) {
                return $this->okResponse([
                    'quiz' => $quiz,
                    'attempt' => $existingAttempt,
                ], __('You already have an active attempt for this quiz.'));
            }
        }

        return null;
    }

    /**
     * Check for existing attempt.
     */
    protected function checkExistingAttemptQuiz(
        Quiz $quiz,
        QuizSession $quizSession,
        ?int $userId,
        $request
    ): ?JsonResponse {
        if ($userId) {
            $existingAttempt = QuizParticipant::where('quiz_id', $quiz->id)
                ->where('quiz_session_id', $quizSession->id)
                ->where('user_id', $userId)
                ->where('status', 'In Progress')
                ->first();

            if ($existingAttempt) {
                return $this->okResponse([
                    'quiz' => $quiz,
                    'attempt' => $existingAttempt,
                ], __('You already have an active attempt for this quiz.'));
            }
        }

        return null;
    }

    /**
     * Generate unique anonymous name.
     */
    protected function generateUniqueAnonymousName(Quiz $quiz, string $anonymousName): string
    {
        $baseName = $anonymousName;
        $counter = 1;

        while (QuizParticipant::where('quiz_id', $quiz->id)
            ->where('is_anonymous', true)
            ->whereJsonContains('anonymous_details->name', $anonymousName)
            ->exists()) {
            $anonymousName = $baseName . '_' . $counter;
            $counter++;
        }

        return $anonymousName;
    }

    /**
     * Create new quiz attempt.
     */
    protected function createNewAttempt(
        Quiz $quiz,
        ?int $userId,
        $request
    ): QuizParticipant {
        return QuizParticipant::create([
            'quiz_id' => $quiz->id,
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
     * Create new quiz attempt.
     */
    protected function createNewAttemptQuiz(
        Quiz $quiz,
        QuizSession $quizSession,
        ?int $userId,
        $request
    ): QuizParticipant {
        return QuizParticipant::create([
            'quiz_id' => $quiz->id,
            'quiz_session_id' => $quizSession->id,
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

    private function broadcastAttemptStatus(QuizParticipant $attempt, string $status): void
    {
        $session = $attempt->quizSession;

        if (! $session) {
            return;
        }

        $payload = [
            'session_id' => $session->id,
            'participant_id' => $attempt->id,
            'status' => $attempt->status,
            'score' => $attempt->score,
            'ended_at' => optional($attempt->end_time)->toISOString(),
        ];

        app(LiveSessionService::class)->broadcastHost(
            LiveSessionService::MODULE_QUIZ,
            $session,
            'participant.status.updated',
            $payload,
        );

        if (in_array(strtolower($status), ['completed', 'abandoned'], true)) {
            app(ParticipantTokenService::class)->revokeParticipant($attempt);
        }

        if (strtolower($status) === 'completed') {
            app(LiveSessionService::class)->broadcastParticipantCompleted(
                LiveSessionService::MODULE_QUIZ,
                $session,
                $attempt,
                $payload,
            );
        }
    }
}
