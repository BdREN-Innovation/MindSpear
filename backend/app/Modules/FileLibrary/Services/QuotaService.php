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
        $used = $images['bytes'] + $documents['bytes'];
        $limit = $this->limitFor($user);

        return [
            'used' => $used,
            'limit' => $limit,
            'remaining' => max(0, $limit - $used),
            'percent' => $limit > 0 ? min(100, round($used / $limit * 100, 1)) : 100,
            'images' => $images,
            'documents' => $documents,
            'maxFileSize' => [
                'image' => (int) config('file_library.max_image_mb') * 1024 * 1024,
                'document' => (int) config('file_library.max_document_mb') * 1024 * 1024,
            ],
            'allowed' => config('file_library.allowed'),
        ];
    }

    /**
     * Runs $insert only if $bytes still fit in the user's quota. The advisory lock
     * serialises concurrent uploads by the same user so two can't both squeeze in.
     *
     * @template T
     *
     * @param  Closure(): T  $insert
     * @return T
     */
    public function withReservation(User $user, int $bytes, Closure $insert): mixed
    {
        return DB::transaction(function () use ($user, $bytes, $insert) {
            DB::select('SELECT pg_advisory_xact_lock(?, ?)', [self::LOCK_NAMESPACE, $user->id]);

            $used = $this->usedBy($user->id);
            $limit = $this->limitFor($user);
            if ($bytes > 0 && $used + $bytes > $limit) {
                throw FileLibraryException::quotaExceeded($used, $limit, $bytes);
            }

            return $insert();
        });
    }
}
