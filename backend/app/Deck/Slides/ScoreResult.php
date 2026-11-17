<?php

namespace App\Deck\Slides;

final readonly class ScoreResult
{
    public function __construct(
        public int $pointsAwarded = 0,
        public ?bool $isCorrect = null,
        public ?float $partialCreditRatio = null,
    ) {}

    /** Unscored (every Quest type). */
    public static function zero(): self
    {
        return new self();
    }
}
