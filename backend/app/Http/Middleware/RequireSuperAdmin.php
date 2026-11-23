<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Route middleware `super-admin`: the signed-in user must hold the Super Admin role.
 * Checks the role by name whatever guard it was created on (the seeder uses `web`,
 * API requests arrive through `sanctum`), so it works for bearer tokens.
 */
class RequireSuperAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $isAdmin = $user !== null && $user->roles()->where('name', 'Super Admin')->exists();

        if (! $isAdmin) {
            return response()->json([
                'status' => false,
                'message' => 'Only the Super Admin can do this.',
                'data' => ['code' => 'forbidden'],
            ], 403);
        }

        return $next($request);
    }
}
