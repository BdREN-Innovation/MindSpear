<?php

namespace App\Http\Controllers\api\v1\Quest;

use App\Http\Controllers\api\v1\ApiBaseController;
use App\Http\Requests\Quest\HostLive\EndLiveRequest;
use App\Http\Requests\Quest\HostLive\HostLiveUpdateRequest;
use App\Http\Requests\Quest\HostLive\StatusLiveRequest;
use App\Http\Requests\Quest\HostLive\StoreRequest as HostLiveStoreRequest;
use App\Http\Requests\Quest\Quest\StoreRequest;
use App\Http\Requests\Quest\Quest\UpdateRequest;
use App\Models\Quest\Quest;
use App\Models\Quest\QuestParticipant;
use App\Models\Quest\QuestSession;
use App\Services\Live\LiveSessionService;
use App\Services\Live\ParticipantTokenService;
use Exception;
use Illuminate\Support\Facades\Auth;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class QuestController extends ApiBaseController
{
    protected function ensureQuestOwner(Quest $quest): ?JsonResponse
    {
        if ($quest->creator_id !== auth()->id()) {
            return $this->forbiddenResponse([], __('You are not allowed to access this quest.'));
        }

        return null;
    }

    protected function ensureQuestSessionOwner(QuestSession $questSession): ?JsonResponse
    {
        $quest = $questSession->quest;

        if (! $quest || $quest->creator_id !== auth()->id()) {
            return $this->forbiddenResponse([], __('You are not allowed to access this quest.'));
        }

        return null;
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request): JsonResponse
    {
        // Logic to retrieve and return a list of quests
        $quests = Quest::query()
            ->withCount('tasks');

        if ($request->has('status')) {
            if ($request->status === 'active') {
                $quests->active();
            }

            if ($request->status === 'draft') {
                $quests->draft();
            }

            if ($request->status === 'archived') {
                $quests->archived();
            }

            if ($request->status === 'published') {
                $quests->published();
            }

            if ($request->status === 'completed') {
                $quests->completed();
            }
        }

        if ($request->has('search')) {
            $quests->whereRaw('LOWER(title) LIKE ?', ['%' . strtolower($request->search) . '%']);
        }

        if ($request->filled('date_from')) {
            $quests->whereDate('created_at', '>=', $request->date_from);
        }

        if ($request->filled('date_to')) {
            $quests->whereDate('created_at', '<=', $request->date_to);
        }

        if ($request->filled('start_date')) {
            $quests->whereDate('created_at', '>=', $request->start_date);
        }

        if ($request->filled('end_date')) {
            $quests->whereDate('created_at', '<=', $request->end_date);
        }

        if ($request->has('sort_by')) {
            $quests->sortBy($request->sort_by);
        } else {
            $quests->sortBy('created_at', 'desc');
        }

        $authId = Auth::guard('api')->id();
        $requestedCreatorId = $request->input('creator_id') ?? $request->input('user_id');

        if ($requestedCreatorId !== null) {
            if ($authId && (int) $requestedCreatorId !== (int) $authId) {
                return $this->forbiddenResponse([], __('You are not allowed to access these quests.'));
            }

            $quests->where('creator_id', $requestedCreatorId);
        } elseif ($authId) {
            $quests->where('creator_id', $authId);
        }

        $quests = $quests->paginate($request->get('per_page', 10));

        return $this->okResponse(['quests' => $quests], __('Quests retrieved successfully'));
    }

    /**
     * Display the specified resource.
     */
    public function show(Request $request, $id): JsonResponse
    {
        // Logic to retrieve and return a specific quest
        $quest = Quest::with([
            'tasks' => function ($query) {
                $query->orderBy('serial_number', 'asc');
            },
            'creator',
        ])
            ->withCount('tasks')
            ->find($id);

        if (! $quest) {
            return $this->notFoundResponse([], __('Quest not found'));
        }

        if ($response = $this->ensureQuestOwner($quest)) {
            return $response;
        }

        $questSessions = QuestSession::where('quest_id', $quest->id)
            ->orderBy('created_at', 'desc')
            ->withCount('participants')
            ->whereHas('participants', function ($q) {
                // optional: add filters on participants if needed for future use cases
            }, '>=', 0)
            ->paginate($request->input('per_page', 10));

        return $this->okResponse(
            ['quest' => $quest, 'questSessions' => $questSessions],
            __('Quest retrieved successfully')
        );
    }

    /**
     * Get quest details by joining the link for the owner.
     */
    public function getQuestDetailsByJoinLink(string $joinLink): JsonResponse
    {
        try {
            $quest = Quest::with([
                'tasks' => function ($query) {
                    $query->orderBy('serial_number', 'asc');
                },
            ])
                ->where('join_link', $joinLink)
                ->whereNull('deleted_at')
                ->first();

            if (! $quest) {
                return $this->notFoundResponse([], __('Quest not found.'));
            }

            if ($response = $this->ensureQuestOwner($quest)) {
                return $response;
            }

            $questSession = $quest->sessions()
                ->withCount('participants')
                ->where('running_status', true)
                ->latest()
                ->first();

            if (! $questSession) {
                return $this->badRequestResponse([], __('Quest session has ended.'));
            }

            app(LiveSessionService::class)->ensurePublicChannelKey($questSession);

            return $this->okResponse(
                ['quest' => $quest, 'questSession' => $questSession],
                __('Quest details retrieved successfully.')
            );
        } catch (Exception $e) {
            Log::error('Error retrieving quest details by join link: ' . $e->getMessage(), [
                'joinLink' => $joinLink,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse(
                [],
                __('Failed to retrieve quest details. Please try again.')
            );
        }
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(StoreRequest $request): JsonResponse
    {
        DB::beginTransaction();

        try {
            // Create a new quest
            $quest = Quest::create($request->validated());
            // Commit the transaction
            DB::commit();

            // Return the created quest
            return $this->createdResponse(['quest' => $quest], __('Quest created successfully.'));
        } catch (\Exception $e) {
            // Rollback the transaction on error
            DB::rollBack();
            // Log the error for debugging
            Log::error('Quest creation failed: ' . $e->getMessage(), [
                'request' => $request->all(),
                'exception' => $e,
            ]);

            // Return a server error response
            return $this->serverErrorResponse([], __('Quest creation failed. Please try again later.'));
        }
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(UpdateRequest $request, $id): JsonResponse
    {
        DB::beginTransaction();

        try {
            // Find the quest to update
            $quest = Quest::find($id);

            if (! $quest) {
                return $this->notFoundResponse([], __('Quest not found'));
            }

            if ($response = $this->ensureQuestOwner($quest)) {
                return $response;
            }

            if ($quest->participants->count() > 0) {
                return $this->methodNotAllowedResponse(['quest' => $quest], __('You are not allowed to edit the Quest'));
            }

            // Update the quest with validated data
            $quest->update($request->validated());

            // Commit the transaction
            DB::commit();

            // Return the updated quest
            return $this->okResponse(['quest' => $quest], __('Quest updated successfully.'));
        } catch (\Exception $e) {
            // Rollback the transaction on error
            DB::rollBack();
            // Log the error for debugging
            Log::error('Quest update failed: ' . $e->getMessage(), [
                'request' => $request->all(),
                'exception' => $e,
            ]);

            // Return a server error response
            return $this->serverErrorResponse([], __('Quest update failed. Please try again later.'));
        }
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy($id): JsonResponse
    {
        DB::beginTransaction();

        try {
            // Find the quest to delete
            $quest = Quest::find($id);

            if (! $quest) {
                return $this->notFoundResponse([], __('Quest not found'));
            }

            if ($response = $this->ensureQuestOwner($quest)) {
                return $response;
            }

            // Soft delete the quest
            $quest->delete();

            // Commit the transaction
            DB::commit();

            // Return a success response
            return $this->okResponse([], __('Quest deleted successfully.'));
        } catch (\Exception $e) {
            // Rollback the transaction on error
            DB::rollBack();
            // Log the error for debugging
            Log::error('Quest deletion failed: ' . $e->getMessage(), [
                'id' => $id,
                'exception' => $e,
            ]);

            // Return a server error response
            return $this->serverErrorResponse([], __('Quest deletion failed. Please try again later.'));
        }
    }

    /**
     * Check if a quest exists by ID.
     */
    public function checkQuestById($id): JsonResponse
    {
        $quest = Quest::find($id);

        if (! $quest) {
            return $this->notFoundResponse([], __('Quest not found.'));
        }

        return $this->okResponse(['quest' => $quest], __('Quest exists.'));
    }

    /**
     * Check if a quest exists by join link.
     */
    public function checkQuestByJoinLink($joinLink): JsonResponse
    {
        $quest = Quest::where('join_link', $joinLink)->first();

        if (! $quest) {
            return $this->notFoundResponse([], __('Quest not found.'));
        }

        return $this->okResponse(['quest' => $quest], __('Quest exists.'));
    }

    /**
     * Check if a quest exists by join code.
     */
    public function checkQuestByJoinCode(StoreRequest $request, $joinCode): JsonResponse
    {
        $quest = Quest::where('join_code', $joinCode)->first();

        if (! $quest) {
            return $this->notFoundResponse([], __('Quest not found.'));
        }

        return $this->okResponse(['quest' => $quest], __('Quest exists.'));
    }

    /**
     * Check the latest quest session for a creator.
     */
    public function checkLatestSessionByCreator($userId): JsonResponse
    {
        try {
            $questSession = QuestSession::with(['quest'])->latest()->whereHas('quest', function ($query) use ($userId) {
                $query->where('creator_id', $userId);
            })->first();

            if (! $questSession) {
                return $this->notFoundResponse([], __('No active quest session found.'));
            }

            $runningQuest = $questSession->running_status;

            return $this->okResponse(['questSession' => $questSession, 'running' => $runningQuest], __('Latest quest session found.'));
        } catch (Exception $e) {
            Log::error('Error fetching latest quest session: ' . $e->getMessage(), [
                'userId' => $userId,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse([], __('Failed to retrieve latest quest session. Please try again later.'));
        }
    }

    public function hostLive(HostLiveStoreRequest $request, $id): JsonResponse
    {
        try {
            $validatedData = $request->validated();
            $quest = Quest::find($id);

            if (! $quest) {
                return $this->notFoundResponse([], __('Quest not found'));
            }

            if ($response = $this->ensureQuestOwner($quest)) {
                return $response;
            }

            $runningSession = $quest->sessions()
                ->where('running_status', true)
                ->latest()
                ->first();
            $liveSessions = app(LiveSessionService::class);

            if ($runningSession) {
                // Hosting publishes the quest: players can only join a published one.
                $quest->update(['status' => Quest::STATUS_RUNNING, 'is_published' => true]);
                $liveSessions->ensurePublicChannelKey($runningSession);

                return $this->okResponse(
                    ['quest' => $quest, 'questSession' => $runningSession],
                    __('Quest session is already running.')
                );
            }

            $questSession = $quest->sessions()->create([
                'quest_id' => $quest->id,
                'title' => $validatedData['title'],
                'running_status' => true,
                'current_task_id' => null,
                'timer_state' => null,
                'session_id' => generate_quest_session_id($quest->id, $validatedData['start_datetime']),
                'start_datetime' => $validatedData['start_datetime'],
                'end_datetime' => $validatedData['end_datetime'],
                'timezone' => $quest->timezone ?? config('app.timezone', 'UTC'),
            ]);

            $quest->update([
                'join_link' => generate_quest_join_link(),
                'join_code' => generate_quest_join_code(),
            ]);

            $liveSessions->ensurePublicChannelKey($questSession);

            // Hosting publishes the quest: players can only join a published one (it stayed
            // unpublished when the quest was within its dates, so nobody could join).
            $quest->update([
                'status' => Quest::STATUS_RUNNING,
                'is_published' => true,
            ]);

            $payload = $liveSessions->state(LiveSessionService::MODULE_QUEST, $questSession);

            $liveSessions->broadcastPublic(LiveSessionService::MODULE_QUEST, $questSession, 'session.started', $payload);
            $liveSessions->broadcastHost(LiveSessionService::MODULE_QUEST, $questSession, 'session.started', $payload);

            return $this->okResponse(['quest' => $quest, 'questSession' => $questSession], __('Quest session started successfully.'));
        } catch (Exception $e) {
            Log::error('Error hosting quest session: ' . $e->getMessage(), [
                'id' => $id,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse([], __('Failed to host quest session. Please try again later.'));
        }
    }

    /**
     * Update an existing live quest session.
     */
    public function updateHostLive(HostLiveUpdateRequest $request, $id): JsonResponse
    {
        $validatedData = $request->validated();
        $questSession = QuestSession::with('quest')->find($id);

        if (! $questSession) {
            return $this->notFoundResponse([], __('Quest Session not found'));
        }

        if ($response = $this->ensureQuestSessionOwner($questSession)) {
            return $response;
        }

        // Update the existing session
        $questSession->update([
            'title' => $validatedData['title'],
        ]);

        return $this->okResponse(['questSession' => $questSession], __('Quest session updated successfully.'));
    }

    /**
     * End a live quest session.
     */
    public function endLive(EndLiveRequest $request, $id): JsonResponse
    {
        try {
            $questSession = QuestSession::with('quest')->find($id);

            if (! $questSession) {
                return $this->notFoundResponse([], __('Quest Session not found'));
            }

            if ($response = $this->ensureQuestSessionOwner($questSession)) {
                return $response;
            }

            $endedAt = now();

            // The server owns the end time so frontend clock/validation drift cannot block ending.
            $questSession->update([
                'end_datetime' => $endedAt,
                'running_status' => false,
            ]);

            $questSession->quest->update([
                'status' => Quest::STATUS_ENDED,
            ]);

            QuestParticipant::query()
                ->where('quest_session_id', $questSession->id)
                ->where('status', 'In Progress')
                ->update([
                    'status' => 'Completed',
                    'end_time' => $endedAt,
                ]);

            app(ParticipantTokenService::class)->revokeForSession(LiveSessionService::MODULE_QUEST, $questSession->id);

            $liveSessions = app(LiveSessionService::class);
            $payload = $liveSessions->state(LiveSessionService::MODULE_QUEST, $questSession->refresh());
            $liveSessions->broadcastPublic(LiveSessionService::MODULE_QUEST, $questSession, 'session.ended', $payload);
            $liveSessions->broadcastHost(LiveSessionService::MODULE_QUEST, $questSession, 'session.ended', $payload);

            return $this->okResponse(['questSession' => $questSession], __('Quest session ended successfully.'));
        } catch (Exception $e) {
            Log::error('Error ending quest session: ' . $e->getMessage(), [
                'id' => $id,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse([], __('Failed to end quest session. Please try again later.'));
        }
    }

    /**
     * Change the status of a live quest session.
     */
    public function statusLive(StatusLiveRequest $request, $id): JsonResponse
    {
        $validatedData = $request->validated();
        $questSession = QuestSession::with('quest')->find($id);

        if (! $questSession) {
            return $this->notFoundResponse([], __('Quest Session not found'));
        }

        if ($response = $this->ensureQuestSessionOwner($questSession)) {
            return $response;
        }

        // Update the status of the existing session
        $questSession->update([
            'running_status' => $validatedData['running_status'],
        ]);

        $questSession->quest->update([
            'status' => $validatedData['running_status'] ? Quest::STATUS_RUNNING : Quest::STATUS_INITIATED,
        ]);

        $eventName = $validatedData['running_status'] ? 'session.resumed' : 'session.paused';
        app(LiveSessionService::class)->broadcastPublic(LiveSessionService::MODULE_QUEST, $questSession, $eventName, [
            'session_id' => $questSession->id,
            'running_status' => (bool) $validatedData['running_status'],
        ]);
        app(LiveSessionService::class)->broadcastHost(LiveSessionService::MODULE_QUEST, $questSession, $eventName, [
            'session_id' => $questSession->id,
            'running_status' => (bool) $validatedData['running_status'],
        ]);

        return $this->okResponse(['questSession' => $questSession], __('Quest session status updated successfully.'));
    }

    /**
     * Check if a user is currently hosting a live quest session.
     */
    public function checkHostLive($userId): JsonResponse
    {
        try {
            $questSession = QuestSession::with(['quest'])->whereHas('quest', function ($query) use ($userId) {
                $query->where('creator_id', $userId);
            })->where('running_status', 'true')->latest()->first();

            if ($questSession) {
                return $this->okResponse(['questSession' => $questSession], __('User is already hosting a live quest session.'));
            }

            return $this->notFoundResponse([], __('User is not hosting any live quest session.'));
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
    public function copyWithTasks($id): JsonResponse
    {
        DB::beginTransaction();

        try {
            $quest = Quest::find($id);

            if (! $quest) {
                return $this->notFoundResponse([], __('Quest not found'));
            }

            if ($response = $this->ensureQuestOwner($quest)) {
                return $response;
            }

            // Duplicate the quest
            $newQuest = $quest->replicate();
            $newQuest->title = $quest->title . ' (Copy)';
            $newQuest->creator_id = Auth::guard('api')->id();
            $newQuest->status = Quest::STATUS_NOT_STARTED;
            $this->setOriginOwnerInfoForQuest($newQuest, $quest);
            $newQuest->push();

            // Duplicate associated tasks
            if ($quest->tasks && $quest->tasks->count() > 0) {
                foreach ($quest->tasks as $task) {
                    $newTask = $task->replicate();
                    $newTask->quest_id = $newQuest->id;
                    $newTask->push();
                }
            }

            DB::commit();

            return $this->createdResponse(['quest' => $newQuest, 'tasks' => $newQuest->tasks], __('Quest copied successfully.'));
        } catch (Exception $e) {
            DB::rollBack();

            Log::error('Error copying quest with tasks: ' . $e->getMessage(), [
                'id' => $id,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse([], __('Failed to copy quest. Please try again later.'));
        }
    }

    /**
     * Copy a public quest into the authenticated user's library.
     */
    public function addMyLibrary($id): JsonResponse
    {
        DB::beginTransaction();

        try {
            $quest = Quest::find($id);

            if (! $quest) {
                return $this->notFoundResponse([], __('Quest not found'));
            }

            if (($quest->visibility ?? 'private') !== 'public') {
                return $this->forbiddenResponse([], __('Only public quests can be copied.'));
            }

            // Duplicate the quest
            $newQuest = $quest->replicate();
            $newQuest->title = $quest->title . ' (Copy)';
            $newQuest->creator_id = Auth::guard('api')->id();
            $newQuest->status = Quest::STATUS_NOT_STARTED;
            $this->setOriginOwnerInfoForQuest($newQuest, $quest);
            $newQuest->push();

            // Duplicate associated tasks
            if ($quest->tasks && $quest->tasks->count() > 0) {
                foreach ($quest->tasks as $task) {
                    $newTask = $task->replicate();
                    $newTask->quest_id = $newQuest->id;
                    $newTask->push();
                }
            }

            DB::commit();

            return $this->createdResponse(
                [
                    'quest' => $newQuest,
                    'tasks' => $newQuest->tasks,
                ],
                __('Quest copied successfully.')
            );
        } catch (Exception $e) {
            DB::rollBack();

            Log::error('Error copying public quest: ' . $e->getMessage(), [
                'id' => $id,
                'exception' => $e,
            ]);

            return $this->serverErrorResponse([], __('Failed to copy quest. Please try again later.'));
        }
    }

    /**
     * Display a listing of public quests.
     */
    public function publicIndex(Request $request): JsonResponse
    {
        $quests = Quest::with(['creator'])->published()->public();

        $quests->where('creator_id', '!=', auth()->id());

        $searchTerm = $request->input('search');
        if ($searchTerm !== null && $searchTerm !== '') {
            $quests->where(function ($query) use ($searchTerm) {
                $query->where('title', 'like', '%' . $searchTerm . '%')
                    ->orWhere('description', 'like', '%' . $searchTerm . '%');
            });
        }

        // Filter by visibility
        if ($request->has('visibility')) {
            $quests->public($request->input('visibility'));
        }
        // Filter by published status
        if ($request->has('is_published')) {
            $quests->published($request->input('is_published'));
        }

        $quests = $quests->paginate($request->input('per_page', 10));

        return $this->okResponse(['quests' => $quests], __('Public quests retrieved successfully.'));
    }

    /**
     * Display the specified public quest.
     */
    public function publicShow($id): JsonResponse
    {
        $questQuery = Quest::with(['tasks', 'creator'])
            ->published()
            ->public()
            ->where('creator_id', '!=', auth()->id());

        $quest = $questQuery->find($id);

        if (! $quest) {
            return $this->notFoundResponse([], __('Quest not found'));
        }

        return $this->okResponse(['quest' => $quest], __('Public quest retrieved successfully.'));
    }

    private function setOriginOwnerInfoForQuest(Quest $target, Quest $source): void
    {
        $originOwner = $source->creator;
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
}
