<?php

namespace App\Deck\Http\Requests\Authoring;

use App\Deck\Authoring\DeckAuthoringService;
use App\Deck\Authoring\DeckSettings;
use App\Http\Requests\BaseFormRequest;
use App\Models\Deck\Deck;

/**
 * POST /quests (everything optional; title defaults to "Untitled quest")
 * and PATCH /quests/{deck} (partial). Settings: see DeckSettings.
 * visibility: 'private' (default) | 'public' (listed in Discover).
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
            'visibility' => ['sometimes', 'required', 'string', 'in:' . implode(',', Deck::VISIBILITIES)],
            ...DeckSettings::rules(),
        ];
    }

    public function messages(): array
    {
        return DeckSettings::messages() + [
            'visibility.in' => 'Visibility must be private or public.',
        ];
    }
}
