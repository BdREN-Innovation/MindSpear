<?php

namespace App\Deck\Http\Requests\Authoring;

use App\Deck\Authoring\SlideInput;
use App\Http\Requests\BaseFormRequest;

/**
 * POST (add, appended at the end) and PATCH (edit) of a slide option:
 * {label?: ?string, payload?: ?object}; quiz routes also {is_correct?: ?bool}.
 */
class OptionRequest extends BaseFormRequest
{
    use QuizFields;
    use RejectsInvalidUtf8;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'label' => ['sometimes', 'nullable', 'string', 'max:' . SlideInput::MAX_LABEL],
            'payload' => ['sometimes', 'nullable', 'array'],
            ...$this->correctRules(),
        ];
    }

    public function messages(): array
    {
        return $this->quizMessages('', '');
    }
}
