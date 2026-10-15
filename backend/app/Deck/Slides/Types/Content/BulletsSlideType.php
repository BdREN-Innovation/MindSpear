<?php

namespace App\Deck\Slides\Types\Content;

/**
 * `bullets`: a bullet list.
 *
 * Config: {items: list<string> (1..20 entries, each single-line ≤200, may be '')}.
 * Answer payload: none (validateAnswer always throws). Aggregate: [].
 */
class BulletsSlideType extends ContentSlideType
{
    public const MIN_ITEMS = 1;

    public const MAX_ITEMS = 20;

    public const MAX_ITEM_LENGTH = 200;

    public function key(): string
    {
        return 'bullets';
    }

    public function defaultConfig(): array
    {
        return ['items' => ['']];
    }

    protected function normaliseConfig(array $config): array
    {
        return [
            'items' => $this->items($config['items'], 'items', self::MIN_ITEMS, self::MAX_ITEMS, self::MAX_ITEM_LENGTH),
        ];
    }
}
