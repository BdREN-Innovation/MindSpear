<?php

namespace App\Modules\FunGame\Http\Requests;

use App\Http\Requests\BaseFormRequest;

class CreateFromLibraryRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'quizId' => 'required|integer',
            'timerMode' => 'sometimes|in:total,perQuestion',
        ];
    }
}
