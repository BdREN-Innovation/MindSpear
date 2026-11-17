<?php

namespace App\Deck\Slides\Types\Quiz;

/**
 * How right one answer is, before points: $credit is the share of the
 * points it earns (0..1), $correct whether it is fully correct. Not a slide
 * type, so discovery skips it.
 */
final readonly class Evaluation
{
    public function __construct(
        public float $credit,
        public bool $correct,
    ) {}

    public static function wrong(): self
    {
        return new self(0.0, false);
    }

    public static function right(): self
    {
        return new self(1.0, true);
    }

    /** $hits of $total right; fully correct only when all are. */
    public static function ratio(int $hits, int $total): self
    {
        if ($total <= 0 || $hits <= 0) {
            return self::wrong();
        }

        $hits = min($hits, $total);

        return new self($hits / $total, $hits === $total);
    }
}
