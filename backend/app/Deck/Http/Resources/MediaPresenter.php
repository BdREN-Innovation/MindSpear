<?php

namespace App\Deck\Http\Resources;

use App\Models\File;
use DateTimeInterface;
use Illuminate\Support\Carbon;
use stdClass;

/**
 * A My Files row as the deck API shows it next to a *_file_id (deck cover,
 * slide media, option image). The relations load files withTrashed, so a
 * file the owner removed from My Files still shows (`inLibrary` false).
 */
class MediaPresenter
{
    /** @return array{fileId:int, url:string, name:?string, mime:?string, category:?string, width:?int, height:?int, size:int, inLibrary:bool}|null */
    public static function file(?File $file): ?array
    {
        if (! $file) {
            return null;
        }

        return [
            'fileId' => (int) $file->id,
            'url' => $file->url,
            'name' => $file->name,
            'mime' => $file->mime_type,
            'category' => $file->category,
            'width' => $file->width,
            'height' => $file->height,
            'size' => (int) $file->size,
            'inLibrary' => ! $file->trashed(),
        ];
    }

    /** JSON object for a JSONB column: `{}` rather than `[]` when empty. */
    public static function object(?array $value): array|object
    {
        return $value === null || $value === [] ? new stdClass() : $value;
    }

    public static function iso(?DateTimeInterface $value): ?string
    {
        return $value ? Carbon::instance($value)->toIso8601String() : null;
    }
}
