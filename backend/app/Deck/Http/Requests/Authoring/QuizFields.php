<?php

namespace App\Deck\Http\Requests\Authoring;

use App\Deck\Authoring\SlideInput;
use App\Deck\Http\DeckRoutes;
use App\Models\Deck\Deck;

/**
 * Quiz-only authoring fields (QUIZ_REDESIGN_PLAN.md "Scoring model"):
 * slides take points_min / points_max (0..1000, min ≤ max checked by the
 * service) and speed_bonus_enabled, options take is_correct. Accepted on
 * quiz routes only; any other product's routes answer 422 on the field.
 */
trait QuizFields
{
    public const QUIZ_ONLY_MESSAGE = 'This field is only available on quiz slides.';

    protected function isQuizRoute(): bool
    {
        return DeckRoutes::productOf($this->route()) === Deck::PRODUCT_QUIZ;
    }

    /** points_min, points_max, speed_bonus_enabled under $prefix (e.g. 'slides.*.'). */
    protected function scoringRules(string $prefix = ''): array
    {
        if (! $this->isQuizRoute()) {
            return array_fill_keys(array_map(fn (string $field) => $prefix . $field, SlideInput::SCORING_FIELDS), ['prohibited']);
        }

        $points = ['sometimes', 'nullable', 'integer', 'min:0', 'max:' . SlideInput::MAX_POINTS];

        return [
            "{$prefix}points_min" => $points,
            "{$prefix}points_max" => $points,
            "{$prefix}speed_bonus_enabled" => ['sometimes', 'nullable', 'boolean'],
        ];
    }

    /** is_correct under $prefix (e.g. 'slides.*.options.*.'). */
    protected function correctRules(string $prefix = ''): array
    {
        return ["{$prefix}is_correct" => $this->isQuizRoute() ? ['sometimes', 'nullable', 'boolean'] : ['prohibited']];
    }

    /** "prohibited" reads as "quiz only". */
    protected function quizMessages(string $scoringPrefix = '', ?string $correctPrefix = null): array
    {
        $messages = [];
        foreach (SlideInput::SCORING_FIELDS as $field) {
            $messages["{$scoringPrefix}{$field}.prohibited"] = self::QUIZ_ONLY_MESSAGE;
        }

        if ($correctPrefix !== null) {
            $messages["{$correctPrefix}is_correct.prohibited"] = self::QUIZ_ONLY_MESSAGE;
        }

        return $messages;
    }
}
