<?php

namespace App\Modules\FileLibrary\Providers;

use App\Models\File;
use App\Modules\FileLibrary\Policies\FilePolicy;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

/**
 * My Files (per-user file library with a storage quota), registered from one
 * place: routes (/api/v1/library), migrations, policy and upload rate limit.
 */
class FileLibraryServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $this->loadMigrationsFrom(__DIR__ . '/../Database/Migrations');

        Gate::policy(File::class, FilePolicy::class);

        RateLimiter::for('library-upload', fn (Request $request) => Limit::perMinute(30)->by(
            'library-upload:' . ($request->user()?->id ?: $request->ip())
        ));

        if (! $this->app->routesAreCached()) {
            Route::middleware('api')
                ->prefix('api/v1/library')
                ->group(__DIR__ . '/../routes.php');
        }
    }
}
