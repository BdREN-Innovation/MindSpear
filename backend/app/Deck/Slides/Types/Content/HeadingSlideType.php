<?php

namespace App\Deck\Slides\Types\Content;

/**
 * `heading`: a title with an optional subtitle.
 *
 * The title is the slide's own `title` column (run title_snapshot, sent as
 * the top-level `title`), the same headline every other type uses, so the
 * slide rail, thumbnail and canvas never disagree. Config only holds the
 * subtitle; an incoming `config.title` is dropped like any unknown key.
 *
 * Config: {subtitle: ?string (≤250)}.
 * Answer payload: none (validateAnswer always throws). Aggregate: [].
 */
class HeadingSlideType extends ContentSlideType
{
    public const MAX_SUBTITLE = 250;

    public function key(): string
    {
        return 'heading';
    }

    public function defaultConfig(): array
    {
        return ['subtitle' => null];
    }

    protected function normaliseConfig(array $config): array
    {
        return [
            'subtitle' => $this->text($config['subtitle'], 'subtitle', self::MAX_SUBTITLE, nullable: true),
        ];
    }
}
