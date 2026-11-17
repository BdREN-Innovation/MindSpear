<?php

namespace App\Modules\FunGame\Http\Requests;

use App\Http\Requests\BaseFormRequest;

class StartSessionRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // Omit to open the lobby now; the host starts it with /start.
            'startsAt' => 'nullable|date|after:now',
        ];
    }
}
