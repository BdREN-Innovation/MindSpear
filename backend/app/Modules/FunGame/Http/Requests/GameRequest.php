<?php

namespace App\Modules\FunGame\Http\Requests;

use App\Http\Requests\BaseFormRequest;
use App\Modules\FunGame\Services\TimerService;

/** Create (POST) or partially update (PATCH) a game. */
class GameRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $title = $this->isMethod('post') ? 'required' : 'sometimes|required';

        return [
            'title' => "{$title}|string|max:200",
            'description' => 'sometimes|nullable|string|max:2000',
            'instructions' => 'sometimes|nullable|string|max:4000',
            'timer' => 'sometimes|array',
            'timer.mode' => 'required_with:timer|in:total,perQuestion',
            'timer.totalSeconds' => 'required_if:timer.mode,total|nullable|integer|min:' . TimerService::TOTAL_MIN . '|max:' . TimerService::TOTAL_MAX,
            'timer.secondsPerQuestion' => 'required_if:timer.mode,perQuestion|nullable|integer|min:' . TimerService::PER_QUESTION_MIN . '|max:' . TimerService::PER_QUESTION_MAX,
            'timer.overrides' => 'sometimes|array',
            'timer.overrides.*' => 'nullable|integer|min:' . TimerService::PER_QUESTION_MIN . '|max:' . TimerService::PER_QUESTION_MAX,
            'scoringMode' => 'sometimes|in:marks,speed',
            'shuffleQuestions' => 'sometimes|boolean',
            // null = every player answers all questions.
            'questionsPerPlayer' => 'sometimes|nullable|integer|min:1|max:500',
            'questionSelection' => 'sometimes|in:same,different',
            'defaultMarks' => 'sometimes|numeric|min:0|max:1000',
            'defaultNegativeMarks' => 'sometimes|numeric|min:0|max:1000',
        ];
    }

    public function messages(): array
    {
        return [
            'timer.totalSeconds.min' => 'The quiz timer must be at least 1 minute.',
            'timer.totalSeconds.max' => 'The quiz timer can be at most 6 hours.',
            'timer.secondsPerQuestion.min' => 'Each question needs at least 5 seconds.',
            'timer.secondsPerQuestion.max' => 'Each question can have at most 600 seconds.',
        ];
    }
}
