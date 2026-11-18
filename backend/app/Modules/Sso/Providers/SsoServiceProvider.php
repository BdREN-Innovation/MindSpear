<?php

namespace App\Modules\Sso\Providers;

use App\Modules\Sso\Http\Middleware\RequireEntitlement;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

/**
 * BDREN single sign-on (ZITADEL) and entitlements, registered from one place:
 * routes (/api/v1/sso), the sso_identities migration, the `sso.entitlement`
 * route middleware and the login rate limit. Removing the module = removing
 * this provider from bootstrap/providers.php (see SSO_INTEGRATION.md).
 */
class SsoServiceProvider extends ServiceProvider
{
    public function boot(Router $router): void
    {
        $this->loadMigrationsFrom(__DIR__ . '/../Database/Migrations');

        $router->aliasMiddleware('sso.entitlement', RequireEntitlement::class);

        RateLimiter::for('sso', fn (Request $request) => Limit::perMinute(20)->by(
            'sso:' . ($request->user()?->id ?: $request->ip())
        ));

        if (! $this->app->routesAreCached()) {
            Route::middleware('api')
                ->prefix('api/v1/sso')
                ->group(__DIR__ . '/../routes.php');
        }
    }
}
