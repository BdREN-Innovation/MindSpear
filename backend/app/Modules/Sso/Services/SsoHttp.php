<?php

namespace App\Modules\Sso\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;

/**
 * Server-to-server HTTP for ZITADEL and the BDREN API. With sso.connect_url set
 * (local Docker), a request for the issuer's or the API's address goes to that
 * address instead and keeps the public Host header, so nginx and ZITADEL still
 * see the domain they expect.
 */
class SsoHttp
{
    /** @return array{0: PendingRequest, 1: string} The request to send and the URL to send it to. */
    public function to(string $url): array
    {
        $request = Http::timeout(config('sso.http_timeout'))->acceptJson();

        $connect = config('sso.connect_url');
        if (! $connect || ! $this->isRouted($url)) {
            return [$request, $url];
        }

        $target = parse_url($url);
        $via = parse_url(rtrim($connect, '/'));
        $host = $target['host'] . (isset($target['port']) ? ':' . $target['port'] : '');
        $rewritten = $via['scheme'] . '://' . $via['host'] . (isset($via['port']) ? ':' . $via['port'] : '')
            . ($target['path'] ?? '') . (isset($target['query']) ? '?' . $target['query'] : '');

        return [$request->withHeaders(['Host' => $host]), $rewritten];
    }

    private function isRouted(string $url): bool
    {
        $origin = self::origin($url);

        return $origin !== null && in_array($origin, [self::origin(config('sso.issuer')), self::origin(config('sso.api_url'))], true);
    }

    private static function origin(?string $url): ?string
    {
        $parts = $url ? parse_url($url) : false;
        if (! $parts || empty($parts['host'])) {
            return null;
        }

        return strtolower(($parts['scheme'] ?? 'http') . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : ''));
    }
}
