<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use App\Observers\PersonalAccessTokenObserver;
use Laravel\Sanctum\PersonalAccessToken;
use App\Observers\ActivityLoggerObserver;
use App\Models\User;
use App\Models\Institution;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Legacy Quiz / Quest / Survey tables are kept (question banks, old data); their
        // migrations stay so `migrate` keeps a fresh database in step with production.
        $this->loadMigrationsFrom([
            database_path('migrations'),
            database_path('migrations/Quiz'),
            database_path('migrations/Survey'),
            database_path('migrations/Quest'),
        ]);

        // Observe Sanctum token creations for login logs
        PersonalAccessToken::observe(PersonalAccessTokenObserver::class);

        // Observe core models for activity logs
        User::observe(ActivityLoggerObserver::class);
        Institution::observe(ActivityLoggerObserver::class);

        // Per address, so nobody can flood an inbox or the mail quota through this public route.
        RateLimiter::for('resend-verification', function (Request $request) {
            $email = $request->input('email');
            $email = is_string($email) ? Str::lower(trim($email)) : '';

            return Limit::perHour(5)->by('resend-verification:' . $email);
        });
    }
}
