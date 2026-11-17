<?php

namespace App\Deck\Slides;

use InvalidArgumentException;

class UnknownSlideType extends InvalidArgumentException
{
    public static function forKey(string $key): self
    {
        return new self("Unknown slide type [{$key}].");
    }
}
