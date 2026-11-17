<?php

namespace App\Deck\Http\Requests\Authoring;

use App\Http\Requests\BaseFormRequest;

/**
 * POST /quests/{deck}/slides: {type, after_position?}. The type is checked
 * against the registry and the route's product by the service (422
 * unsupported_type). after_position null/absent = at the end, 0 = first.
 */
class StoreSlideRequest extends BaseFormRequest
{
    use RejectsInvalidUtf8;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'type' => ['required', 'string', 'max:40'],
            'after_position' => ['sometimes', 'nullable', 'integer', 'min:0'],
        ];
    }
}
