<?php

namespace App\Deck\Http\Requests\Authoring;

use App\Deck\Authoring\SlideInput;
use App\Http\Requests\BaseFormRequest;

/**
 * PATCH /quests/{deck}/slides/{slide}: any of title, body, config,
 * time_limit_seconds, get_ready_seconds; on quiz routes also points_min,
 * points_max, speed_bonus_enabled (QuizFields). Type-specific checks (config via
 * validateConfig, body via the type's validateBody) run in the service.
 */
class UpdateSlideRequest extends BaseFormRequest
{
    use QuizFields;
    use ReadsRawJson;
    use RejectsInvalidUtf8;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'title' => ['sometimes', 'nullable', 'string', 'max:' . SlideInput::MAX_TITLE],
            'body' => ['sometimes', 'nullable', 'array'],
            'config' => ['sometimes', 'array'],
            'time_limit_seconds' => ['sometimes', 'nullable', 'integer', 'min:' . SlideInput::MIN_TIME_LIMIT, 'max:' . SlideInput::MAX_TIME_LIMIT],
            'get_ready_seconds' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:' . SlideInput::MAX_GET_READY],
            ...$this->scoringRules(),
        ];
    }

    public function messages(): array
    {
        return $this->quizMessages();
    }

    /** validated(), with `body` as sent (untrimmed). */
    public function changes(): array
    {
        $data = $this->validated();

        if (array_key_exists('body', $data)) {
            $data['body'] = $this->raw('body');
        }

        return $data;
    }
}
