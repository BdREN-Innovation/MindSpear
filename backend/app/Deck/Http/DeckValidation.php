<?php

namespace App\Deck\Http;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;

/**
 * Validation errors for the deck API.
 *
 * Slide types throw ValidationException with bare keys (`option_ids`,
 * `items.2`, `media`); controllers add the field prefix in one place with
 * prefixed('config', ...) / prefixed('answer_payload', ...). Any
 * ValidationException that escapes a deck route is rendered like
 * BaseFormRequest: 422 {status: false, message: 'Validation Error',
 * data: {validation_errors: {field: [messages]}}} (DeckServiceProvider
 * registers response() for routes loaded from routes/deck).
 */
final class DeckValidation
{
    /** Runs $callback; a ValidationException it throws comes back with every key under "{$prefix}.". */
    public static function prefixed(string $prefix, Closure $callback): mixed
    {
        try {
            return $callback();
        } catch (ValidationException $e) {
            throw ValidationException::withMessages(self::prefixErrors($e->errors(), $prefix));
        }
    }

    /** @param array<string, list<string>> $errors */
    public static function prefixErrors(array $errors, string $prefix): array
    {
        $prefix = trim($prefix, '.');
        if ($prefix === '') {
            return $errors;
        }

        $prefixed = [];
        foreach ($errors as $key => $messages) {
            $prefixed[$prefix . '.' . $key] = $messages;
        }

        return $prefixed;
    }

    /** @param array<string, string|list<string>> $errors */
    public static function fail(array $errors): never
    {
        throw ValidationException::withMessages($errors);
    }

    /** The BaseFormRequest-shaped 422 body. */
    public static function response(ValidationException $e): JsonResponse
    {
        return response()->json([
            'status' => false,
            'message' => __('Validation Error'),
            'data' => ['validation_errors' => $e->errors()],
        ], 422);
    }
}
