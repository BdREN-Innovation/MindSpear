<?php

namespace App\Deck\Http\Requests\Authoring;

use Illuminate\Validation\Validator;

/**
 * 422 for any input string (or key) that is not valid UTF-8. Form-encoded
 * and query input can carry raw bytes such as %FF; PostgreSQL rejects them
 * (ILIKE, text and JSONB columns) and the JSON response encoder cannot echo
 * them, which would otherwise surface as a 500.
 */
trait RejectsInvalidUtf8
{
    public const INVALID_UTF8_MESSAGE = 'The text must be valid UTF-8.';

    /** FormRequest after-validation hook. */
    public function after(): array
    {
        return [function (Validator $validator) {
            foreach (self::invalidUtf8Paths($this->all()) as $path) {
                $validator->errors()->add($path, self::INVALID_UTF8_MESSAGE);
            }
        }];
    }

    /** @return list<string> dot paths of the offending values (the parent path for an invalid key) */
    private static function invalidUtf8Paths(array $input, string $prefix = ''): array
    {
        $paths = [];

        foreach ($input as $key => $value) {
            $keyValid = ! is_string($key) || mb_check_encoding($key, 'UTF-8');
            $path = $keyValid ? ltrim($prefix . '.' . $key, '.') : ($prefix === '' ? 'input' : $prefix);

            if (! $keyValid) {
                $paths[] = $path;
            } elseif (is_string($value) && ! mb_check_encoding($value, 'UTF-8')) {
                $paths[] = $path;
            } elseif (is_array($value)) {
                array_push($paths, ...self::invalidUtf8Paths($value, $path));
            }
        }

        return array_values(array_unique($paths));
    }
}
