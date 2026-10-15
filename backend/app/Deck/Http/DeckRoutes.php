<?php

namespace App\Deck\Http;

use App\Models\Deck\Deck;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use LogicException;

/**
 * Product-scoped route groups for the deck API.
 *
 * Every file in routes/deck/*.php is loaded by DeckServiceProvider inside
 * Route::middleware('api')->prefix('api/v1'). A route file registers its
 * product-scoped routes through authoring() / sessions(); each route is
 * registered once per product listed in config('deck.routes') and carries
 * ->defaults('product', <product>), which DeckRoutes::product($request)
 * reads back. Quiz v2 adds a `quiz` entry to the config and gets the same
 * routes under its own prefixes with product = 'quiz'.
 *
 *   DeckRoutes::authoring(function (string $product) {
 *       Route::get('{deck}', [DeckAuthoringController::class, 'show'])->whereNumber('deck')->name('decks.show');
 *   });
 *   // GET /api/v1/quests/v2/{deck}, named deck.quest.decks.show, product = quest
 *
 * Laravel passes route defaults to the action after the URI parameters, so
 * `product` arrives as one extra trailing argument: harmless, but do not give
 * an action an optional trailing parameter it could land in. Constrain ids
 * with whereNumber() so /quests/v2/{deck} never shadows a literal segment.
 */
final class DeckRoutes
{
    public const AREA_AUTHORING = 'authoring';

    public const AREA_SESSIONS = 'sessions';

    /** Name of the route default that carries the product. */
    public const PRODUCT = 'product';

    /** Editor routes: /api/v1/quests/v2/... (names deck.{product}.*). */
    public static function authoring(Closure $routes, ?array $products = null): void
    {
        self::area(self::AREA_AUTHORING, $routes, $products);
    }

    /** Live session routes: /api/v1/quest-sessions/v2/... (names deck.{product}.sessions.*). */
    public static function sessions(Closure $routes, ?array $products = null): void
    {
        self::area(self::AREA_SESSIONS, $routes, $products);
    }

    /**
     * Registers $routes under $prefix with ->defaults('product', $product) on
     * every route it adds. $routes receives the product.
     */
    public static function group(string $product, string $prefix, string $namePrefix, Closure $routes): void
    {
        if (! in_array($product, Deck::PRODUCTS, true)) {
            throw new LogicException("Unknown deck product [{$product}].");
        }

        $existing = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            $existing[spl_object_id($route)] = true;
        }

        Route::prefix($prefix)->name($namePrefix)->group(fn () => $routes($product));

        foreach (Route::getRoutes()->getRoutes() as $route) {
            if (! isset($existing[spl_object_id($route)])) {
                $route->defaults(self::PRODUCT, $product);
            }
        }
    }

    /** @return array<string, string> product => URL prefix for $area, from config('deck.routes') */
    public static function prefixes(string $area): array
    {
        $prefixes = [];
        foreach ((array) config('deck.routes', []) as $product => $areas) {
            if (isset($areas[$area])) {
                $prefixes[$product] = trim((string) $areas[$area], '/');
            }
        }

        return $prefixes;
    }

    /** The product of the current deck route ('quest' | 'quiz'). */
    public static function product(Request $request): string
    {
        $product = self::productOf($request->route());

        if ($product === null) {
            throw new LogicException('This route has no deck product; register it with DeckRoutes::authoring() or sessions().');
        }

        return $product;
    }

    /** Like product(), but null for routes registered without one (e.g. /meta). */
    public static function productOf(mixed $route): ?string
    {
        if (! $route instanceof RoutingRoute) {
            return null;
        }

        // Unbound routes (no request matched yet) only have their defaults.
        $product = ($route->hasParameters() ? $route->parameter(self::PRODUCT) : null)
            ?? ($route->defaults[self::PRODUCT] ?? null);

        return in_array($product, Deck::PRODUCTS, true) ? $product : null;
    }

    /**
     * A route id as an int, or null when it is not a positive bigint (so a
     * stray "abc" or 25-digit id is a 404, not a PostgreSQL cast error).
     */
    public static function id(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value > 0 ? $value : null;
        }

        if (! is_string($value) || ! preg_match('/^[1-9][0-9]{0,18}$/', $value)) {
            return null;
        }

        $id = filter_var($value, FILTER_VALIDATE_INT);

        return $id === false ? null : $id;
    }

    private static function area(string $area, Closure $routes, ?array $products): void
    {
        foreach (self::prefixes($area) as $product => $prefix) {
            if ($products !== null && ! in_array($product, $products, true)) {
                continue;
            }

            $name = $area === self::AREA_SESSIONS ? "deck.{$product}.sessions." : "deck.{$product}.";
            self::group($product, $prefix, $name, $routes);
        }
    }
}
