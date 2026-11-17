<?php

namespace App\Modules\FunGame\Services;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * A rule the Fun Games module refuses to break (game ended, not the owner, …).
 * Rendered in the app's usual {status, message, data} shape.
 */
class FunGameException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $status = 409,
        public readonly string $errorCode = 'conflict',
    ) {
        parent::__construct($message);
    }

    public static function notFound(string $message = 'Not found.'): self
    {
        return new self($message, 404, 'notFound');
    }

    public static function conflict(string $message): self
    {
        return new self($message, 409, 'conflict');
    }

    public static function unauthorized(string $message = 'Invalid or expired participant token.'): self
    {
        return new self($message, 401, 'unauthorized');
    }

    /** Expected outcomes (game ended, not found…) aren't errors; keep them out of laravel.log. */
    public function report(): void {}

    public function render(): JsonResponse
    {
        return response()->json([
            'status' => false,
            'message' => $this->getMessage(),
            'data' => ['code' => $this->errorCode],
        ], $this->status);
    }
}
