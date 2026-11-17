<?php

namespace App\Deck\Http\Requests;

use App\Http\Requests\BaseFormRequest;
use Illuminate\Validation\Validator;

/**
 * Body of PUT .../slides/{slide}/media, exactly one of:
 * - {file_id: int}     attach a My Files item (image, pin_on_image: image; video: mp4)
 * - {file_id: null}    remove the attached item
 * - {video_url: string} set a video slide's YouTube/Vimeo link (clears an mp4)
 * - {video_url: null}  remove the link
 * The link itself is validated by the video slide type (DeckMediaService).
 */
class AttachSlideMediaRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'file_id' => ['nullable', 'integer', 'numeric', 'min:1'],
            'video_url' => ['nullable', 'string'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                $hasFile = $this->has('file_id');
                if ($hasFile === $this->has('video_url')) {
                    $validator->errors()->add('file_id', $hasFile
                        ? 'Send either file_id or video_url, not both.'
                        : 'Send file_id (a My Files id, or null to remove the media) or video_url.');
                }
            },
        ];
    }

    /** True for a {video_url} body, false for a {file_id} body. */
    public function setsVideoUrl(): bool
    {
        return $this->has('video_url');
    }

    public function fileId(): ?int
    {
        $id = $this->validated('file_id');

        return $id === null ? null : (int) $id;
    }

    public function videoUrl(): ?string
    {
        $url = $this->validated('video_url');

        return $url === null ? null : (string) $url;
    }
}
