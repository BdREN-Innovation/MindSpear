<?php

namespace App\Http\Controllers\api\v1\Quiz;

use App\Http\Controllers\api\v1\ApiBaseController;
use App\Http\Requests\Quiz\QuestionBank\StoreRequest;
use App\Http\Requests\Quiz\QuestionBank\UpdateRequest;
use App\Http\Requests\Quiz\QuestionBank\DuplicateCheckRequest;
use App\Models\Quiz\BankQuestion;
use App\Models\Quiz\QuestionBankCategory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class QuestionBankController extends ApiBaseController
{
    public function my(Request $request): JsonResponse
    {
        $query = BankQuestion::query()
            ->where('owner_id', auth()->id())
            ->with(['category']);

        if ($request->filled('q_bank_category_id')) {
            $query->where('q_bank_category_id', $request->integer('q_bank_category_id'));
        }
        if ($request->filled('visibility')) {
            $query->where('visibility', $request->input('visibility'));
        }
        if ($request->filled('search')) {
            $query->where('question_text', 'like', '%' . $request->input('search') . '%');
        }

        $perPage = min($request->integer('per_page', 15), 100);
        $items = $query->orderByDesc('id')->paginate($perPage);

        return $this->okResponse(['questions' => $items], __('My bank questions retrieved successfully.'));
    }

    public function checkDuplicate(DuplicateCheckRequest $request): JsonResponse
    {
        $data = $request->validated();
        $normalizedText = mb_strtolower(trim($data['question_text']));

        $query = BankQuestion::query()
            ->where('owner_id', auth()->id())
            ->where('question_type', $data['question_type'])
            ->where('visibility', $data['visibility'])
            ->whereRaw('LOWER(TRIM(question_text)) = ?', [$normalizedText]);

        if (! empty($data['exclude_id'])) {
            $query->where('id', '!=', $data['exclude_id']);
        }

        $exists = $query->exists();

        if ($exists) {
            $match = $query->first(['id', 'q_bank_category_id', 'question_text', 'question_type', 'visibility']);
            return $this->conflictResponse([
                'duplicate' => true,
                'question' => $match,
            ], __('Duplicate bank question found.'));
        }

        return $this->okResponse(['duplicate' => false], __('No duplicate found.'));
    }

    public function public(Request $request): JsonResponse
    {
        $query = BankQuestion::query()
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
            $query->where('question_text', 'like', '%' . $request->input('search') . '%');
        }

        $perPage = min($request->integer('per_page', 15), 100);
        $items = $query->orderByDesc('id')->paginate($perPage);

        return $this->okResponse(['questions' => $items], __('Public bank questions retrieved successfully.'));
    }

    public function store(StoreRequest $request): JsonResponse
    {
        DB::beginTransaction();
        try {
            $data = $request->validated();
            $data['owner_id'] = auth()->id();

            if (empty($data['q_bank_category_id'])) {
                $rootCategory = QuestionBankCategory::firstOrCreate(
                    [
                        'name' => 'My Question Bank',
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

            $uploaded = $request->file('source_content_url');
            if ($uploaded) {
                $data['source_content_url'] = $this->uploadFile($uploaded, 'questions');
            }

            $question = BankQuestion::create($data);
            DB::commit();
            return $this->createdResponse(['question' => $question], __('Bank question created successfully.'));
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error creating bank question: ' . $e->getMessage());
            return $this->serverErrorResponse([], __('Failed to create bank question.'));
        }
    }

    public function show(int $id): JsonResponse
    {
        $question = BankQuestion::with(['category', 'owner'])->withTrashed()->find($id);
        if (! $question) {
            return $this->notFoundResponse([], __('Bank question not found.'));
        }
        return $this->okResponse(['question' => $question], __('Bank question retrieved successfully.'));
    }

    public function update(UpdateRequest $request, int $id): JsonResponse
    {
        DB::beginTransaction();
        try {
            $question = BankQuestion::find($id);
            if (! $question) {
                return $this->notFoundResponse([], __('Bank question not found.'));
            }
            if ($question->owner_id !== auth()->id()) {
                return $this->forbiddenResponse([], __('You do not have permission to modify this bank question.'));
            }

            $data = $request->validated();

            $uploaded = $request->file('source_content_url');
            if ($uploaded) {
                $data['source_content_url'] = $this->uploadFile($uploaded, 'questions', $question->getRawOriginal('source_content_url'));
            }

            $question->update($data);
            DB::commit();
            return $this->okResponse(['question' => $question], __('Bank question updated successfully.'));
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error updating bank question: ' . $e->getMessage());
            return $this->serverErrorResponse([], __('Failed to update bank question.'));
        }
    }

    public function destroy(int $id): JsonResponse
    {
        DB::beginTransaction();
        try {
            $question = BankQuestion::find($id);
            if (! $question) {
                return $this->notFoundResponse([], __('Bank question not found.'));
            }
            if ($question->owner_id !== auth()->id()) {
                return $this->forbiddenResponse([], __('You do not have permission to delete this bank question.'));
            }

            $filePath = $question->getRawOriginal('source_content_url');
            if ($filePath && $this->checkExistsFile($filePath)) {
                $this->removeFile($filePath);
            }

            $question->delete();
            DB::commit();
            return $this->okResponse([], __('Bank question deleted successfully.'));
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error deleting bank question: ' . $e->getMessage());
            return $this->serverErrorResponse([], __('Failed to delete bank question.'));
        }
    }

    public function restore(int $id): JsonResponse
    {
        DB::beginTransaction();
        try {
            $question = BankQuestion::withTrashed()->find($id);
            if (! $question) {
                return $this->notFoundResponse([], __('Bank question not found.'));
            }
            if ($question->owner_id !== auth()->id()) {
                return $this->forbiddenResponse([], __('You do not have permission to restore this bank question.'));
            }
            $question->restore();
            DB::commit();
            return $this->okResponse([], __('Bank question restored successfully.'));
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Error restoring bank question: ' . $e->getMessage());
            return $this->serverErrorResponse([], __('Failed to restore bank question.'));
        }
    }
}
