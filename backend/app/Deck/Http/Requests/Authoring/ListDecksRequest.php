<?php

namespace App\Deck\Http\Requests\Authoring;

use App\Deck\Authoring\DeckAuthoringService;
use App\Http\Requests\BaseFormRequest;

/** GET /quests/v2?search=&sort=updated|created|title&direction=asc|desc&per_page=&page= */
class ListDecksRequest extends BaseFormRequest
{
    use RejectsInvalidUtf8;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'sort' => ['sometimes', 'nullable', 'string', 'in:' . implode(',', array_keys(DeckAuthoringService::SORTS))],
            'direction' => ['sometimes', 'nullable', 'string', 'in:asc,desc'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:50'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
        ];
    }
}
