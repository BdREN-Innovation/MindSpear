<?php

namespace App\Deck\Slides\Types\Content;

/**
 * `big_text`: one big phrase, used as a section break.
 *
 * Config: {text: string (single-line, ≤80, may be '')}.
 * Answer payload: none (validateAnswer always throws). Aggregate: [].
 */
class BigTextSlideType extends ContentSlideType
{
    public const MAX_TEXT = 80;

    public function key(): string
    {
        return 'big_text';
    }

    public function defaultConfig(): array
    {
        return ['text' => ''];
    }

    protected function normaliseConfig(array $config): array
    {
        return [
            'text' => $this->text($config['text'], 'text', self::MAX_TEXT),
        ];
    }
}
