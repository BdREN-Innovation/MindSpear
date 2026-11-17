<?php

namespace App\Modules\FunGame\Http\Requests;

use App\Http\Requests\BaseFormRequest;

class JoinSessionRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'name' => is_string($this->name) ? trim($this->name) : $this->name,
            'email' => is_string($this->email) ? trim($this->email) : $this->email,
        ]);
    }

    public function rules(): array
    {
        return [
            'name' => 'required|string|min:1|max:60',
            'email' => 'required|string|email|max:190',
        ];
    }
}
