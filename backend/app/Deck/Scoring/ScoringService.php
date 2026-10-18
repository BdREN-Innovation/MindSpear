<?php

namespace App\Deck\Scoring;

use App\Deck\Slides\ScoreResult;
use App\Deck\Slides\SlideTypeRegistry;
use App\Models\Deck\DeckSessionSlideRun;

/**
 * Scores one answer to a slide run (QUIZ_REDESIGN_PLAN.md §1.3) by
 * delegating to the run's slide type with the run's snapshots. Call it
 * synchronously on submit, with the payload validateAnswer() returned.
 *
 * The config passed to the type is config_snapshot with
 * `scoring.time_limit_seconds` filled from the run's time_limit_seconds when
 * the snapshot has none, so the speed bonus always uses the run's timer.
 * Types that take no answers, unscored (Quest) types and unknown types score
 * ScoreResult::zero(). Negative times count as 0 ms.
 */
class ScoringService
{
    public function __construct(private readonly SlideTypeRegistry $types) {}

    public function score(DeckSessionSlideRun $run, array $payload, int $timeToAnswerMs): ScoreResult
    {
        $key = (string) $run->type_snapshot;

        if (! $this->types->has($key)) {
            return ScoreResult::zero();
        }

        $type = $this->types->for($key);
        if (! $type->acceptsAnswers()) {
            return ScoreResult::zero();
        }

        return $type->score($payload, self::config($run), $run->options_snapshot ?? [], max(0, $timeToAnswerMs));
    }

    /** Points a fully correct answer would earn on $run at $timeToAnswerMs (the participant's "50p ── 100p" bar). */
    public function earnable(DeckSessionSlideRun $run, int $timeToAnswerMs): int
    {
        return (int) round(QuizScoring::earnable(QuizScoring::settings(self::config($run)), max(0, $timeToAnswerMs)));
    }

    /** config_snapshot with scoring.time_limit_seconds defaulted from the run. */
    public static function config(DeckSessionSlideRun $run): array
    {
        $config = $run->config_snapshot ?? [];
        $scoring = is_array($config['scoring'] ?? null) ? $config['scoring'] : [];

        if (($scoring['time_limit_seconds'] ?? null) === null && $run->time_limit_seconds) {
            $scoring['time_limit_seconds'] = (int) $run->time_limit_seconds;
        }

        $config['scoring'] = $scoring;

        return $config;
    }
}
