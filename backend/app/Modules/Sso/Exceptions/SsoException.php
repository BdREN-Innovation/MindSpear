<?php

namespace App\Modules\Sso\Exceptions;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * Something the SSO module refuses or can't do. Rendered in the app's usual
 * {status, message, data} shape, with a stable `data.code` for the frontend.
 */
class SsoException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $status = 400,
        public readonly string $errorCode = 'sso_error',
        public readonly array $extra = [],
    ) {
        parent::__construct($message);
    }

    public static function disabled(): self
    {
        return new self('Single sign-on is not enabled.', 404, 'sso_disabled');
    }

    public static function notConfigured(string $what): self
    {
        return new self("Single sign-on is not configured: {$what} is missing.", 503, 'sso_not_configured');
    }

    public static function invalidState(): self
    {
        return new self('This sign-in link has expired or was already used. Please start again.', 400, 'invalid_state');
    }

    public static function invalidToken(string $reason): self
    {
        // 400, not 401: the frontend treats any 401 as "signed out" and would drop the session.
        return new self('The sign-in response could not be verified. Please try again.', 400, 'invalid_token', ['reason' => $reason]);
    }

    public static function providerUnavailable(string $reason): self
    {
        return new self('The sign-in service is not reachable right now. Please try again later.', 502, 'provider_unavailable', ['reason' => $reason]);
    }

    public function render(): JsonResponse
    {
        return response()->json([
            'status' => false,
            'message' => $this->getMessage(),
            'data' => ['code' => $this->errorCode] + $this->extra,
        ], $this->status);
    }
}
