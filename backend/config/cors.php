<?php

$frontendUrl = env('FRONTEND_URL', 'http://localhost:2000');
$allowedOrigins = env(
    'CORS_ALLOWED_ORIGINS',
    implode(',', array_filter([
        $frontendUrl,
        'http://localhost:2000',
        'http://127.0.0.1:2000',
    ]))
);

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | The frontend authenticates private Laravel Echo channels through
    | /broadcasting/auth. That route must answer browser preflight requests
    | from the Next.js app before Sanctum can authorize the host subscription.
    |
    */

    'paths' => ['api/*', 'broadcasting/auth', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => array_values(array_unique(array_filter(array_map(
        static fn (string $origin): string => trim($origin),
        explode(',', $allowedOrigins)
    )))),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    // Retry-After on 429s must be readable cross-origin: the participant app
    // waits that long before its next try.
    'exposed_headers' => ['Retry-After'],

    // Participant requests carry X-Participant-Token, so each one would be
    // preflighted; cache the preflight for 2 hours (browsers cap it: Chrome
    // at 2 h, Firefox at 24 h).
    'max_age' => 7200,

    'supports_credentials' => true,

];
