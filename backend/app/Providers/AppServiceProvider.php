<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
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
    }
}
