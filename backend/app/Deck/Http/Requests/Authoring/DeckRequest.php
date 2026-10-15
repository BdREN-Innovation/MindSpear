<?php

namespace App\Deck\Http\Requests\Authoring;

use App\Deck\Authoring\DeckAuthoringService;
use App\Deck\Authoring\DeckSettings;
use App\Http\Requests\BaseFormRequest;

/**
 * POST /quests/v2 (everything optional; title defaults to "Untitled quest")
 * and PATCH /quests/v2/{deck} (partial). Settings: see DeckSettings.
 */
class DeckRequest extends BaseFormRequest
{
    use RejectsInvalidUtf8;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $title = $this->isMethod('post') ? ['sometimes', 'nullable'] : ['sometimes', 'required'];

        return [
            'title' => [...$title, 'string', 'max:' . DeckAuthoringService::MAX_TITLE],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            ...DeckSettings::rules(),
        ];
    }

    public function messages(): array
    {
        return DeckSettings::messages();
    }
}
