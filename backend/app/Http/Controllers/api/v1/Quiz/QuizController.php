<?php

namespace App\Http\Controllers\api\v1\Quiz;

use App\Http\Controllers\api\v1\ApiBaseController;
use App\Http\Requests\Quiz\HostLater\HostLaterStoreRequest;
use App\Http\Requests\Quiz\HostLater\HostLaterUpdateRequest;
use App\Http\Requests\Quiz\HostLater\StatusLaterRequest;
use App\Http\Requests\Quiz\HostLater\TimeHostLaterRequest;
use App\Http\Requests\Quiz\HostLive\EndLiveRequest;
use App\Http\Requests\Quiz\HostLive\HostLiveStoreRequest;
use App\Http\Requests\Quiz\HostLive\HostLiveUpdateRequest;
use App\Http\Requests\Quiz\HostLive\StatusLiveRequest;
use App\Http\Requests\Quiz\Quiz\StoreRequest;
use App\Http\Requests\Quiz\Quiz\UpdateRequest;
use App\Models\Quiz\Quiz;
use App\Models\Quiz\QuizParticipant;
use App\Models\Quiz\QuizSession;
use App\Models\Quiz\BankQuestion as QuizBankQuestion;
use App\Services\Live\LiveSessionService;
use App\Services\Live\ParticipantTokenService;
use App\Services\Quiz\LegacyQuizScorer;
use Exception;
use Illuminate\Support\Facades\Auth;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class QuizController extends ApiBaseController
{
    protected function ensureQuizOwner(Quiz $quiz): ?JsonResponse
    {
        if ($quiz->user_id !== auth()->id()) {
            return $this->forbiddenResponse([], __('You are not allowed to access this quiz.'));
        }

        return null;
    }

    protected function ensureQuizSessionOwner(QuizSession $quizSession): ?JsonResponse
    {
        $quiz = $quizSession->quiz;

        if (! $quiz || $quiz->user_id !== auth()->id()) {
            return $this->forbiddenResponse([], __('You are not allowed to access this quiz.'));
        }

        return null;
    }

    /**
     * Display a listing of the quizes.
     */
    public function index(Request $request): JsonResponse
    {
        $quizes = Quiz::with(['user.institution', 'deletedBy'])
            ->withCount(['questions' => fn ($query) => $query->authored()])
            ->withSum('questions as total_points', 'points');

        // Apply filters if any
        if ($request->has('is_published')) {
            $quizes->filterByIsPublished($request->input('is_published'));
        }

        if ($request->has('search')) {
            $quizes->search($request->input('search'));
        }

        if ($request->has('user_id')) {
            $quizes->filterByUserId($request->input('user_id'));
        }

        if ($request->has('category_id')) {
            $quizes->filterByCategoryId($request->input('category_id'));
        }

        if ($request->has('open_datetime')) {
            $quizes->filterByOpenDatetime($request->input('open_datetime'));
        }

        if ($request->has('close_datetime')) {
            $quizes->filterByCloseDatetime($request->input('close_datetime'));
        }

        if ($request->has('quiztime_mode')) {
            $quizes->filterByQuiztimeMode($request->boolean('quiztime_mode'));
        }

        if ($request->has('duration')) {
            $quizes->filterByDuration($request->input('duration'));
        }

        if ($request->has('logged_in_users_only')) {
            $quizes->filterByLoggedInUsersOnly($request->boolean('logged_in_users_only'));
        }

        if ($request->has('safe_browser_mode')) {
            $quizes->filterBySafeBrowserMode($request->boolean('safe_browser_mode'));
        }

        if ($request->has('quiz_mode')) {
            $quizes->filterByQuizMode($request->input('quiz_mode'));
        }

        if ($request->has('timezone')) {
            $quizes->filterByTimezone($request->input('timezone'));
        }

        if ($request->has('deleted_at')) {
            $quizes->filterByDeletedAt($request->input('deleted_at'));
        } else {
            // By default, only show non-deleted quizes
            $quizes->notSoftDeleted();
        }

        if ($request->has('deleted_by')) {
            $quizes->filterByDeletedBy($request->input('deleted_by'));
        }

        if ($request->has('institution_id')) {
            $quizes->filterByInstitutionId($request->input('institution_id'));
        }

        if ($request->has('order_by_id')) {
            $quizes->orderById($request->input('order_by_id'));
        }

        if ($request->has('order_by_created_at')) {
            $quizes->orderByCreatedAt($request->input('order_by_created_at'));
        }

        // Determine list type (default: 'my-quizzes')
        $listType = $request->input('list_type', 'my-quizzes');

        if ($listType === 'discover') {
            $quizes->forDiscover();
        } else {
            $quizes->forAuthenticatedUser(auth()->id());
        }

        // You might want to add pagination here
        $quizes = $quizes->paginate($request->input('per_page', 10));

        // Return the response
        return $this->okResponse(['quizes' => $quizes], __('Quizes fetched successfully.'));
    }

    /**
     * Store a newly created quiz in storage.
     */
    public function store(StoreRequest $request): JsonResponse
    {
        DB::beginTransaction();

        try {
            // Create a new quiz
            $quiz = Quiz::create($request->validated());
            // Commit the transaction
            DB::commit();

            // Return the created quiz
            return $this->createdResponse(['quiz' => $quiz], __('Quiz created successfully.'));
        } catch (\Exception $e) {
            // Rollback the transaction on error
            DB::rollBack();
            // Log the error for debugging
            Log::error('Quiz creation failed: ' . $e->getMessage());

            // Return a server error response
            return $this->serverErrorResponse([], __('Quiz creation failed. Please try again later.'));
        }
    }

    /**
     * Display the specified quiz.
     */
    public function show($id): JsonResponse
    {
        // Find the quiz by ID
        $quiz = Quiz::with(['questions', 'user.institution', 'deletedBy'])->find($id);

        // Check if the quiz exists
        if (! $quiz) {
            return $this->notFoundResponse([], __('Quiz not found.'));
        }

        if ($response = $this->ensureQuizOwner($quiz)) {
            return $response;
        }

        // Enrich each question with is_my_qu_bank flag
        $questions = $quiz->questions ?? collect();
        if ($questions->isNotEmpty()) {
            $userId = auth()->id();

            $types = $questions->pluck('question_type')->filter()->unique()->values();

            // Fetch candidate bank questions once and compare in PHP for accuracy
            $bankQuestions = QuizBankQuestion::query()
                ->where('owner_id', $userId)
                ->whereIn('question_type', $types)
                ->get(['id', 'question_text', 'question_type']);

            $bankIndex = [];
            foreach ($bankQuestions as $bq) {
                $key = mb_strtolower(trim($bq->question_type)) . '|' . mb_strtolower(trim((string) $bq->question_text));
                $bankIndex[$key] = true;
            }

            foreach ($questions as $q) {
                $qKey = mb_strtolower(trim((string) $q->question_type)) . '|' . mb_strtolower(trim((string) $q->question_text));
                $q->setAttribute('is_my_qu_bank', isset($bankIndex[$qKey]));
            }
        }

        // Return the quiz
        return $this->okResponse(['quiz' => $quiz], __('Quiz fetched successfully.'));
    }

    /**
     * Display the specified quiz with session details.
     */
    public function showWithSessions($sessionId): JsonResponse
    {
        // Find the quiz session by ID
        $session = QuizSession::with(['quiz.questions', 'quiz.user.institution', 'quiz.deletedBy'])->find($sessionId);

        // Check if the session exists
        if (! $session) {
            return $this->notFoundResponse([], __('Quiz session not found.'));
        }

        if ($response = $this->ensureQuizSessionOwner($session)) {
            return $response;
        }

        // Return the quiz with session details
        return $this->okResponse(['quiz' => $session->quiz, 'session' => $session, 'questions' => $session->quiz->questions], __('Quiz with session fetched successfully.'));
    }

    /**
     * Update the specified quiz in storage.
     */
    public function update(UpdateRequest $request, $id): JsonResponse
    {
        DB::beginTransaction();

        try {
            // Find the quiz by ID
            $quiz = Quiz::find($id);

            // Check if the quiz exists
            if (! $quiz) {
                return $this->notFoundResponse([], __('Quiz not found.'));
            }

            if ($response = $this->ensureQuizOwner($quiz)) {
                return $response;
            }

            // Update the quiz
            $quiz->update($request->validated());
            // Commit the transaction
            DB::commit();

            // Return the updated quiz
            return $this->okResponse(['quiz' => $quiz], __('Quiz updated successfully.'));
        } catch (\Exception $e) {
            // Rollback the transaction on error
            DB::rollBack();
            // Log the error for debugging
            Log::error('Quiz update failed: ' . $e->getMessage());

            // Return a server error response
            return $this->serverErrorResponse([], __('Quiz update failed. Please try again later.'));
        }
    }

    /**
     * Remove the specified quiz from storage.
     */
    public function destroy($id): JsonResponse
    {
        try {
            // Find the quiz by ID
            $quiz = Quiz::find($id);

            // Check if the quiz exists
            if (! $quiz) {
                return $this->notFoundResponse([], __('Quiz not found.'));
            }

            if ($response = $this->ensureQuizOwner($quiz)) {
                return $response;
            }

            // Soft delete the quiz
            $quiz->delete();

            // Return a success response
            return $this->okResponse([], __('Quiz deleted successfully.'));
        } catch (\Exception $e) {
            Log::error('Quiz deletion failed: ' . $e->getMessage());

            // Return error response if an exception occurs
            return $this->serverErrorResponse([], __('An error occurred while deleting the quiz.'));
        }
    }

    public function checkQuizById($id): JsonResponse
    {
        return $this->checkQuizSessionByField('id', $id);
    }

    public function checkQuizByJoinLink($joinLink): JsonResponse
    {
        return $this->checkQuizSessionByField('join_link', $joinLink);
    }

    public function checkQuizByJoinCode($joinCode): JsonResponse
    {
        return $this->checkQuizSessionByField('join_code', $joinCode);
    }

    protected function checkQuizByField($field, $value): JsonResponse
    {
        $quiz = Quiz::where($field, $value)->select(['id', 'title', 'open_datetime', 'close_datetime', 'is_published'])
            ->first();

        if (! $quiz) {
            return $this->notFoundResponse([], __('Quiz not found.'));
        }

        if (! $quiz->is_published || ! $quiz->open_datetime || ! $quiz->close_datetime) {
            return $this->forbiddenResponse([], __('This quiz is not currently live.'));
        }

        $now = now();

        if ($now->lt($quiz->open_datetime)) {
            return $this->forbiddenResponse(['open' => $quiz->open_datetime], __('The quiz has not started yet.'));
        }

        if ($now->gt($quiz->close_datetime)) {
            return $this->forbiddenResponse(['close' => $quiz->close_datetime], __('The quiz has already ended.'));
        }

        return $this->okResponse(['quiz' => $quiz], __('Quiz is currently live.'));
    }

    protected function checkQuizSessionByField($field, $value): JsonResponse
    {
        $quizSession = QuizSession::where($field, $value)->with(['quiz' => function ($query) {
            $query->select(['id', 'title', 'open_datetime', 'close_datetime', 'is_published']);
        }])->first();

        if (! $quizSession || ! $quizSession->quiz) {
            return $this->notFoundResponse([], __('Quiz Session not found.'));
        }

        if (! $quizSession->start_datetime || ! $quizSession->end_datetime) {
            return $this->forbiddenResponse([], __('This quiz is not currently live.'));
        }

        $now = now();

        if ($now->lt($quizSession->start_datetime)) {
            return $this->forbiddenResponse(['open' => $quizSession->start_datetime], __('The quiz session has not started yet.'));
        }

        if ($now->gt($quizSession->end_datetime)) {
            return $this->forbiddenResponse(['close' => $quizSession->end_datetime], __('The quiz session has already ended.'));
        }

        return $this->okResponse(['quiz' => $quizSession->quiz], __('Quiz session is currently live.'));
    }

    /**
     * Host a live quiz session.
     */
    public function hostLive(HostLiveStoreRequest $request, $id): JsonResponse
    {
        try {
            $validatedData = $request->validated();
            $quiz = Quiz::find($id);

            if (! $quiz) {
                return $this->notFoundResponse([], __('Quiz not found'));
            }

            if ($response = $this->ensureQuizOwner($quiz)) {
                return $response;
            }

            $quizSession = QuizSession::where('quiz_id', $quiz->id)
                ->isHostLive(true)
                ->where('running_status', true)
                ->latest()
                ->first();
            $liveSessions = app(LiveSessionService::class);

            if (! $quizSession) {
                $quizSession = QuizSession::create([
                    'quiz_id' => $quiz->id,
                    'title' => $validatedData['title'],
                    'running_status' => true,
                    'current_question_id' => null,
                    'timer_state' => null,
                    'session_id' => generate_quiz_session_id($quiz->id, $validatedData['start_datetime']),
                    'start_datetime' => $validatedData['start_datetime'],
                    'end_datetime' => $validatedData['end_datetime'],
                    'timezone' => $quiz->timezone ?? $validatedData['timezone'] ?? config('app.timezone', 'UTC'),
                    'is_host_live' => $validatedData['is_host_live'],
                    'quiztime_mode' => $validatedData['quiztime_mode'] ?? null,
                    'quiz_mode' => $validatedData['quiz_mode'] ?? null,
                ]);

                $quizSession->update([
                    'join_link' => generate_quiz_join_link(),
                    'join_code' => generate_quiz_join_code(),
                ]);
            }

            $liveSessions->ensurePublicChannelKey($quizSession);

            $payload = $liveSessions->state(LiveSessionService::MODULE_QUIZ, $quizSession);

            $liveSessions->broadcastPublic(LiveSessionService::MODULE_QUIZ, $quizSession, 'session.started', $payload);
            $liveSessions->broadcastHost(LiveSessionService::MODULE_QUIZ, $quizSession, 'session.started', $payload);

            return $this->okResponse(['quiz' => $quiz, 'quizSession' => $quizSession], __('Quiz session started successfully.'));
        } catch (Exception $e) {
            Log::error('Error hosting quiz session: ' . $e->getMessage(), [
                'id' => $id,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse([], __('Failed to host quiz session. Please try again later.'));
        }
    }

    /**
     * Update an existing live quiz session.
     */
    public function updateHostLive(HostLiveUpdateRequest $request, $id): JsonResponse
    {
        $validatedData = $request->validated();
        $quizSession = QuizSession::with('quiz')->find($id);

        if (! $quizSession) {
            return $this->notFoundResponse([], __('Quiz Session not found'));
        }

        if ($response = $this->ensureQuizSessionOwner($quizSession)) {
            return $response;
        }

        // Update the existing session
        $quizSession->update([
            'title' => $validatedData['title'] ?? $quizSession->title,
            'quiztime_mode' => $validatedData['quiztime_mode'] ?? $quizSession->quiztime_mode,
            'quiz_mode' => $validatedData['quiz_mode'] ?? $quizSession->quiz_mode,
        ]);

        return $this->okResponse(['quizSession' => $quizSession], __('Quiz session updated successfully.'));
    }

    /**
     * End a live quiz session.
     */
    public function endLive(EndLiveRequest $request, $id): JsonResponse
    {
        try {
            $quizSession = QuizSession::with('quiz')->find($id);

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz Session not found'));
            }

            if ($response = $this->ensureQuizSessionOwner($quizSession)) {
                return $response;
            }

            $endedAt = now();

            // The server owns the end time so frontend clock/validation drift cannot block ending.
            $quizSession->update([
                'end_datetime' => $endedAt,
                'running_status' => false,
                'join_link' => null,
                'join_code' => null,
            ]);

            // Score every attempt still in progress. The players' own "completed" call comes
            // after their tokens are revoked below, so it was refused and live scores stayed 0.
            $scorer = app(LegacyQuizScorer::class);
            QuizParticipant::where('quiz_session_id', $quizSession->id)
                ->where('status', 'In Progress')
                ->with('userQuizAnswers.question')
                ->get()
                ->each(function (QuizParticipant $participant) use ($scorer) {
                    $scorer->complete($participant);
                    $participant->status = 'Completed';
                    $participant->save();
                });

            app(ParticipantTokenService::class)->revokeForSession(LiveSessionService::MODULE_QUIZ, $quizSession->id);

            $liveSessions = app(LiveSessionService::class);
            $payload = $liveSessions->state(LiveSessionService::MODULE_QUIZ, $quizSession->refresh());
            $liveSessions->broadcastPublic(LiveSessionService::MODULE_QUIZ, $quizSession, 'session.ended', $payload);
            $liveSessions->broadcastHost(LiveSessionService::MODULE_QUIZ, $quizSession, 'session.ended', $payload);

            return $this->okResponse(['quizSession' => $quizSession], __('Quiz session ended successfully.'));
        } catch (Exception $e) {
            Log::error('Error ending quiz session: ' . $e->getMessage(), [
                'id' => $id,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse([], __('Failed to end quiz session. Please try again later.'));
        }
    }

    /**
     * Change the status of a live quiz session.
     */
    public function statusLive(StatusLiveRequest $request, $id): JsonResponse
    {
        $validatedData = $request->validated();
        $quizSession = QuizSession::with('quiz')->find($id);

        if (! $quizSession) {
            return $this->notFoundResponse([], __('Quiz Session not found'));
        }

        if ($response = $this->ensureQuizSessionOwner($quizSession)) {
            return $response;
        }

        // Update the status of the existing session
        $quizSession->update([
            'running_status' => $validatedData['running_status'],
        ]);

        $eventName = $validatedData['running_status'] ? 'session.resumed' : 'session.paused';
        app(LiveSessionService::class)->broadcastPublic(LiveSessionService::MODULE_QUIZ, $quizSession, $eventName, [
            'session_id' => $quizSession->id,
            'running_status' => (bool) $validatedData['running_status'],
        ]);
        app(LiveSessionService::class)->broadcastHost(LiveSessionService::MODULE_QUIZ, $quizSession, $eventName, [
            'session_id' => $quizSession->id,
            'running_status' => (bool) $validatedData['running_status'],
        ]);

        return $this->okResponse(['quizSession' => $quizSession], __('Quiz session status updated successfully.'));
    }

    /**
     * Check if a user is currently hosting a live quiz session.
     */
    public function checkHostLive($userId): JsonResponse
    {
        try {
            $quizSession = QuizSession::with(['quiz'])->whereHas('quiz', function ($query) use ($userId) {
                $query->where('user_id', $userId);
            })->where('running_status', 'true')->where('is_host_live', true)->latest()->first();

            if ($quizSession) {
                return $this->okResponse(['quizSession' => $quizSession], __('User is already hosting a live quiz session.'));
            }

            return $this->notFoundResponse([], __('User is not hosting any live quiz session.'));
        } catch (Exception $e) {
            Log::error('Error checking host live status: ' . $e->getMessage(), [
                'userId' => $userId,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse([], __('Failed to check host live status. Please try again later.'));
        }
    }

    /**
     * Host a live quiz session.
     */
    public function hostLater(HostLaterStoreRequest $request, $id): JsonResponse
    {
        try {
            $validatedData = $request->validated();
            $quiz = Quiz::find($id);

            if (! $quiz) {
                return $this->notFoundResponse([], __('Quiz not found'));
            }

            if ($response = $this->ensureQuizOwner($quiz)) {
                return $response;
            }

            // One open self-paced link per quiz at a time (this compared every quiz of the host's,
            // so one quiz's open link blocked sharing any other).
            $existingSession = QuizSession::where('quiz_id', $quiz->id)
                ->isHostLive(false)
                ->where('running_status', true)
                ->where('start_datetime', '<', $validatedData['end_datetime'])
                ->where('end_datetime', '>', $validatedData['start_datetime'])
                ->first();

            if ($existingSession) {
                return $this->conflictResponse([], __('This quiz already has a self-paced link open for these dates.'));
            }

            // Create new session
            $quizSession = QuizSession::create([
                'quiz_id' => $quiz->id,
                'title' => $validatedData['title'],
                'running_status' => true,
                'session_id' => generate_quiz_session_id($quiz->id, $validatedData['start_datetime']),
                'start_datetime' => $validatedData['start_datetime'],
                'end_datetime' => $validatedData['end_datetime'],
                'timezone' => $quiz->timezone ?? $validatedData['timezone'] ?? config('app.timezone', 'UTC'),
                // Never a live session: Host Live picks up a running live session, and would have
                // turned this link into the live game.
                'is_host_live' => false,
                'quiztime_mode' => $validatedData['quiztime_mode'] ?? null,
                'quiz_mode' => $validatedData['quiz_mode'] ?? null,
            ]);

            // New Join Link and Join Code generation
            $quizSession->update([
                'join_link' => generate_quiz_join_link(),
                'join_code' => generate_quiz_join_code(),
            ]);

            return $this->okResponse(['quiz' => $quiz, 'quizSession' => $quizSession], __('Quiz session created successfully.'));
        } catch (Exception $e) {
            Log::error('Error hosting quiz session: ' . $e->getMessage(), [
                'id' => $id,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse([], __('Failed to host quiz session. Please try again later.'));
        }
    }

    /**
     * Update an existing later quiz session.
     */
    public function updateHostLater(HostLaterUpdateRequest $request, $id): JsonResponse
    {
        try {
            $validatedData = $request->validated();
            $quizSession = QuizSession::with('quiz')->find($id);

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz Session not found'));
            }

            if ($response = $this->ensureQuizSessionOwner($quizSession)) {
                return $response;
            }

            // Update the existing session
            $quizSession->update([
                'title' => $validatedData['title'] ?? $quizSession->title,
                'quiztime_mode' => $validatedData['quiztime_mode'] ?? $quizSession->quiztime_mode,
                'quiz_mode' => $validatedData['quiz_mode'] ?? $quizSession->quiz_mode,
            ]);

            return $this->okResponse(['quizSession' => $quizSession], __('Quiz session updated successfully.'));
        } catch (Exception $e) {
            Log::error('Error updating quiz session: ' . $e->getMessage(), [
                'id' => $id,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse([], __('Failed to update quiz session. Please try again later.'));
        }
    }

    /**
     * Update time for a later quiz session.
     */
    public function timeHostLater(TimeHostLaterRequest $request, $id): JsonResponse
    {
        try {
            $quizSession = QuizSession::with('quiz')->find($id);

            if (! $quizSession) {
                return $this->notFoundResponse([], __('Quiz Session not found'));
            }

            if ($response = $this->ensureQuizSessionOwner($quizSession)) {
                return $response;
            }

            $validatedData = $request->validated();

            // Check for existing sessions with the same time - FIXED
            $existingSession = $quizSession
                ->userId(auth()->id())
                ->isHostLive(false)
                ->whereQuizId($quizSession->quiz_id)
                ->where('start_datetime', '<', $validatedData['end_datetime'])
                ->where('end_datetime', '>', $validatedData['start_datetime'])
                ->first();

            if ($existingSession) {
                return $this->conflictResponse([], __('A quiz session is already scheduled for the specified time range.'));
            }

            // Update the time of the existing session
            $quizSession->update([
                'timezone' => $validatedData['timezone'],
                'start_datetime' => $validatedData['start_datetime'],
                'end_datetime' => $validatedData['end_datetime'],
            ]);

            return $this->okResponse(['quizSession' => $quizSession], __('Quiz session time updated successfully.'));
        } catch (Exception $e) {
            Log::error('Error updating quiz session time: ' . $e->getMessage(), [
                'id' => $id,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse([], __('Failed to update quiz session time. Please try again later.'));
        }
    }

    /**
     * Change the status of a live quiz session.
     */
    public function statusLater(StatusLaterRequest $request, $id): JsonResponse
    {
        $validatedData = $request->validated();
        $quizSession = QuizSession::with('quiz')->find($id);

        if (! $quizSession) {
            return $this->notFoundResponse([], __('Quiz Session not found'));
        }

        if ($response = $this->ensureQuizSessionOwner($quizSession)) {
            return $response;
        }

        // Update the status of the existing session
        $quizSession->update([
            'running_status' => $validatedData['running_status'],
        ]);

        return $this->okResponse(['quizSession' => $quizSession], __('Quiz session status updated successfully.'));
    }

    /**
     * Check if a user is currently hosting a live quiz session.
     */
    public function checkHostLater($userId): JsonResponse
    {
        try {
            $quizSession = QuizSession::with(['quiz'])->whereHas('quiz', function ($query) use ($userId) {
                $query->where('user_id', $userId);
            })->where('start_datetime', '>', now())->where('end_datetime', '<', now())->where('is_host_live', false)->latest()->get();

            if ($quizSession->isNotEmpty()) {
                return $this->okResponse(['quizSession' => $quizSession], __('User is already hosting a quiz session.'));
            }

            return $this->notFoundResponse([], __('User is not hosting any quiz session.'));
        } catch (Exception $e) {
            Log::error('Error checking host live status: ' . $e->getMessage(), [
                'userId' => $userId,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse([], __('Failed to check host live status. Please try again later.'));
        }
    }

    /**
     * Copy a quest along with its tasks.
     */
    public function copyWithQuestions($id): JsonResponse
    {
        DB::beginTransaction();

        try {
            $quiz = Quiz::find($id);

            if (! $quiz) {
                return $this->notFoundResponse([], __('Quiz not found'));
            }

            // Duplicate the quiz
            $newQuiz = $quiz->replicate();
            $newQuiz->title = $quiz->title . ' (Copy)';
            $newQuiz->user_id = Auth::guard('api')->id();
            $this->setOriginOwnerInfoForQuiz($newQuiz, $quiz);
            $newQuiz->push();

            // Duplicate associated questions
            if ($quiz->questions && $quiz->questions->count() > 0) {
                foreach ($quiz->questions as $question) {
                    $newQuestion = $question->replicate();
                    $newQuestion->quiz_id = $newQuiz->id;
                    $newQuestion->push();
                }
            }

            DB::commit();

            return $this->createdResponse(['quiz' => $newQuiz, 'questions' => $newQuiz->questions], __('Quiz copied successfully.'));
        } catch (Exception $e) {
            DB::rollBack();

            Log::error('Error copying quiz with questions: ' . $e->getMessage(), [
                'id' => $id,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse([], __('Failed to copy quiz. Please try again later.'));
        }
    }

    /**
     * Copy a public quiz into the authenticated user's library.
     */
    public function addMyLibrary($id): JsonResponse
    {
        DB::beginTransaction();

        try {
            $quiz = Quiz::find($id);

            if (! $quiz) {
                return $this->notFoundResponse([], __('Quiz not found'));
            }

            if (($quiz->visibility ?? 'private') !== 'public') {
                return $this->forbiddenResponse([], __('Only public quizes can be copied.'));
            }

            // Duplicate the quiz
            $newQuiz = $quiz->replicate();
            $newQuiz->title = $quiz->title . ' (Copy)';
            $newQuiz->user_id = Auth::guard('api')->id();
            $this->setOriginOwnerInfoForQuiz($newQuiz, $quiz);
            $newQuiz->push();

            // Duplicate associated questions
            if ($quiz->questions && $quiz->questions->count() > 0) {
                foreach ($quiz->questions as $question) {
                    $newQuestion = $question->replicate();
                    $newQuestion->quiz_id = $newQuiz->id;
                    $newQuestion->push();
                }
            }

            DB::commit();

            return $this->createdResponse(
                [
                    'quiz' => $newQuiz,
                    'questions' => $newQuiz->questions,
                ],
                __('Quiz copied successfully.')
            );
        } catch (Exception $e) {
            DB::rollBack();

            Log::error('Error copying public quiz: ' . $e->getMessage(), [
                'id' => $id,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse([], __('Failed to copy quiz. Please try again later.'));
        }
    }

    /**
     * Display a listing of public quizes.
     */
    public function publicIndex(Request $request): JsonResponse
    {
        $quizes = Quiz::with(['user'])
            ->published()
            ->public()
            ->where('user_id', '!=', auth()->id());

        $searchTerm = $request->input('search');
        if ($searchTerm !== null && $searchTerm !== '') {
            $normalizedSearch = strtolower($searchTerm);
            $quizes->where(function ($query) use ($normalizedSearch) {
                $query->whereRaw('LOWER(title) LIKE ?', ['%' . $normalizedSearch . '%'])
                    ->orWhereRaw('LOWER(description) LIKE ?', ['%' . $normalizedSearch . '%']);
            });
        }

        // Filter by visibility
        if ($request->has('visibility')) {
            $quizes->public($request->input('visibility'));
        }
        // Filter by published status
        if ($request->has('is_published')) {
            $quizes->published($request->input('is_published'));
        }

        $quizes = $quizes->paginate($request->input('per_page', 10));

        return $this->okResponse(['quizes' => $quizes], __('Public quizes retrieved successfully.'));
    }

    private function setOriginOwnerInfoForQuiz(Quiz $target, Quiz $source): void
    {
        $originOwner = $source->user;
        $originOwnerName = $originOwner?->full_name ? trim((string) $originOwner->full_name) : null;
        if ($originOwnerName === '') {
            $originOwnerName = null;
        }

        $originOwnerProfilePicture = $originOwner?->profile_picture;
        if ($originOwnerProfilePicture === '') {
            $originOwnerProfilePicture = null;
        }

        $target->origin_owner_id = $originOwner?->id;
        $target->origin_owner_name = $originOwnerName;
        $target->origin_owner_profile_picture = $originOwnerProfilePicture;
    }

    /**
     * Display the specified public quiz.
     */
    public function publicShow($id): JsonResponse
    {
        $quiz = Quiz::with(['questions', 'user'])
            ->published()
            ->public()
            ->where('user_id', '!=', auth()->id())
            ->find($id);

        if (! $quiz) {
            return $this->notFoundResponse([], __('Quiz not found'));
        }

        return $this->okResponse(['quiz' => $quiz], __('Public quiz retrieved successfully.'));
    }
}
