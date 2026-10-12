<?php

namespace App\Modules\FunGame\Http\Requests;

use App\Http\Requests\BaseFormRequest;

class SubmitAnswerRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'questionId' => 'required|integer',
            // null skips the question
            'optionId' => 'present|nullable|string|max:32',
            // informational only; the server's own time decides
            'clientSubmittedAt' => 'nullable|string|max:40',
        ];
    }
}
