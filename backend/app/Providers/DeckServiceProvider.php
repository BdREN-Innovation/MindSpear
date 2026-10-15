<?php

namespace App\Providers;

use App\Deck\Broadcasts\DeckBroadcaster;
use App\Deck\Broadcasts\DeckChannels;
use App\Deck\Http\DeckValidation;
use App\Deck\Http\Middleware\EnsureDeckFeatureEnabled;
use App\Deck\Http\Middleware\ResolveDeckParticipant;
use App\Deck\Policies\DeckPolicy;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Support\ProfanityFilter;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckSession;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Shared slide engine (Quest v2, later Quiz v2): migrations, the slide type
 * registry, broadcasting helpers, the v2 host channel and the HTTP layer
 * (routes/deck/*.php, policy, participant middleware, rate limits).
 */
class DeckServiceProvider extends ServiceProvider
{
    /** Route action flag on everything loaded from routes/deck (see the ValidationException renderer). */
    public const ROUTE_FLAG = 'deck';

    /** deck-lookup: unknown join codes per IP per minute. */
    public const LOOKUP_MISSES_PER_MINUTE = 30;

    /** deck-lookup: all join-code lookups per IP per minute. */
    public const LOOKUPS_PER_MINUTE = 300;

    public function register(): void
    {
        // Every concrete type under app/Deck/Slides/Types is registered; adding a
        // type never needs an edit here. Resolved lazily on first use.
        $this->app->singleton(SlideTypeRegistry::class, function ($app) {
            $registry = new SlideTypeRegistry();

            foreach (SlideTypeRegistry::discover(app_path('Deck/Slides/Types'), 'App\\Deck\\Slides\\Types') as $class) {
                $registry->register($app->make($class));
            }

            return $registry;
        });

        $this->app->singleton(DeckChannels::class);
        $this->app->singleton(DeckBroadcaster::class);
        $this->app->singleton(ProfanityFilter::class, fn () => new ProfanityFilter());
    }

    public function boot(): void
    {
        $this->loadMigrationsFrom(database_path('migrations/Deck'));

        // Private host channel; `.v2` keeps it apart from legacy host.{module}.{id}.
        Broadcast::channel('host.{product}.v2.{sessionId}', function ($user, string $product, int $sessionId): bool {
            $session = DeckSession::with('deck')->find($sessionId);

            return (bool) $session?->deck
                && $session->deck->product === $product
                && (int) $session->host_user_id === (int) $user->id;
        });

        Gate::policy(Deck::class, DeckPolicy::class);
        Gate::policy(DeckSession::class, DeckPolicy::class);

        $router = $this->app->make(Router::class);
        $router->aliasMiddleware(ResolveDeckParticipant::ALIAS, ResolveDeckParticipant::class);
        $router->aliasMiddleware(EnsureDeckFeatureEnabled::ALIAS, EnsureDeckFeatureEnabled::class);

        $this->registerRateLimiters();
        $this->renderValidationErrorsLikeFormRequests();

        if (! $this->app->routesAreCached()) {
            static::loadRouteFiles(base_path('routes/deck'));
        }
    }

    /**
     * Loads every *.php in $directory, sorted by file name, inside
     * Route::middleware('api')->prefix('api/v1'). Each package owns one file.
     */
    public static function loadRouteFiles(string $directory): void
    {
        $files = static::routeFiles($directory);
        if ($files === []) {
            return;
        }

        Route::group(['middleware' => 'api', 'prefix' => 'api/v1', self::ROUTE_FLAG => true], function () use ($files) {
            foreach ($files as $file) {
                require $file;
            }
        });
    }

    /** @return list<string> absolute paths of $directory/*.php, sorted by name */
    public static function routeFiles(string $directory): array
    {
        $files = glob(rtrim($directory, '/') . '/*.php') ?: [];
        sort($files, SORT_STRING);

        return array_values($files);
    }

    private function registerRateLimiters(): void
    {
        // Anonymous join: per IP + display name, and generous per IP (a whole classroom often shares one address).
        RateLimiter::for('deck-join', function (Request $request) {
            $name = $request->input('display_name');
            $name = is_string($name) ? Str::lower(trim($name)) : '';

            return [
                Limit::perMinute(10)->by('deck-join:' . $request->ip() . '|' . $name),
                Limit::perMinute(300)->by('deck-join-ip:' . $request->ip()),
            ];
        });

        // Participant endpoints: per token; requests without one share their IP's (larger) budget.
        RateLimiter::for('deck-participant', function (Request $request) {
            $key = ResolveDeckParticipant::throttleKey($request);

            return Limit::perMinute(str_starts_with($key, 'pt:') ? 240 : 600)->by('deck-participant:' . $key);
        });

        // Public join-code lookup (GET by-code): per IP, whatever token is sent. Misses
        // (404) are capped tightly against code guessing; the overall budget matches
        // deck-join, since a whole classroom often looks its code up from one address.
        RateLimiter::for('deck-lookup', fn (Request $request) => [
            Limit::perMinute(self::LOOKUP_MISSES_PER_MINUTE)
                ->by('deck-lookup-miss:' . $request->ip())
                ->after(fn ($response) => $response->getStatusCode() === 404),
            Limit::perMinute(self::LOOKUPS_PER_MINUTE)->by('deck-lookup:' . $request->ip()),
        ]);

        // Signed-in authoring / hosting: editor autosave and drag reorders are chatty.
        RateLimiter::for('deck-author', fn (Request $request) => Limit::perMinute(300)->by(
            'deck-author:' . ($request->user()?->id ?: $request->ip())
        ));
    }

    /**
     * A ValidationException escaping a routes/deck route (slide-type config
     * or answer validation, $request->validate()) renders like
     * BaseFormRequest: 422 {status, message, data: {validation_errors}}.
     */
    private function renderValidationErrorsLikeFormRequests(): void
    {
        $this->callAfterResolving(ExceptionHandler::class, function ($handler) {
            if (! method_exists($handler, 'renderable')) {
                return;
            }

            $handler->renderable(function (ValidationException $e, Request $request) {
                return $request->route()?->getAction(self::ROUTE_FLAG) ? DeckValidation::response($e) : null;
            });
        });
    }
}
