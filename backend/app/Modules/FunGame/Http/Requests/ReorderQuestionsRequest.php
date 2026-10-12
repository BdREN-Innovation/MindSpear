<?php

namespace App\Modules\FunGame\Http\Requests;

use App\Http\Requests\BaseFormRequest;

class ReorderQuestionsRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'questionIds' => 'required|array|min:1',
            'questionIds.*' => 'required|integer|distinct',
        ];
    }
}
