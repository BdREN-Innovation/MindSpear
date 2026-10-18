<?php

namespace App\Http\Controllers\api\v1\Quiz;

use App\Http\Controllers\api\v1\ApiBaseController;
use App\Http\Requests\Quiz\Question\CopyToBankRequest;
use App\Http\Requests\Quiz\Question\StoreMultipleRequest;
use App\Http\Requests\Quiz\Question\StoreRequest;
use App\Http\Requests\Quiz\Question\UpdateMultipleRequest;
use App\Http\Requests\Quiz\Question\UpdateRequest;
use App\Models\Quiz\Question;
use App\Models\Quiz\Quiz;
use App\Models\Quiz\BankQuestion;
use App\Models\Quiz\QuestionBankCategory;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class QuestionController extends ApiBaseController
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request): JsonResponse
    {
        $questions = Question::with(['quiz.user.institution', 'deletedBy']);

        // Apply filters if any
        if ($request->has('is_published')) {
            $questions->filterByIsPublished($request->input('is_published'));
        }

        if ($request->has('search')) {
            $questions->search($request->input('search'));
        }

        if ($request->has('user_id')) {
            $questions->filterByUserId($request->input('user_id'));
        }

        if ($request->has('category_id')) {
            $questions->filterByCategoryId($request->input('category_id'));
        }

        if ($request->has('open_datetime')) {
            $questions->filterByOpenDatetime($request->input('open_datetime'));
        }

        if ($request->has('close_datetime')) {
            $questions->filterByCloseDatetime($request->input('close_datetime'));
        }

        if ($request->has('duration')) {
            $questions->filterByDuration($request->input('duration'));
        }

        if ($request->has('logged_in_users_only')) {
            $questions->filterByLoggedInUsersOnly($request->boolean('logged_in_users_only'));
        }

        if ($request->has('safe_browser_mode')) {
            $questions->filterBySafeBrowserMode($request->boolean('safe_browser_mode'));
        }

        if ($request->has('quiz_mode')) {
            $questions->filterByQuizMode($request->input('quiz_mode'));
        }

        if ($request->has('quiz_id')) {
            $questions->filterByQuizId($request->input('quiz_id'));
        }

        if ($request->has('serial_number')) {
            $questions->filterBySerialNumber($request->input('serial_number'));
        }

        // Paginate the results
        $questions = $questions->paginate($request->input('per_page', 10));

        return $this->okResponse(['questions' => $questions], __('Question list retrieved successfully.'));
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(StoreRequest $request)
    {
        DB::beginTransaction();
        // Validate the request data
        $validatedData = $request->validated();
        if (! $this->ownsQuizzes([$validatedData['quiz_id'] ?? null])) {
            DB::rollBack();

            return $this->forbiddenResponse([], __('You do not have permission to add questions to this quiz.'));
        }
        try {
            // Ensure owner
            $validatedData['owner_id'] = auth()->id();

            $uploadedFile = $request->file('source_content_url');

            // Use the trait method to upload file
            if ($uploadedFile) {
                $filePath = $this->uploadFile($uploadedFile, 'questions');
                $validatedData['source_content_url'] = $filePath;
            }

            // Create a new question
            $question = Question::create($validatedData);
            // Commit the transaction
            DB::commit();

            // Return the response
            return $this->createdResponse(['question' => $question], __('Question created successfully.'));
        } catch (Exception $e) {
            // Rollback the transaction in case of error
            DB::rollBack();
            // Log the error message
            Log::error('Error creating question: ' . $e->getMessage());

            // Return an error response
            return $this->serverErrorResponse([], __('Failed to create question.'));
        }
    }

    /**
     * Store multiple newly created resources in storage.
     */
    public function storeMultiple(StoreMultipleRequest $request)
    {
        if (! $this->ownsQuizzes(collect($request->input('questions', []))->pluck('quiz_id'))) {
            return $this->forbiddenResponse([], __('You do not have permission to add questions to this quiz.'));
        }
        DB::beginTransaction();
        try {
            // Create multiple questions
            $questions = [];

            foreach ($request->input('questions') as $questionData) {
                $questionData['owner_id'] = auth()->id();
                $uploadedFile = $request->file('source_content_url');

                // Use the trait method to upload file
                if ($uploadedFile) {
                    $filePath = $this->uploadFile($uploadedFile, 'questions');
                    $questionData['source_content_url'] = $filePath;
                }

                $questions[] = Question::create($questionData);
            }
            // Commit the transaction
            DB::commit();

            // Return the response
            return $this->createdResponse(['questions' => $questions], __('Questions created successfully.'));
        } catch (Exception $e) {
            // Rollback the transaction in case of error
            DB::rollBack();
            // Log the error message
            Log::error('Error creating questions: ' . $e->getMessage());

            // Return an error response
            return $this->serverErrorResponse([], __('Failed to create questions.'));
        }
    }

    /**
     * Display the specified resource.
     */
    public function show($id): JsonResponse
    {
        $question = Question::with(['quiz.user.institution', 'deletedBy'])->withTrashed()->find($id);

        if (! $question) {
            return $this->notFoundResponse([], __('Question not found.'));
        }

        return $this->okResponse(['question' => $question], __('Question retrieved successfully.'));
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(UpdateRequest $request, $id): JsonResponse
    {
        DB::beginTransaction();
        $validatedData = $request->validated();
        try {
            // Find the question by ID
            $question = Question::find($id);

            if (! $question) {
                return $this->notFoundResponse([], __('Question not found.'));
            }

            // Quiz-attached questions are immutable
            if (is_null($question->quiz_id)) {
                return $this->forbiddenResponse([], __('Quiz questions are immutable. Edit a bank copy instead.'));
            }

            // Only the quiz owner may change its questions (they also can't be moved into another's quiz).
            if (! $this->ownsQuestion($question) || ! $this->ownsQuizzes([$validatedData['quiz_id'] ?? null])) {
                DB::rollBack();

                return $this->forbiddenResponse([], __('You do not have permission to modify this question.'));
            }

            // The old image stays in the owner's My Files library.
            $uploadedFile = $request->file('source_content_url');

            // Use the trait method to upload file
            if ($uploadedFile) {

                $filePath = $this->uploadFile($uploadedFile, 'questions');
                $validatedData['source_content_url'] = $filePath;
            }

            // Update the question
            $question->update($validatedData);
            // Commit the transaction
            DB::commit();

            // Return the updated question
            return $this->okResponse(['question' => $question], __('Question updated successfully.'));
        } catch (Exception $e) {
            // Rollback the transaction in case of error
            DB::rollBack();
            // Log the error message
            Log::error('Error updating question: ' . $e->getMessage());

            // Return an error response
            return $this->serverErrorResponse([], __('Failed to update question.'));
        }
    }

    /**
     * A quiz question belongs to whoever owns its quiz; a bank question to its owner.
     */
    private function ownsQuestion(Question $question): bool
    {
        $userId = (int) auth()->id();

        return $question->quiz_id !== null
            ? (int) Quiz::whereKey($question->quiz_id)->value('user_id') === $userId
            : (int) $question->owner_id === $userId;
    }

    /**
     * Whether every given quiz id (nulls ignored) is one of the caller's own quizzes.
     */
    private function ownsQuizzes(iterable $quizIds): bool
    {
        $ids = collect($quizIds)->filter()->map(fn ($id) => (int) $id)->unique();

        return $ids->isEmpty()
            || Quiz::whereIn('id', $ids)->where('user_id', auth()->id())->count() === $ids->count();
    }

    /**
     * Update multiple resources in storage.
     */
    public function updateMultiple(UpdateMultipleRequest $request): JsonResponse
    {
        // Only questions of the caller's own quizzes (or their own bank items) may
        // be changed, and none may be moved into someone else's quiz. Checked for
        // every row before anything is written, so a refused request changes nothing.
        $rows = collect($request->input('questions', []));
        $existing = Question::whereIn('id', $rows->pluck('id')->filter()->all())->get();
        if ($existing->contains(fn (Question $question) => ! $this->ownsQuestion($question))) {
            return $this->forbiddenResponse([], __('You do not have permission to modify one or more of these questions.'));
        }
        if (! $this->ownsQuizzes($rows->pluck('quiz_id'))) {
            return $this->forbiddenResponse([], __('You do not have permission to move questions into that quiz.'));
        }

        DB::beginTransaction();
        try {
            // Update multiple questions
            $questions = [];

            foreach ($request->input('questions') as $questionData) {
                $question = Question::find($questionData['id']);

                if (! $question) {
                    return $this->notFoundResponse([], __('Question not found.'));
                }

                // if (is_null($question->quiz_id)) {
                //     DB::rollBack();

                //     return $this->forbiddenResponse([], __('One or more quiz questions are immutable. Edit a bank copy instead.'));
                // }

                // The old image is left alone: question images live in the owner's
                // My Files library and may be used by other questions.
                $uploadedFile = $request->file('source_content_url');

                // Use the trait method to upload file
                if ($uploadedFile) {

                    $filePath = $this->uploadFile($uploadedFile, 'questions');
                    $questionData['source_content_url'] = $filePath;
                }

                $question->update($questionData);
                $questions[] = $question;
            }

            // "Add question" creates a blank row ("." with no options) straight away. The
            // editor saves every question it shows, so a blank row of these quizzes that
            // isn't in this save was abandoned: remove it so it isn't counted or played.
            $savedIds = collect($questions)->pluck('id');
            Question::whereIn('quiz_id', collect($questions)->pluck('quiz_id')->filter()->unique())
                ->whereNotIn('id', $savedIds)
                ->blank()
                ->delete();

            // Commit the transaction
            DB::commit();

            // Return the updated questions
            return $this->okResponse(['questions' => $questions], __('Questions updated successfully.'));
        } catch (Exception $e) {
            // Rollback the transaction in case of error
            DB::rollBack();
            // Log the error message
            Log::error('Error updating questions: ' . $e->getMessage());

            // Return an error response
            return $this->serverErrorResponse([], __('Failed to update questions.'));
        }
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy($id): JsonResponse
    {
        DB::beginTransaction();
        try {
            // Find the question by ID
            $question = Question::find($id);

            if (! $question) {
                return $this->notFoundResponse([], __('Question not found.'));
            }

            // if (! is_null($question->quiz_id)) {
            //     return $this->forbiddenResponse([], __('Quiz questions cannot be deleted.'));
            // }

            if (! $this->ownsQuestion($question)) {
                return $this->forbiddenResponse([], __('You do not have permission to delete this question.'));
            }

            // Its image stays in the owner's My Files library (other questions may use it).

            // Soft delete the question
            $question->delete();
            // Commit the transaction
            DB::commit();

            // Return a success response
            return $this->okResponse([], __('Question deleted successfully.'));
        } catch (Exception $e) {
            // Rollback the transaction in case of error
            DB::rollBack();
            // Log the error message
            Log::error('Error deleting question: ' . $e->getMessage());

            // Return an error response
            return $this->serverErrorResponse([], __('Failed to delete question.'));
        }
    }

    /**
     * Remove multiple resources from storage.
     */
    public function destroyMultiple(Request $request): JsonResponse
    {
        DB::beginTransaction();
        try {
            // Soft delete multiple questions
            $questionIds = $request->input('ids');

            if (empty($questionIds)) {
                return $this->badRequestResponse([], __('No question IDs provided.'));
            }

            // Find the questions by IDs
            $questions = Question::whereIn('id', $questionIds)->get();

            foreach ($questions as $question) {
                // if (! is_null($question->quiz_id)) {
                //     DB::rollBack();

                //     return $this->forbiddenResponse([], __('One or more quiz questions cannot be deleted.'));
                // }
                if (! $this->ownsQuestion($question)) {
                    DB::rollBack();

                    return $this->forbiddenResponse([], __('You do not have permission to delete one or more of these questions.'));
                }
                // Images stay in the owner's My Files library.
            }

            Question::whereIn('id', $questionIds)->delete();
            // Commit the transaction
            DB::commit();

            // Return a success response
            return $this->okResponse([], __('Questions deleted successfully.'));
        } catch (Exception $e) {
            // Rollback the transaction in case of error
            DB::rollBack();
            // Log the error message
            Log::error('Error deleting questions: ' . $e->getMessage());

            // Return an error response
            return $this->serverErrorResponse([], __('Failed to delete questions.'));
        }
    }

    /**
     * Restore the specified resource from storage.
     */
    public function restore($id): JsonResponse
    {
        DB::beginTransaction();
        try {
            // Find the question by ID
            $question = Question::withTrashed()->find($id);

            if (! $question) {
                return $this->notFoundResponse([], __('Question not found.'));
            }

            if (! is_null($question->quiz_id)) {
                return $this->forbiddenResponse([], __('Quiz questions cannot be restored once deleted.'));
            }

            if (is_null($question->quiz_id) && $question->owner_id !== auth()->id()) {
                return $this->forbiddenResponse([], __('You do not have permission to restore this bank question.'));
            }

            // Restore the question
            $question->restore();
            // Commit the transaction
            DB::commit();

            // Return a success response
            return $this->okResponse([], __('Question restored successfully.'));
        } catch (Exception $e) {
            // Rollback the transaction in case of error
            DB::rollBack();
            // Log the error message
            Log::error('Error restoring question: ' . $e->getMessage());

            // Return an error response
            return $this->serverErrorResponse([], __('Failed to restore question.'));
        }
    }

    public function restoreMultiple(Request $request): JsonResponse
    {
        DB::beginTransaction();
        try {
            // Restore multiple questions
            $questionIds = $request->input('ids');

            if (empty($questionIds)) {
                return $this->badRequestResponse([], __('No question IDs provided.'));
            }

            $toRestore = Question::withTrashed()->whereIn('id', $questionIds)->get();
            foreach ($toRestore as $q) {
                if (! is_null($q->quiz_id)) {
                    DB::rollBack();

                    return $this->forbiddenResponse([], __('One or more quiz questions cannot be restored.'));
                }
                if (is_null($q->quiz_id) && $q->owner_id !== auth()->id()) {
                    DB::rollBack();

                    return $this->forbiddenResponse([], __('You do not have permission to restore one or more bank questions.'));
                }
            }
            Question::withTrashed()->whereIn('id', $questionIds)->restore();
            // Commit the transaction
            DB::commit();

            // Return a success response
            return $this->okResponse([], __('Questions restored successfully.'));
        } catch (Exception $e) {
            // Rollback the transaction in case of error
            DB::rollBack();
            // Log the error message
            Log::error('Error restoring questions: ' . $e->getMessage());

            // Return an error response
            return $this->serverErrorResponse([], __('Failed to restore questions.'));
        }
    }

    /**
     * Clone a public question into the authenticated user's bank/category.
     */
    /* public function cloneToMyBank(CloneToBankRequest $request): JsonResponse
    {
        DB::beginTransaction();
        try {
            $data = $request->validated();
            $source = Question::find($data['question_id']);

            if (! $source || $source->visibility !== 'public') {
                return $this->forbiddenResponse([], __('Only public questions can be cloned.'));
            }

            // Determine destination category
            $categoryId = $data['q_bank_category_id'] ?? null;
            if (! $categoryId) {
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
                $categoryId = $rootCategory->id;
            }

            // Create cloned bank record under user's ownership and target category
            $clone = BankQuestion::create([
                'q_bank_category_id' => $categoryId,
                'owner_id' => auth()->id(),
                'question_text' => $source->question_text,
                'question_type' => $source->question_type,
                'time_limit_seconds' => $source->time_limit_seconds,
                'points' => $source->points,
                'is_ai_generated' => $source->is_ai_generated,
                'source_content_url' => $source->getRawOriginal('source_content_url'),
                'visibility' => 'private',
                'options' => $source->options,
            ]);

            DB::commit();

            return $this->createdResponse(['question' => $clone], __('Question cloned to your bank.'));
        } catch (Exception $e) {
            DB::rollBack();
            Log::error('Error cloning question to bank: ' . $e->getMessage());

            return $this->serverErrorResponse([], __('Failed to clone question.'));
        }
    } */

    /**
     * Copy a quiz question into the authenticated user's bank.
     */
    public function addToBank(CopyToBankRequest $request, int $id): JsonResponse
    {
        DB::beginTransaction();
        try {
            $source = Question::find($id);
            if (! $source) {
                return $this->notFoundResponse([], __('Question not found.'));
            }

            $data = $request->validated();

            // Determine target category (user root if not provided)
            $categoryId = $data['q_bank_category_id'] ?? null;
            if (! $categoryId) {
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
                $categoryId = $rootCategory->id;
            }

            $bank = new BankQuestion([
                'q_bank_category_id' => $categoryId,
                'owner_id' => auth()->id(),
                'question_text' => $source->question_text,
                'question_type' => $source->question_type,
                'time_limit_seconds' => $source->time_limit_seconds,
                'points' => $source->points,
                'is_ai_generated' => $source->is_ai_generated,
                'source_content_url' => $source->getRawOriginal('source_content_url'),
                'visibility' => 'private',
                'options' => $source->options,
            ]);
            $bank->save();

            DB::commit();

            return $this->createdResponse(['question' => $bank], __('Question copied to your bank.'));
        } catch (Exception $e) {
            DB::rollBack();
            Log::error('Error copying question to bank: ' . $e->getMessage());

            return $this->serverErrorResponse([], __('Failed to copy question to bank.'));
        }
    }
}
