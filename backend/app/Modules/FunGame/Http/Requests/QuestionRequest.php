<?php

namespace App\Modules\FunGame\Http\Requests;

use App\Http\Requests\BaseFormRequest;
use App\Modules\FunGame\Services\TimerService;
use Illuminate\Validation\Validator;

class QuestionRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'type' => 'sometimes|in:single_choice',
            'text' => 'required|string|max:2000',
            'imageUrl' => 'nullable|url|max:2048',
            'options' => 'required|array|min:2|max:10',
            'options.*.id' => 'required|string|max:32|distinct',
            'options.*.text' => 'required|string|max:500',
            'correctOptionId' => 'required|string|max:32',
            'marks' => 'nullable|numeric|min:0|max:1000',
            'negativeMarks' => 'nullable|numeric|min:0|max:1000',
            'secondsOverride' => 'nullable|integer|min:' . TimerService::PER_QUESTION_MIN . '|max:' . TimerService::PER_QUESTION_MAX,
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                $ids = collect($this->input('options', []))->pluck('id')->all();
                if (! in_array($this->input('correctOptionId'), $ids, true)) {
                    $validator->errors()->add('correctOptionId', 'Pick the correct answer from the options.');
                }
            },
        ];
    }
}
