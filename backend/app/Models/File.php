<?php

namespace App\Models;

use App\Modules\FileLibrary\Models\FileTextContent;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A file in a user's library ("My Files"). Images are public (served from
 * /storage); documents are private and served through the library API.
 * Soft-deleted files stay on disk but no longer count toward the quota.
 */
class File extends Model
{
    use SoftDeletes;

    public const CATEGORY_IMAGE = 'image';

    public const CATEGORY_DOCUMENT = 'document';

    public const VISIBILITY_PUBLIC = 'public';

    public const VISIBILITY_PRIVATE = 'private';

    protected $fillable = [
        'name',
        'path',
        'type',
        'category',
        'size',
        'mime_type',
        'extension',
        'original_name',
        'disk',
        'disk_path',
        'visibility',
        'checksum',
        'page_count',
        'extraction_status',
        'last_used_at',
        'user_id',
        'is_active',
        'is_deleted',
        'deleted_at',
        'restored_at',
        'created_by',
        'updated_by',
        'deleted_by',
        'restored_by',
    ];

    protected $dates = ['deleted_at', 'restored_at'];

    protected $hidden = ['disk', 'disk_path', 'checksum'];

    protected $appends = ['url'];

    protected $casts = [
        'is_active' => 'boolean',
        'is_deleted' => 'boolean',
        'size' => 'integer',
        'page_count' => 'integer',
        'user_id' => 'integer',
        'created_by' => 'integer',
        'updated_by' => 'integer',
        'deleted_by' => 'integer',
        'restored_by' => 'integer',
        'last_used_at' => 'datetime',
    ];

    /**
     * Accessor: Returns the full URL if path is a file path.
     */
    public function getPathAttribute(?string $path): ?string
    {
        // Private documents have no public path
        return $path ? url($path) : null;
    }

    /** Where the browser can load the file: public URL for images, the authenticated API for documents. */
    public function getUrlAttribute(): string
    {
        if ($this->visibility !== self::VISIBILITY_PRIVATE && $this->getRawOriginal('path')) {
            return url($this->getRawOriginal('path'));
        }

        return route('library.files.content', ['file' => $this->id]);
    }

    public function isImage(): bool
    {
        return $this->category === self::CATEGORY_IMAGE;
    }

    // Relationships
    /**
     * The user who uploaded the file.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function textContent(): HasOne
    {
        return $this->hasOne(FileTextContent::class);
    }

    // Scopes
    public function scopeActive($query): Builder
    {
        return $query->where('is_active', true);
    }

    public function scopeInactive($query): Builder
    {
        return $query->where('is_active', false);
    }

    public function scopeDeleted($query): Builder
    {
        return $query->where('is_deleted', true);
    }

    public function scopeNotDeleted($query): Builder
    {
        return $query->where('is_deleted', false);
    }

    public function scopeByType($query, $type): Builder
    {
        return $query->where('type', $type);
    }

    public function scopeByCategory($query, $category): Builder
    {
        return $query->where('category', $category);
    }

    public function scopeByUser($query, $userId): Builder
    {
        return $query->where('user_id', $userId);
    }

    public function scopeSearch($query, $term): Builder
    {
        $like = '%' . addcslashes((string) $term, '%_\\') . '%';

        return $query->where(function ($q) use ($like) {
            $q->where('name', 'ILIKE', $like)
                ->orWhere('original_name', 'ILIKE', $like);
        });
    }

    public function scopeDateBetween($query, $from, $to): Builder
    {
        return $query->whereBetween('created_at', [$from, $to]);
    }
}
