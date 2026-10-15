<?php

namespace App\Modules\FileLibrary\Http\Resources;

use App\Models\File;

/** Library file payload (camelCase, like the Fun Games API). */
class FilePresenter
{
    public static function file(File $file): array
    {
        return [
            'id' => $file->id,
            'name' => $file->name,
            'originalName' => $file->original_name,
            'category' => $file->category,
            'extension' => $file->extension,
            'mimeType' => $file->mime_type,
            'size' => (int) $file->size,
            'url' => $file->url,
            'isPublic' => $file->visibility !== File::VISIBILITY_PRIVATE,
            'pageCount' => $file->page_count,
            'extractionStatus' => $file->extraction_status,
            'createdAt' => $file->created_at?->toIso8601String(),
            'lastUsedAt' => $file->last_used_at?->toIso8601String(),
        ];
    }
}
