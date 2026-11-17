<?php

namespace App\Deck\Slides\Types\Quest;

/**
 * Slide-level settings every Quest poll type keeps in its config (plan §5.6),
 * appended after the type's own keys. Not a slide type, so discovery skips it.
 *
 * show_results_to_participants (default false, "Show votes to participants"):
 * false = only the presenter shows the live chart (Mentimeter model), so
 * aggregate broadcasts belong on the host channel; true = they may go to the
 * public session channel.
 */
final class PollSettings
{
    public const SHOW_RESULTS = 'show_results_to_participants';

    public static function defaults(): array
    {
        return [self::SHOW_RESULTS => false];
    }

    /** Validation rules for a config already merged with defaults(). */
    public static function rules(): array
    {
        return [self::SHOW_RESULTS => ['required', 'boolean']];
    }

    /** Normalised settings from a validated config. */
    public static function normalise(array $config): array
    {
        return [self::SHOW_RESULTS => (bool) $config[self::SHOW_RESULTS]];
    }

    /** Whether a run's config_snapshot lets participants see the live aggregate. */
    public static function showsResultsToParticipants(array $config): bool
    {
        return (bool) ($config[self::SHOW_RESULTS] ?? false);
    }
}
