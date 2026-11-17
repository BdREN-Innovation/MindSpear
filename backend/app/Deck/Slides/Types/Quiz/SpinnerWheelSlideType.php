<?php

namespace App\Deck\Slides\Types\Quiz;

use App\Deck\Slides\AbstractSlideType;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Random\IntervalBoundary;
use Random\Randomizer;

/**
 * Spinner wheel (Quiz engagement slide, unscored in v1; plan §3.2).
 * Takes no answers and has no timer; the host starts a spin.
 *
 * Config:  {} (how long a spin lasts is the session's setting, config deck.quiz.spin_seconds).
 * Options: the wheel entries (2–12), label and/or image, payload
 *          {weight?: number 0.1..100 (default 1)}. 4 empty entries seeded.
 *
 * Wheel geometry (participant view `segments`, in option order):
 *   [{option_id, start_angle, end_angle}, ...] in degrees clockwise from
 *   12 o'clock, each segment's size proportional to its weight (so the
 *   wheel looks exactly as likely as it is). A missing, non-numeric or
 *   non-positive weight counts as 1.
 *
 * spin(): {option_id, target_angle} — a weighted random entry and a random
 *   angle inside its segment (away from the edges). Rotate the wheel so that
 *   target_angle ends under the 12 o'clock pointer.
 */
class SpinnerWheelSlideType extends AbstractSlideType
{
    public const KEY = 'spinner_wheel';

    public const MAX_WEIGHT = 100;

    public const MIN_WEIGHT = 0.1;

    /** Share of a segment kept clear at each edge when picking target_angle. */
    private const EDGE_MARGIN = 0.1;

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

    public function defaultOptions(): array
    {
        return array_fill(0, 4, ['label' => null, 'payload' => []]);
    }

    public function validateConfig(array $config): array
    {
        return [];
    }

    /**
     * Normalised option payload (optional authoring hook).
     *
     * @throws ValidationException
     */
    public function validateOptionPayload(array $payload): array
    {
        Validator::make($payload, [
            'weight' => ['nullable', 'numeric', 'min:' . self::MIN_WEIGHT, 'max:' . self::MAX_WEIGHT],
        ])->validate();

        return isset($payload['weight']) ? ['weight' => $payload['weight'] + 0] : [];
    }

    public function aggregate(array $config, array $options, Collection $answers): array
    {
        return [];
    }

    /**
     * @return list<array{option_id:int, start_angle:float, end_angle:float}>
     */
    public function segments(array $options): array
    {
        $sorted = QuizOptions::sorted($options);
        $total = array_sum(array_map(self::weight(...), $sorted));
        $segments = [];
        $start = 0.0;
        foreach ($sorted as $option) {
            $end = $start + self::weight($option) / $total * 360;
            $segments[] = ['option_id' => $option['id'], 'start_angle' => round($start, 4), 'end_angle' => round($end, 4)];
            $start = $end;
        }

        if ($segments !== []) {
            $segments[array_key_last($segments)]['end_angle'] = 360.0;
        }

        return $segments;
    }

    /**
     * A weighted random entry of the run's wheel.
     *
     * @return array{option_id:int, target_angle:float}
     *
     * @throws ValidationException keyed `options` when the wheel has no entries
     */
    public function spin(DeckSessionSlideRun $run, ?Randomizer $random = null): array
    {
        $segments = $this->segments($run->options_snapshot ?? []);
        if ($segments === []) {
            throw ValidationException::withMessages(['options' => 'The wheel has no entries.']);
        }

        $random ??= new Randomizer();
        $point = $random->getFloat(0, 360, IntervalBoundary::ClosedOpen);

        $chosen = $segments[array_key_last($segments)];
        foreach ($segments as $segment) {
            if ($point < $segment['end_angle']) {
                $chosen = $segment;
                break;
            }
        }

        $size = $chosen['end_angle'] - $chosen['start_angle'];
        $offset = $size * (self::EDGE_MARGIN + (1 - 2 * self::EDGE_MARGIN) * $random->getFloat(0, 1, IntervalBoundary::ClosedClosed));

        return [
            'option_id' => $chosen['option_id'],
            'target_angle' => round($chosen['start_angle'] + $offset, 2),
        ];
    }

    protected function participantExtras(DeckSessionSlideRun $run): array
    {
        return ['segments' => $this->segments($run->options_snapshot ?? [])];
    }

    private static function weight(array $option): float
    {
        $weight = $option['payload']['weight'] ?? null;

        if (! is_int($weight) && ! is_float($weight) && ! (is_string($weight) && is_numeric($weight))) {
            return 1.0;
        }

        $weight = (float) $weight;

        return is_finite($weight) && $weight > 0 ? min($weight, (float) self::MAX_WEIGHT) : 1.0;
    }
}
