<?php

namespace App\Deck\Slides\Types\Quiz;

/**
 * True or false (scored): one statement, two answers. A Pick answer with
 * exactly two options seeded "True" and "False"; authors may relabel them
 * (Yes / No, Fact / Myth). One of them is marked correct.
 *
 * Config:  {} (the session snapshot adds `scoring`).
 * Options: exactly 2 (config/deck.php option_limits), label (and image);
 *          the correct one: slide_options.is_correct. Seeded unmarked.
 * Slide defaults: 20 s, 50/100 points, speed bonus on.
 *
 * Players always pick one (config.multiple_answers is always false):
 * Answer payload (in / stored): {option_id: int}.
 * Score: full points when the picked option is correct, else 0.
 * Aggregate: as pick_answer_single.
 */
class TrueFalseSlideType extends PickAnswerSingleSlideType
{
    public const KEY = 'true_false';

    public function key(): string
    {
        return self::KEY;
    }

    public function defaultOptions(): array
    {
        return [
            ['label' => 'True', 'payload' => []],
            ['label' => 'False', 'payload' => []],
        ];
    }

    /** One answer is right, even if an author marked both. */
    public function multipleAnswers(array $options): bool
    {
        return false;
    }
}
