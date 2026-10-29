<?php

namespace App\Deck\Http\Requests\Authoring;

use App\Deck\Authoring\SlideAuthoringService;
use App\Http\Requests\BaseFormRequest;

/**
 * POST /quests/{deck}/slides/reorder: {slides: [{id, position}, ...]} or
 * the bare list. Must name every live slide of the deck exactly once.
 */
class ReorderSlidesRequest extends BaseFormRequest
{
    use ReadsRawJson;
    use RejectsInvalidUtf8;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->wrapListBody();
    }

    public function rules(): array
    {
        return [
            'slides' => ['required', 'array', 'list', 'min:1', 'max:' . SlideAuthoringService::maxSlides()],
            'slides.*' => ['required', 'array'],
            'slides.*.id' => ['required', 'integer', 'min:1', 'distinct'],
            'slides.*.position' => ['required', 'integer', 'min:1', 'max:100000', 'distinct'],
        ];
    }
}
