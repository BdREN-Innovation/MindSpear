<?php

namespace App\Modules\FileLibrary\Http\Requests;

use App\Http\Requests\BaseFormRequest;

/** Type, size and quota are checked by FileStorageService, which gives friendlier messages. */
class UploadRequest extends BaseFormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $maxKb = max(
            (int) config('file_library.max_image_mb'),
            (int) config('file_library.max_document_mb'),
            (int) config('file_library.max_video_mb'),
        ) * 1024;

        return [
            'file' => 'required|file|max:' . $maxKb,
            'name' => 'nullable|string|max:255',
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'Choose a file to upload.',
            'file.uploaded' => 'The upload failed. The file may be larger than the server allows.',
            'file.max' => 'This file is too large.',
        ];
    }
}
