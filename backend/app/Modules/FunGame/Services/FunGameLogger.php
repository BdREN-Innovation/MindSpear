<?php

namespace App\Modules\FunGame\Services;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * Structured log for Fun Games (storage/logs/fungames-YYYY-MM-DD.log).
 * Event names are dotted, e.g. "session.started", "answer.rejected".
 * Logging never throws: a broken log handler must not fail a request.
 */
class FunGameLogger
{
    private ?string $requestId = null;

    public function info(string $event, array $context = []): void
    {
        $this->write('info', $event, $context);
    }

    public function warning(string $event, array $context = []): void
    {
        $this->write('warning', $event, $context);
    }

    public function error(string $event, array $context = [], ?Throwable $exception = null): void
    {
        if ($exception) {
            $context['exception'] = $exception::class;
            $context['error'] = $exception->getMessage();
            $context['at'] = $exception->getFile() . ':' . $exception->getLine();
        }
        $this->write('error', $event, $context);
    }

    private function write(string $level, string $event, array $context): void
    {
        try {
            Log::channel('fungames')->{$level}($event, $context + ['request_id' => $this->requestId()]);
        } catch (Throwable) {
            // ignore
        }
    }

    private function requestId(): string
    {
        if ($this->requestId !== null) {
            return $this->requestId;
        }
        if (app()->runningInConsole() && ! app()->runningUnitTests()) {
            return $this->requestId = 'cli';
        }
        $header = request()->header('X-Request-Id');

        return $this->requestId = is_string($header) && $header !== '' ? Str::limit($header, 64, '') : (string) Str::uuid();
    }
}
