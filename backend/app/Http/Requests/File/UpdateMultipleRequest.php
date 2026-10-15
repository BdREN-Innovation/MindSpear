<?php

namespace App\Http\Requests\File;

use App\Http\Requests\BaseFormRequest;

class UpdateMultipleRequest extends BaseFormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'files' => 'required|array|max:20',
            'files.*.id' => 'required|integer',
            'files.*.file' => 'required|file|max:' . StoreRequest::maxKilobytes(),
        ];
    }
}
