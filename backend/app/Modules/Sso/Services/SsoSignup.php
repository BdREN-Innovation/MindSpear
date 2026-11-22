<?php

namespace App\Modules\Sso\Services;

/**
 * Where new people get an account. With LOCAL_SIGNUP_ENABLED=false Mindspear stops creating
 * accounts itself (the sign-up form, and first-time Google/Microsoft logins): new people create
 * a BDREN account instead, and their first "Sign in with BDREN" creates the Mindspear account
 * (SSO_AUTO_CREATE_USERS). Existing accounts keep every way of signing in.
 */
final class SsoSignup
{
    /** The page that starts BDREN sign-in on arrival; the BDREN sign-up page sends people back there. */
    public const RETURN_PATH = '/auth/sign-in?sso=start';

    public static function localAllowed(): bool
    {
        return (bool) config('sso.local_signup');
    }

    /**
     * The BDREN website's sign-up page, which creates the person in ZITADEL and in BDREN's own
     * database, then returns them here. Null while SSO is off: they could not sign in with it.
     */
    public static function bdrenSignupUrl(): ?string
    {
        if (! config('sso.enabled')) {
            return null;
        }

        return config('sso.platform_url') . '/register?' . http_build_query(['next' => config('sso.app_url') . self::RETURN_PATH]);
    }

    /** The `data` of a refused sign-up: a code the frontend can act on, and where to go instead. */
    public static function refusal(): array
    {
        return ['code' => 'signup_disabled', 'signup_url' => self::bdrenSignupUrl()];
    }
}
