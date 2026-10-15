<?php

namespace App\Deck\Slides\Types\Content;

/**
 * `numbered`: a numbered list (numbering is rendered by the frontend).
 *
 * Config: {items: list<string> (1..20 entries, each single-line ≤200, may be '')}.
 * Answer payload: none (validateAnswer always throws). Aggregate: [].
 */
class NumberedSlideType extends BulletsSlideType
{
    public function key(): string
    {
        return 'numbered';
    }
}
