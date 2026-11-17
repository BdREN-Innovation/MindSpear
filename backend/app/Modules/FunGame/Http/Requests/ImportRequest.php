<?php

namespace App\Modules\FunGame\Http\Requests;

use App\Http\Requests\BaseFormRequest;
use App\Modules\FunGame\Services\ImportService;
use App\Modules\FunGame\Services\TimerService;

/** Each question is checked by ImportService and reported per row, not here. */
class ImportRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'source' => 'required|in:json,library_quiz',
            'quizId' => 'required_if:source,library_quiz|nullable|integer',
            'questions' => 'required_if:source,json|nullable|array|max:' . ImportService::MAX_QUESTIONS,
            'mode' => 'required|in:append,replace',
            'dryRun' => 'sometimes|boolean',
            // Only sent when the host ticked "use the file's timer".
            'timer' => 'nullable|array',
            'timer.mode' => 'required_with:timer|in:total,perQuestion',
            'timer.totalSeconds' => 'required_if:timer.mode,total|nullable|integer|min:' . TimerService::TOTAL_MIN . '|max:' . TimerService::TOTAL_MAX,
            'timer.allowNavigation' => 'sometimes|boolean',
            'timer.secondsPerQuestion' => 'required_if:timer.mode,perQuestion|nullable|integer|min:' . TimerService::PER_QUESTION_MIN . '|max:' . TimerService::PER_QUESTION_MAX,
            // Rows the host unticked in the preview, kept for the summary only.
            'skipped' => 'sometimes|array|max:' . ImportService::MAX_QUESTIONS,
        ];
    }
}
