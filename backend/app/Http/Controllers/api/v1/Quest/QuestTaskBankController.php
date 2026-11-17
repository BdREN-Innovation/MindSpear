<?php

namespace App\Http\Controllers\api\v1\Quest;

use App\Http\Controllers\api\v1\ApiBaseController;
use App\Http\Requests\Quest\QuestTaskBank\StoreRequest;
use App\Http\Requests\Quest\QuestTaskBank\UpdateRequest;
use App\Models\Quest\BankTask;
use App\Models\Quest\QuestTaskBankCategory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class QuestTaskBankController extends ApiBaseController
{
    public function my(Request $request): JsonResponse
    {
        $query = BankTask::query()
            ->where('owner_id', auth()->id())
            ->with(['category']);

        if ($request->filled('q_bank_category_id')) {
            $query->where('q_bank_category_id', $request->integer('q_bank_category_id'));
        }
        if ($request->filled('visibility')) {
            $query->where('visibility', $request->input('visibility'));
        }
        if ($request->filled('search')) {
            $query->where('title', 'like', '%' . $request->input('search') . '%');
        }

        $perPage = min($request->integer('per_page', 15), 100);
        $items = $query->orderByDesc('id')->paginate($perPage);

        return $this->okResponse(['tasks' => $items], __('My bank tasks retrieved successfully.'));
    }

    public function public(Request $request): JsonResponse
    {
        $query = BankTask::query()
            ->where('visibility', 'public')
            ->with([
                'category',
                'owner' => function ($q) {
                    $q->select('id', 'first_name', 'last_name', 'email', 'profile_picture');
                },
            ]);

        if ($request->filled('q_bank_category_id')) {
            $query->where('q_bank_category_id', $request->integer('q_bank_category_id'));
        }
        if ($request->filled('search')) {
            $query->where('title', 'like', '%' . $request->input('search') . '%');
        }

        $perPage = min($request->integer('per_page', 15), 100);
        $items = $query->orderByDesc('id')->paginate($perPage);

        return $this->okResponse(['tasks' => $items], __('Public bank tasks retrieved successfully.'));
    }

    public function store(StoreRequest $request): JsonResponse
    {
        DB::beginTransaction();
        try {
            $data = $request->validated();
            $data['owner_id'] = auth()->id();

            if (empty($data['q_bank_category_id'])) {
                $rootCategory = QuestTaskBankCategory::firstOrCreate(
                    [
                        'name' => 'My Task Bank',
                        'created_by' => auth()->id(),
                        'parent_category_id' => null,
                    ],
                    [
                        'description' => null,
                        'is_parent' => true,
                    ]
                );
                $data['q_bank_category_id'] = $rootCategory->id;
            }

            $task = BankTask::create($data);
            DB::commit();
            return $this->createdResponse(['task' => $task], __('Bank task created successfully.'));
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error creating bank task: ' . $e->getMessage());
            return $this->serverErrorResponse([], __('Failed to create bank task.'));
        }
    }

    public function show(int $id): JsonResponse
    {
        $task = BankTask::with(['category', 'owner'])->withTrashed()->find($id);
        if (! $task) {
            return $this->notFoundResponse([], __('Bank task not found.'));
        }
        return $this->okResponse(['task' => $task], __('Bank task retrieved successfully.'));
    }

    public function update(UpdateRequest $request, int $id): JsonResponse
    {
        DB::beginTransaction();
        try {
            $task = BankTask::find($id);
            if (! $task) {
                return $this->notFoundResponse([], __('Bank task not found.'));
            }
            if ($task->owner_id !== auth()->id()) {
                return $this->forbiddenResponse([], __('You do not have permission to modify this bank task.'));
            }

            $data = $request->validated();
            $task->update($data);
            DB::commit();
            return $this->okResponse(['task' => $task], __('Bank task updated successfully.'));
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error updating bank task: ' . $e->getMessage());
            return $this->serverErrorResponse([], __('Failed to update bank task.'));
        }
    }

    public function destroy(int $id): JsonResponse
    {
        DB::beginTransaction();
        try {
            $task = BankTask::find($id);
            if (! $task) {
                return $this->notFoundResponse([], __('Bank task not found.'));
            }
            if ($task->owner_id !== auth()->id()) {
                return $this->forbiddenResponse([], __('You do not have permission to delete this bank task.'));
            }

            $task->delete();
            DB::commit();
            return $this->okResponse([], __('Bank task deleted successfully.'));
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error deleting bank task: ' . $e->getMessage());
            return $this->serverErrorResponse([], __('Failed to delete bank task.'));
        }
    }

    public function restore(int $id): JsonResponse
    {
        DB::beginTransaction();
        try {
            $task = BankTask::withTrashed()->find($id);
            if (! $task) {
                return $this->notFoundResponse([], __('Bank task not found.'));
            }
            if ($task->owner_id !== auth()->id()) {
                return $this->forbiddenResponse([], __('You do not have permission to restore this bank task.'));
            }
            $task->restore();
            DB::commit();
            return $this->okResponse([], __('Bank task restored successfully.'));
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error restoring bank task: ' . $e->getMessage());
            return $this->serverErrorResponse([], __('Failed to restore bank task.'));
        }
    }
}
