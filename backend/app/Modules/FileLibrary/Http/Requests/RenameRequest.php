<?php

namespace App\Modules\FileLibrary\Http\Requests;

use App\Http\Requests\BaseFormRequest;

class RenameRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => 'required|string|max:255|regex:/\S/',
        ];
    }

    public function messages(): array
    {
        return [
            'name.regex' => 'The name cannot be blank.',
        ];
    }
}
