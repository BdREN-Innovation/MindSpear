<?php

namespace App\Deck\Slides;

use App\Models\File;

/**
 * A slide type whose `config.media` is server-owned (plan §1.1, §1.9).
 * Authors attach a My Files row through slides.media_file_id, never through
 * config: validateConfig() drops any incoming `media`, and only withMedia()
 * puts it back, built from the File model (url from File::url, width/height
 * and mime from the files row).
 *
 * Session start snapshots every slide the same way:
 *   $config = $type instanceof TakesMedia
 *       ? $type->withMedia($slide->config ?? [], $slide->mediaFile)   // mediaFile withTrashed
 *       : ($slide->config ?? []);
 * then checks requiresMedia()/assertMediaPresent() where a type has them
 * (pin_on_image).
 */
interface TakesMedia
{
    /**
     * $config with `media` = {file_id, url, width, height, mime} for $file, or
     * `media` = null when $file is null. Types that take no media return the
     * config unchanged for a null file.
     *
     * @throws \Illuminate\Validation\ValidationException keyed `media` when the
     *                                                    file's kind does not fit the type
     */
    public function withMedia(array $config, ?File $file): array;
}
