<?php

namespace App\Modules\Sso\Services;

/** One answer from the BDREN entitlement API, or why there isn't one. */
final class EntitlementResult
{
    /** BDREN answered. */
    public const OK = 'ok';

    /** The user has no BDREN identity linked (password-only users): nothing to check. */
    public const NOT_LINKED = 'not_linked';

    /** BDREN doesn't know the person yet: they have never signed in on the BDREN website. */
    public const NOT_PROVISIONED = 'not_provisioned';

    /** BDREN_API_URL or BDREN_PRODUCT_API_KEY is not set. */
    public const NOT_CONFIGURED = 'not_configured';

    /** The API could not be reached or answered an error. */
    public const UNAVAILABLE = 'unavailable';

    public function __construct(
        public readonly string $feature,
        public readonly string $status,
        public readonly bool $allowed = false,
        public readonly ?float $limit = null,
        public readonly ?float $used = null,
        public readonly ?float $reserved = null,
        public readonly ?float $remaining = null,
        public readonly ?string $resetAt = null,
        public readonly ?string $error = null,
    ) {}

    public static function fromResponse(string $feature, array $body): self
    {
        $number = fn (string $key) => isset($body[$key]) && is_numeric($body[$key]) ? (float) $body[$key] : null;

        return new self(
            feature: $feature,
            status: self::OK,
            allowed: (bool) ($body['allowed'] ?? false),
            limit: $number('limit'),
            used: $number('used'),
            reserved: $number('reserved'),
            remaining: $number('remaining'),
            resetAt: is_string($body['reset_at'] ?? null) ? $body['reset_at'] : null,
            error: is_string($body['error'] ?? null) ? $body['error'] : null,
        );
    }

    public function toArray(): array
    {
        return [
            'feature' => $this->feature,
            'status' => $this->status,
            'allowed' => $this->allowed,
            'limit' => $this->limit,
            'used' => $this->used,
            'reserved' => $this->reserved,
            'remaining' => $this->remaining,
            'reset_at' => $this->resetAt,
            'error' => $this->error,
        ];
    }
}
