<?php

namespace App\Deck\Exceptions;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * A rule the deck API refuses to break (not yours, wrong state, type not
 * offered by this product, …). Rendered in the app's {status, message, data}
 * shape with `data.code` = one of the CODE_* constants.
 */
class DeckException extends RuntimeException
{
    public const CODE_NOT_FOUND = 'not_found';

    public const CODE_CONFLICT = 'conflict';

    public const CODE_INVALID_STATE = 'invalid_state';

    public const CODE_UNSUPPORTED_TYPE = 'unsupported_type';

    public const CODE_FORBIDDEN = 'forbidden';

    public const CODE_UNAUTHORIZED = 'unauthorized';

    /** The deck would hold more than config('deck.max_slides_per_deck') live slides. */
    public const CODE_SLIDE_LIMIT = 'slide_limit_reached';

    public function __construct(
        string $message,
        public readonly int $status = 409,
        public readonly string $errorCode = self::CODE_CONFLICT,
        public readonly array $extra = [],
    ) {
        parent::__construct($message);
    }

    /** Missing, someone else's, another product's or soft-deleted: all look the same. */
    public static function notFound(string $message = 'Not found.'): self
    {
        return new self($message, 404, self::CODE_NOT_FOUND);
    }

    public static function conflict(string $message): self
    {
        return new self($message, 409, self::CODE_CONFLICT);
    }

    /** The session or slide run is in the wrong state for this action (e.g. not voting). */
    public static function invalidState(string $message, array $extra = []): self
    {
        return new self($message, 409, self::CODE_INVALID_STATE, $extra);
    }

    /** A slide type this product does not offer (or no such type). Shown on the `type` field. */
    public static function unsupportedType(?string $type = null, string $message = 'Unsupported slide type for this product.'): self
    {
        return new self($message, 422, self::CODE_UNSUPPORTED_TYPE, [
            'type' => $type,
            'validation_errors' => ['type' => [$message]],
        ]);
    }

    public static function forbidden(string $message = 'You are not allowed to do this.'): self
    {
        return new self($message, 403, self::CODE_FORBIDDEN);
    }

    /**
     * 422: the deck would go past $max live slides. Also carries
     * validation_errors.slides, so forms showing 422 keys inline keep working.
     */
    public static function slideLimit(int $max): self
    {
        $message = "A deck can have at most {$max} slides.";

        return new self($message, 422, self::CODE_SLIDE_LIMIT, [
            'max_slides' => $max,
            'validation_errors' => ['slides' => [$message]],
        ]);
    }

    /** Missing, invalid, expired or revoked X-Participant-Token. */
    public static function unauthorized(string $message = 'Invalid or expired participant token.'): self
    {
        return new self($message, 401, self::CODE_UNAUTHORIZED);
    }

    /** Expected outcomes, not errors; keep them out of laravel.log. */
    public function report(): void {}

    public function render(): JsonResponse
    {
        return response()->json([
            'status' => false,
            'message' => $this->getMessage(),
            'data' => ['code' => $this->errorCode] + $this->extra,
        ], $this->status);
    }
}
