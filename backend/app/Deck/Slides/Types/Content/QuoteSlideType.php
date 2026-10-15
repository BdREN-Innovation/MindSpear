<?php

namespace App\Deck\Slides\Types\Content;

/**
 * `quote`: a large quote with optional attribution.
 *
 * Config: {text: string (multi-line, ≤500, may be ''), attribution: ?string (≤120)}.
 * Answer payload: none (validateAnswer always throws). Aggregate: [].
 */
class QuoteSlideType extends ContentSlideType
{
    public const MAX_TEXT = 500;

    public const MAX_ATTRIBUTION = 120;

    public function key(): string
    {
        return 'quote';
    }

    public function defaultConfig(): array
    {
        return ['text' => '', 'attribution' => null];
    }

    protected function normaliseConfig(array $config): array
    {
        return [
            'text' => $this->text($config['text'], 'text', self::MAX_TEXT, multiline: true),
            'attribution' => $this->text($config['attribution'], 'attribution', self::MAX_ATTRIBUTION, nullable: true),
        ];
    }
}
