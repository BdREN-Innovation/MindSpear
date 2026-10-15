<?php

namespace App\Deck\Http\Requests;

use App\Http\Requests\BaseFormRequest;

/**
 * Body of PUT .../cover and PUT .../options/{option}/image:
 * {file_id: int} attaches a My Files image, {file_id: null} removes it.
 * Ownership and kind are checked by DeckMediaService.
 */
class AttachMediaFileRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // `numeric` keeps JSON booleans out (`integer` alone reads true as 1).
            'file_id' => ['present', 'nullable', 'integer', 'numeric', 'min:1'],
        ];
    }

    public function messages(): array
    {
        return [
            'file_id.present' => 'Send file_id: a My Files id, or null to remove the image.',
        ];
    }

    public function fileId(): ?int
    {
        $id = $this->validated('file_id');

        return $id === null ? null : (int) $id;
    }
}
