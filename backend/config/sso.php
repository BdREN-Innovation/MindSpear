<?php

/*
 * BDREN single sign-on (ZITADEL, OpenID Connect) and the BDREN entitlement API.
 * Used only by app/Modules/Sso. With SSO_ENABLED=false nothing changes: the
 * module's endpoints answer 404 and the existing login keeps working as before.
 * See SSO_INTEGRATION.md in the repository root.
 */

return [
    'enabled' => (bool) env('SSO_ENABLED', false),

    // Shown on the sign-in button: "Sign in with {name}".
    'provider_name' => env('SSO_PROVIDER_NAME', 'BDREN SSO'),

    // --- Login (OpenID Connect, Authorization Code + PKCE) -------------------------------
    // The issuer exactly as ZITADEL publishes it (no trailing slash).
    'issuer' => rtrim((string) env('SSO_ISSUER', 'http://auth.bdren.localhost:8080'), '/'),
    'client_id' => env('SSO_CLIENT_ID'),
    'client_secret' => env('SSO_CLIENT_SECRET'),
    // The frontend page ZITADEL sends the browser back to; registered in ZITADEL exactly.
    'redirect_uri' => env('SSO_REDIRECT_URI', 'http://localhost:3001/auth/sso/callback'),
    // Where ZITADEL sends the browser after a central logout; registered in ZITADEL exactly.
    'post_logout_redirect_uri' => env('SSO_POST_LOGOUT_REDIRECT_URI', 'http://localhost:3001/auth/sign-in'),
    'scopes' => env('SSO_SCOPES', 'openid profile email'),
    // client_secret_basic (ZITADEL "Basic", what the BDREN bootstrap script registers) or client_secret_post.
    'token_auth_method' => env('SSO_TOKEN_AUTH_METHOD', 'client_secret_basic'),

    // Optional, local Docker only: send this server's requests to ZITADEL and the BDREN API
    // to this address instead, keeping the public Host header, e.g. http://host.docker.internal:8080
    // when the issuer is http://auth.bdren.localhost:8080 (*.localhost means "this container").
    'connect_url' => env('SSO_CONNECT_URL'),

    'http_timeout' => (int) env('SSO_HTTP_TIMEOUT', 10),
    // Seconds of clock difference tolerated when checking the ID token's times.
    'leeway' => (int) env('SSO_CLOCK_LEEWAY', 60),
    // How long a started login may take before its state expires.
    'state_ttl' => (int) env('SSO_STATE_TTL', 600),

    // --- Matching a BDREN identity to a Mindspear user ------------------------------------
    // First login of an identity that isn't linked yet:
    // link it to the existing user with the same email, only when BDREN says the email is verified.
    'link_by_verified_email' => (bool) env('SSO_LINK_BY_VERIFIED_EMAIL', true),
    // otherwise create a new Mindspear user (false: refuse, and the person links from their profile).
    'auto_create_users' => (bool) env('SSO_AUTO_CREATE_USERS', true),

    // --- Entitlements (BDREN Django API, server to server) --------------------------------
    'api_url' => rtrim((string) env('BDREN_API_URL', 'http://api.bdren.localhost:8080/api/v1'), '/'),
    'product' => env('BDREN_PRODUCT_SLUG', 'mindspear'),
    'product_api_key' => env('BDREN_PRODUCT_API_KEY'),
    // The BDREN website; a user who has never signed in there gets a link to it
    // (/api/v1/auth/login/?next=...) because BDREN only knows people who did.
    'platform_url' => rtrim((string) env('BDREN_PLATFORM_URL', 'http://bdren.localhost:8080'), '/'),
    // Where BDREN sends the person back after that first sign-in.
    'app_url' => rtrim((string) env('SSO_APP_URL', 'http://localhost:3001'), '/'),
    // The features shown on the profile page (GET /api/v1/sso/entitlements).
    'features' => array_values(array_filter(array_map('trim', explode(',', (string) env('BDREN_FEATURES', 'ai_requests,storage_gb'))))),
    // false: the sso.entitlement middleware only logs what it would refuse.
    'enforce_entitlements' => (bool) env('SSO_ENFORCE_ENTITLEMENTS', false),
    // When the BDREN API can't be reached: true lets the request through (and logs it).
    'fail_open' => (bool) env('SSO_ENTITLEMENTS_FAIL_OPEN', true),
];
