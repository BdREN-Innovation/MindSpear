<?php

namespace App\Deck\Slides\Types\Content;

/**
 * `image`: an image from My Files with optional caption.
 *
 * The image is attached through slides.media_file_id (never through config)
 * and snapshotted into config.media by withMedia() at session start; it is
 * optional while authoring.
 *
 * Config (author): {caption: ?string (≤200), alt: ?string (≤250)}.
 * Snapshot adds: media: ?{file_id:int, url:string (File::url), width:?int, height:?int,
 *                        mime: image/jpeg|png|gif|webp}.
 * Answer payload: none (validateAnswer always throws). Aggregate: [].
 */
class ImageSlideType extends ContentSlideType
{
    public const MAX_CAPTION = 200;

    public const MAX_ALT = 250;

    public function key(): string
    {
        return 'image';
    }

    public function defaultConfig(): array
    {
        return ['caption' => null, 'alt' => null];
    }

    protected function mediaMimes(): array
    {
        return self::IMAGE_MIMES;
    }

    protected function normaliseConfig(array $config): array
    {
        return [
            'caption' => $this->text($config['caption'], 'caption', self::MAX_CAPTION, nullable: true),
            'alt' => $this->text($config['alt'], 'alt', self::MAX_ALT, nullable: true),
        ];
    }
}
