<?php

namespace App\Modules\FunGame\Providers;

use App\Modules\FunGame\Console\CreateDemoGame;
use App\Modules\FunGame\Console\TickFunGameSessions;
use App\Modules\FunGame\Models\FunGame;
use App\Modules\FunGame\Models\FunGameSession;
use App\Modules\FunGame\Policies\FunGamePolicy;
use App\Modules\FunGame\Services\FunGameLogger;
use App\Modules\FunGame\Services\ParticipantTokens;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

/**
 * Everything Fun Games needs, registered from one place: routes
 * (/api/v1/fun-games), migrations, policy, broadcast channel, rate limits,
 * the `fun-games:tick` command and the `fungames` log channel.
 */
class FunGameServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(FunGameLogger::class);

        // Default log channel; override it in config/logging.php if needed.
        $config = $this->app['config'];
        if (! $config->has('logging.channels.fungames')) {
            $config->set('logging.channels.fungames', [
                'driver' => 'daily',
                'path' => storage_path('logs/fungames.log'),
                'level' => env('FUNGAMES_LOG_LEVEL', 'info'),
                'days' => (int) env('FUNGAMES_LOG_DAYS', 30),
                'replace_placeholders' => true,
            ]);
        }
    }

    public function boot(): void
    {
        $this->loadMigrationsFrom(__DIR__ . '/../Database/Migrations');

        Gate::policy(FunGame::class, FunGamePolicy::class);

        RateLimiter::for('fungame-join', fn (Request $request) => [
            Limit::perMinute(10)->by('fg-join:' . $request->ip() . '|' . Str::lower((string) $request->input('email'))),
            // Generous per IP: a whole classroom often shares one address.
            Limit::perMinute(300)->by('fg-join-ip:' . $request->ip()),
        ]);
        RateLimiter::for('fungame-participant', fn (Request $request) => Limit::perMinute(240)->by(
            'fg:' . ParticipantTokens::throttleKey($request)
        ));

        if (! $this->app->routesAreCached()) {
            Route::middleware('api')
                ->prefix('api/v1/fun-games')
                ->group(__DIR__ . '/../routes.php');
        }

        Broadcast::channel('host.fungame.{sessionId}', function ($user, int $sessionId): bool {
            $session = FunGameSession::with('game')->find($sessionId);

            return (bool) $session?->game && (int) $session->game->user_id === (int) $user->id;
        });

        if ($this->app->runningInConsole()) {
            $this->commands([TickFunGameSessions::class, CreateDemoGame::class]);
        }
    }
}
