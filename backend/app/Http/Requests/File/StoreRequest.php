<?php

namespace App\Http\Requests\File;

use App\Http\Requests\BaseFormRequest;

/** Type, size and quota are checked by the file library (FileStorageService). */
class StoreRequest extends BaseFormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'name' => 'nullable|string|max:255',
            'file' => 'required|file|max:' . self::maxKilobytes(),
        ];
    }

    /**
     * The largest file any library category takes (videos are the biggest), so
     * this pre-check never refuses an upload FileStorageService would accept;
     * the per-category limit is applied there with a friendlier message.
     */
    public static function maxKilobytes(): int
    {
        return max(
            (int) config('file_library.max_image_mb'),
            (int) config('file_library.max_document_mb'),
            (int) config('file_library.max_video_mb'),
        ) * 1024;
    }
}
