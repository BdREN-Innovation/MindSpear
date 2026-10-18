<?php

namespace App\Deck\Scoring;

use App\Deck\Slides\ScoreResult;

/**
 * The Quiz v2 scoring formula (QUIZ_REDESIGN_PLAN.md "Scoring model"), pure.
 *
 * Settings come from a run's config_snapshot['scoring'], which the session
 * launcher fills from the slide columns:
 *   {points_min:int, points_max:int, speed_bonus_enabled:bool, time_limit_seconds:?int}
 * Missing or null values fall back to 50 / 100 / true / no time limit; the
 * time limit also falls back to config['time_limit_seconds'].
 *
 *   earnable = speed bonus on and a time limit set
 *       ? points_min + max(0, (limit - t) / limit) * (points_max - points_min)
 *       : points_max
 *   points   = round(earnable * credit)   (credit 0..1 from the slide type; 0 = wrong)
 *
 * Credit is all or nothing (1 or 0) for pick_answer_single, pick_answer_multi
 * (exact set only — user decision 2026-10-17) and short_answer; a ratio for
 * match_pairs, correct_order and categorise.
 *
 * t is the time to answer in seconds (ms / 1000, clamped at 0). Answering at
 * 0 ms earns points_max, at or after the limit points_min. Rounding happens
 * once, at the end (half up). points_min is clamped to 0..points_max.
 */
final class QuizScoring
{
    public const DEFAULT_POINTS_MIN = 50;

    public const DEFAULT_POINTS_MAX = 100;

    public const DEFAULT_SPEED_BONUS = true;

    /** @return array{points_min:int, points_max:int, speed_bonus_enabled:bool, time_limit_seconds:?int} */
    public static function settings(array $config): array
    {
        $scoring = is_array($config['scoring'] ?? null) ? $config['scoring'] : [];

        $max = self::whole($scoring['points_max'] ?? null) ?? self::DEFAULT_POINTS_MAX;
        $min = self::whole($scoring['points_min'] ?? null) ?? self::DEFAULT_POINTS_MIN;
        $speed = $scoring['speed_bonus_enabled'] ?? null;

        $limit = self::whole($scoring['time_limit_seconds'] ?? null) ?? self::whole($config['time_limit_seconds'] ?? null);

        return [
            'points_min' => min($min, $max),
            'points_max' => $max,
            'speed_bonus_enabled' => $speed === null ? self::DEFAULT_SPEED_BONUS : (bool) $speed,
            'time_limit_seconds' => $limit !== null && $limit > 0 ? $limit : null,
        ];
    }

    /** Points a fully correct answer earns at $timeToAnswerMs, unrounded. */
    public static function earnable(array $settings, int $timeToAnswerMs): float
    {
        $min = (int) $settings['points_min'];
        $max = (int) $settings['points_max'];
        $limit = $settings['time_limit_seconds'] ?? null;

        if (! ($settings['speed_bonus_enabled'] ?? false) || ! $limit) {
            return (float) $max;
        }

        $limitMs = $limit * 1000;
        $ratio = max(0.0, min(1.0, ($limitMs - max(0, $timeToAnswerMs)) / $limitMs));

        return $min + $ratio * ($max - $min);
    }

    /**
     * The ScoreResult for an answer earning $credit (0..1) of the points.
     * isCorrect is $fullyCorrect; partialCreditRatio is $credit (4 dp).
     */
    public static function result(array $config, int $timeToAnswerMs, float $credit, bool $fullyCorrect): ScoreResult
    {
        $credit = max(0.0, min(1.0, $credit));

        if ($credit <= 0.0) {
            return self::wrong();
        }

        $points = (int) round(self::earnable(self::settings($config), $timeToAnswerMs) * $credit);

        return new ScoreResult($points, $fullyCorrect, round($credit, 4));
    }

    /** Wrong, empty or malformed answer. */
    public static function wrong(): ScoreResult
    {
        return new ScoreResult(0, false, 0.0);
    }

    /** A non-negative whole number, or null when $value is not one. */
    private static function whole(mixed $value): ?int
    {
        if (is_int($value)) {
            return max(0, $value);
        }

        if (is_float($value) && is_finite($value)) {
            return max(0, (int) round($value));
        }

        if (is_string($value) && preg_match('/^\d{1,9}$/', $value)) {
            return (int) $value;
        }

        return null;
    }
}
