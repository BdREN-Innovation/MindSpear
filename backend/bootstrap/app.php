<?php

use Illuminate\Auth\AuthenticationException;
use App\Http\Middleware\Authenticate;
use Illuminate\Auth\Middleware\AuthenticateWithBasicAuth;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Route;
use Spatie\Permission\Middleware\PermissionMiddleware;
use Spatie\Permission\Middleware\RoleMiddleware;
use Spatie\Permission\Middleware\RoleOrPermissionMiddleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withProviders(require __DIR__.'/providers.php')
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
        then: function () {
            // Register additional routes from the api subfolder
            Route::middleware('api')
                ->prefix('api/v1')
                ->group(function () {
                    require base_path('routes/api/v1/auth.php');
                    require base_path('routes/api/v1/preferences.php');
                    require base_path('routes/api/v1/institutions.php');
                    require base_path('routes/api/v1/Quiz/quizes.php');
                    require base_path('routes/api/v1/Quiz/questions.php');
                    require base_path('routes/api/v1/Quiz/quizparticipants.php');
                    require base_path('routes/api/v1/Quiz/quizattempts.php');
                    require base_path('routes/api/v1/Quiz/questionbankcategory.php');
                    require base_path('routes/api/v1/Quiz/questionbank.php');
                    require base_path('routes/api/v1/files.php');
                    require base_path('routes/api/v1/profiles.php');
                    require base_path('routes/api/v1/socialauth.php');
                    require base_path('routes/api/v1/socialsettings.php');
                    require base_path('routes/api/v1/logs.php');
                    require base_path('routes/api/v1/Survey/surveys.php');
                    require base_path('routes/api/v1/Survey/surveypages.php');
                    // Sections removed from Survey module
                    require base_path('routes/api/v1/Survey/surveyquestions.php');
                    require base_path('routes/api/v1/Survey/surveyresponses.php');
                    require base_path('routes/api/v1/Survey/surveyquestionbankcategories.php');
                    require base_path('routes/api/v1/Survey/surveyquestionbank.php');
                    // Survey question banks routes removed; managed via categories and questions
                    require base_path('routes/api/v1/Survey/surveyattampts.php');
                    require base_path('routes/api/v1/Quest/quests.php');
                    require base_path('routes/api/v1/Quest/questtasks.php');
                    require base_path('routes/api/v1/Quest/questattempts.php');
                    require base_path('routes/api/v1/Quest/questparticipants.php');
                    require base_path('routes/api/v1/Quest/questtaskbankcategories.php');
                    require base_path('routes/api/v1/Quest/questtaskbank.php');
                    // Quest task banks routes removed; managed via categories and tasks

                    // Dashboard routes
                    require base_path('routes/api/v1/Dashboard/dashboard.php');
                }
            );
        }
    )
    ->withBroadcasting(__DIR__.'/../routes/channels.php', [
        'middleware' => ['api', 'auth:sanctum'],
    ])
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->statefulApi();
        $middleware->alias([
            'role' => RoleMiddleware::class,
            'permission' => PermissionMiddleware::class,
            'role_or_permission' => RoleOrPermissionMiddleware::class,
            'auth' => Authenticate::class,
            'auth.basic' => AuthenticateWithBasicAuth::class,
            'bindings' => SubstituteBindings::class,
            'throttle' => ThrottleRequests::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        $exceptions->render(function (AuthenticationException $e, Request $request) {
            // Always return JSON for API requests instead of a 500 or redirect
            if ($request->is('api/*') || $request->expectsJson()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthenticated.',
                ], 401);
            }

            if ($request->is('super-admin') || $request->is('super-admin/*')) {
                $filamentLoginUrl = Route::has('filament.admin.auth.login')
                    ? route('filament.admin.auth.login')
                    : url('/super-admin/login');

                return redirect()->guest($filamentLoginUrl);
            }

            return response('Unauthenticated.', 401);
        });
    })->create();
