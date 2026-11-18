<?php

namespace App\Modules\Sso\Services;

/** Who BDREN says the person is, taken from verified ID token (and userinfo) claims. */
final class SsoProfile
{
    public function __construct(
        public readonly string $issuer,
        public readonly string $subject,
        public readonly ?string $email,
        public readonly bool $emailVerified,
        public readonly string $firstName,
        public readonly string $lastName,
        public readonly ?string $picture,
    ) {}

    public static function fromClaims(array $claims): self
    {
        $email = is_string($claims['email'] ?? null) && filter_var($claims['email'], FILTER_VALIDATE_EMAIL)
            ? strtolower(trim($claims['email']))
            : null;

        $first = trim((string) ($claims['given_name'] ?? ''));
        $last = trim((string) ($claims['family_name'] ?? ''));
        if ($first === '' && $last === '') {
            $parts = preg_split('/\s+/', trim((string) ($claims['name'] ?? $claims['preferred_username'] ?? '')), 2);
            $first = $parts[0] ?? '';
            $last = $parts[1] ?? '';
        }
        if ($first === '' && $email) {
            $first = explode('@', $email)[0];
        }

        $picture = is_string($claims['picture'] ?? null) && filter_var($claims['picture'], FILTER_VALIDATE_URL) ? $claims['picture'] : null;

        return new self(
            issuer: $claims['iss'],
            subject: $claims['sub'],
            email: $email,
            // ZITADEL sends a boolean; some providers send "true".
            emailVerified: filter_var($claims['email_verified'] ?? false, FILTER_VALIDATE_BOOLEAN),
            firstName: mb_substr($first !== '' ? $first : 'BDREN', 0, 100),
            lastName: mb_substr($last, 0, 100),
            picture: $picture,
        );
    }
}
