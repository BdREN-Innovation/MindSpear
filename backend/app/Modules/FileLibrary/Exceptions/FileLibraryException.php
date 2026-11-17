<?php

namespace App\Modules\FileLibrary\Exceptions;

use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * A rule the file library refuses to break (storage full, wrong file type, …).
 * Rendered in the app's usual {status, message, data} shape; `validation_errors.file`
 * is filled for upload problems so existing upload forms show the message.
 */
class FileLibraryException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $status = 422,
        public readonly string $errorCode = 'invalid_file',
        public readonly array $extra = [],
    ) {
        parent::__construct($message);
    }

    public static function quotaExceeded(int $used, int $limit, int $required): self
    {
        $message = sprintf(
            'Not enough storage: this file needs %s but only %s of your %s is free. Delete some files in My Files to make room.',
            self::formatBytes($required),
            self::formatBytes(max(0, $limit - $used)),
            self::formatBytes($limit),
        );

        return new self($message, 422, 'quota_exceeded', ['used' => $used, 'limit' => $limit, 'required' => $required]);
    }

    public static function dailyUploadLimit(int $uploaded, int $limit, int $required): self
    {
        $message = sprintf(
            'Upload limit reached: you have uploaded %s in the last 24 hours (deleted files included) and the daily limit is %s. Please try again later.',
            self::formatBytes($uploaded),
            self::formatBytes($limit),
        );

        return new self($message, 422, 'daily_upload_limit', ['uploaded' => $uploaded, 'limit' => $limit, 'required' => $required]);
    }

    public static function invalidFile(string $message): self
    {
        return new self($message, 422, 'invalid_file');
    }

    public static function inUse(array $references, string $category = 'image'): self
    {
        $total = array_sum($references);
        $noun = in_array($category, ['image', 'video'], true) ? $category : 'file';

        return new self(
            sprintf('This %s is used in %d %s. Those places keep showing it, but it will no longer be in My Files.', $noun, $total, $total === 1 ? 'place' : 'places'),
            409,
            'file_in_use',
            ['references' => $references, 'total' => $total],
        );
    }

    public static function notFound(string $message = 'File not found.'): self
    {
        return new self($message, 404, 'not_found');
    }

    public static function formatBytes(int $bytes): string
    {
        if ($bytes >= 1024 * 1024 * 1024) {
            return round($bytes / (1024 * 1024 * 1024), 1) . ' GB';
        }
        if ($bytes >= 1024 * 1024) {
            return round($bytes / (1024 * 1024), 1) . ' MB';
        }
        if ($bytes >= 1024) {
            return round($bytes / 1024) . ' KB';
        }

        return $bytes . ' B';
    }

    /** Expected outcomes, not errors; keep them out of laravel.log. */
    public function report(): void {}

    public function render(): JsonResponse
    {
        $data = ['code' => $this->errorCode] + $this->extra;
        if ($this->status === 422) {
            $data['validation_errors'] = ['file' => [$this->getMessage()]];
        }

        return response()->json([
            'status' => false,
            'message' => $this->getMessage(),
            'data' => $data,
        ], $this->status);
    }
}
