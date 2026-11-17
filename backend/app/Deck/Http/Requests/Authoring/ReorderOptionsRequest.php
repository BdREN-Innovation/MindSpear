<?php

namespace App\Deck\Http\Requests\Authoring;

use App\Deck\Support\OptionLimits;
use App\Http\Requests\BaseFormRequest;

/**
 * POST /quests/{deck}/slides/{slide}/options/reorder: [{id, position}, ...] with positions 1..n
 * or {options: [...]}. Positions are 1-based (like stored positions): together they
 * must be exactly 1..n (each once). The service checks that the ids are
 * every option of the slide.
 */
class ReorderOptionsRequest extends BaseFormRequest
{
    use RejectsInvalidUtf8;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $json = $this->isJson() ? $this->json()->all() : [];

        if ($json !== [] && array_is_list($json)) {
            $this->json()->replace(['options' => $json]);
        }
    }

    public function rules(): array
    {
        $items = $this->input('options');
        $last = max(1, is_array($items) ? count($items) : 0);

        return [
            'options' => ['required', 'array', 'list', 'min:1', 'max:' . OptionLimits::ceiling()],
            'options.*' => ['required', 'array'],
            'options.*.id' => ['required', 'integer', 'min:1', 'distinct'],
            // 1-based like stored/returned positions and slide reorder; min 1, max n and distinct: exactly 1..n.
            'options.*.position' => ['required', 'integer', 'min:1', 'max:' . $last, 'distinct'],
        ];
    }

    /** @return list<array{id:int, position:int}> */
    public function items(): array
    {
        return array_map(
            fn (array $item) => ['id' => (int) $item['id'], 'position' => (int) $item['position']],
            array_values($this->validated()['options']),
        );
    }
}
