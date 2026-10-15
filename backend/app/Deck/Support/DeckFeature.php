<?php

namespace App\Deck\Support;

use App\Deck\Exceptions\DeckException;
use App\Models\Deck\Deck;
use App\Models\User;

/**
 * Per-account rollout flag for a product's v2 (plan §8.3). Authoring and
 * hosting need it; participants never do (they are anonymous).
 *
 * Quest: users.quest_v2_enabled (set by admins in Filament), or everyone
 * while config('deck.quest_v2_default_enabled') (QUEST_V2_DEFAULT_ENABLED)
 * is on. A product without an entry in USER_FLAGS has no rollout flag.
 */
final class DeckFeature
{
    /** product => users column that turns its v2 on for one account. */
    public const USER_FLAGS = [
        Deck::PRODUCT_QUEST => 'quest_v2_enabled',
    ];

    public static function enabled(?User $user, string $product): bool
    {
        $column = self::USER_FLAGS[$product] ?? null;

        if ($column === null || self::enabledForEveryone($product)) {
            return true;
        }

        return $user !== null && (bool) $user->getAttribute($column);
    }

    /** config('deck.{product}_v2_default_enabled'): on for every account. */
    public static function enabledForEveryone(string $product): bool
    {
        return (bool) config("deck.{$product}_v2_default_enabled", false);
    }

    /** @throws DeckException 403 feature_disabled */
    public static function assertEnabled(?User $user, string $product): void
    {
        if (! self::enabled($user, $product)) {
            throw DeckException::featureDisabled(ucfirst($product) . ' v2 is not enabled for your account.');
        }
    }
}
