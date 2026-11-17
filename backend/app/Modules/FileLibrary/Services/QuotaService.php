<?php

namespace App\Modules\FileLibrary\Services;

use App\Models\File;
use App\Models\User;
use App\Modules\FileLibrary\Exceptions\FileLibraryException;
use Closure;
use Illuminate\Support\Facades\DB;

/**
 * Per-user storage quota. Usage is the sum of the user's live files;
 * soft-deleted files are excluded, so deleting frees space right away.
 */
class QuotaService
{
    /** Namespace for pg_advisory_xact_lock(namespace, user_id). */
    private const LOCK_NAMESPACE = 7301;

    public function defaultLimit(): int
    {
        return max(0, (int) config('file_library.default_quota_mb', 100)) * 1024 * 1024;
    }

    public function limitFor(User $user): int
    {
        return $user->storage_quota_bytes ?? $this->defaultLimit();
    }

    public function usedBy(int $userId): int
    {
        return (int) File::where('user_id', $userId)->sum('size');
    }

    /** At least the default daily allowance, and never less than the user's own quota. */
    public function dailyUploadLimitFor(User $user): int
    {
        return max(max(0, (int) config('file_library.max_daily_upload_mb', 1024)) * 1024 * 1024, $this->limitFor($user));
    }

    /**
     * Bytes written for the user in the last 24 hours, files deleted since included:
     * a delete frees quota but leaves the bytes on disk.
     */
    public function uploadedToday(int $userId): int
    {
        return (int) File::withTrashed()
            ->where('user_id', $userId)
            ->where('created_at', '>=', now()->subDay())
            ->sum('size');
    }

    public function usage(User $user): array
    {
        $rows = File::where('user_id', $user->id)
            ->selectRaw('category, COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes')
            ->groupBy('category')
            ->get()
            ->keyBy('category');

        $byCategory = fn (string $category) => [
            'count' => (int) ($rows[$category]->files ?? 0),
            'bytes' => (int) ($rows[$category]->bytes ?? 0),
        ];
        $images = $byCategory(File::CATEGORY_IMAGE);
        $documents = $byCategory(File::CATEGORY_DOCUMENT);
        $videos = $byCategory(File::CATEGORY_VIDEO);
        $used = $images['bytes'] + $documents['bytes'] + $videos['bytes'];
        $limit = $this->limitFor($user);

        return [
            'used' => $used,
            'limit' => $limit,
            'remaining' => max(0, $limit - $used),
            'percent' => $limit > 0 ? min(100, round($used / $limit * 100, 1)) : 100,
            'images' => $images,
            'documents' => $documents,
            'videos' => $videos,
            'maxFileSize' => [
                'image' => (int) config('file_library.max_image_mb') * 1024 * 1024,
                'document' => (int) config('file_library.max_document_mb') * 1024 * 1024,
                'video' => (int) config('file_library.max_video_mb') * 1024 * 1024,
            ],
            'allowed' => config('file_library.allowed'),
        ];
    }

    /**
     * Runs $insert only if $bytes still fit in the user's quota (and, for a new
     * file, in their daily upload allowance). The advisory lock serialises
     * concurrent uploads by the same user so two can't both squeeze in.
     *
     * @template T
     *
     * @param  Closure(): T  $insert
     * @return T
     */
    public function withReservation(User $user, int $bytes, Closure $insert, bool $newFile = false): mixed
    {
        return DB::transaction(function () use ($user, $bytes, $insert, $newFile) {
            DB::select('SELECT pg_advisory_xact_lock(?, ?)', [self::LOCK_NAMESPACE, $user->id]);

            $used = $this->usedBy($user->id);
            $limit = $this->limitFor($user);
            if ($bytes > 0 && $used + $bytes > $limit) {
                throw FileLibraryException::quotaExceeded($used, $limit, $bytes);
            }

            // Replacing a file's bytes deletes the old ones, so only new files count here.
            if ($newFile && $bytes > 0) {
                $uploaded = $this->uploadedToday($user->id);
                $dailyLimit = $this->dailyUploadLimitFor($user);
                if ($uploaded + $bytes > $dailyLimit) {
                    throw FileLibraryException::dailyUploadLimit($uploaded, $dailyLimit, $bytes);
                }
            }

            return $insert();
        });
    }
}
