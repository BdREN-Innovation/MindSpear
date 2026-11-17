<?php

namespace App\Deck\Slides\Types\Quiz;

use App\Deck\Slides\AbstractSlideType;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Validator;

/**
 * Leaderboard (Quiz): the session ranking by total points, insertable
 * anywhere in the deck. Takes no answers, has no options or timer. The
 * ranking itself comes from App\Deck\Scoring\LeaderboardService::currentTopN
 * with limit() of this run's config.
 *
 * Config: {top_n: int 1..MAX_TOP_N (default 10),
 *          show_all_participants: bool (default false; true = everyone, up to MAX_TOP_N)}
 */
class LeaderboardSlideType extends AbstractSlideType
{
    public const KEY = 'leaderboard';

    /** Most rows a leaderboard shows (keeps leaderboard.updated within a Reverb publish). */
    public const MAX_TOP_N = 50;

    public function key(): string
    {
        return self::KEY;
    }

    public function products(): array
    {
        return ['quiz'];
    }

    public function category(): string
    {
        return self::CATEGORY_INTERACTIVE;
    }

    public function revealModel(): string
    {
        return self::REVEAL_NONE;
    }

    public function acceptsAnswers(): bool
    {
        return false;
    }

    /** @return array{time_limit_seconds:null, points_min:null, points_max:null, speed_bonus_enabled:null} */
    public function defaultSlideAttributes(): array
    {
        return ['time_limit_seconds' => null, 'points_min' => null, 'points_max' => null, 'speed_bonus_enabled' => null];
    }

    public function defaultConfig(): array
    {
        return ['top_n' => 10, 'show_all_participants' => false];
    }

    public function validateConfig(array $config): array
    {
        $config = array_replace($this->defaultConfig(), $config);

        Validator::make($config, [
            'top_n' => ['required', 'integer', 'min:1', 'max:' . self::MAX_TOP_N],
            'show_all_participants' => ['required', 'boolean'],
        ])->validate();

        return [
            'top_n' => (int) $config['top_n'],
            'show_all_participants' => (bool) $config['show_all_participants'],
        ];
    }

    public function aggregate(array $config, array $options, Collection $answers): array
    {
        return [];
    }

    /** Rows to show for a run's config: top_n, or MAX_TOP_N when showing everyone. */
    public static function limit(array $config): int
    {
        if ((bool) ($config['show_all_participants'] ?? false)) {
            return self::MAX_TOP_N;
        }

        return max(1, min((int) ($config['top_n'] ?? 10), self::MAX_TOP_N));
    }
}
