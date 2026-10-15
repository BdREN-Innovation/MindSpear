<?php

namespace App\Models\Deck;

use App\Models\File;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * An authoring slide. Mutable: live sessions never read it after start, they
 * read the DeckSessionSlideRun snapshot. Positions are 1-based and unique per
 * deck among non-deleted slides (partial unique index).
 */
class Slide extends Model
{
    /** @use HasFactory<\Database\Factories\Deck\SlideFactory> */
    use HasFactory;

    use SoftDeletes;

    protected $fillable = [
        'deck_id',
        'type',
        'position',
        'title',
        'body',
        'config',
        'media_file_id',
        'time_limit_seconds',
        'get_ready_seconds',
        'points_min',
        'points_max',
        'speed_bonus_enabled',
    ];

    protected $attributes = [
        'config' => '{}',
    ];

    protected $casts = [
        'deck_id' => 'integer',
        'position' => 'integer',
        'body' => 'array',
        'config' => 'array',
        'media_file_id' => 'integer',
        'time_limit_seconds' => 'integer',
        'get_ready_seconds' => 'integer',
        'points_min' => 'integer',
        'points_max' => 'integer',
        'speed_bonus_enabled' => 'boolean',
    ];

    public function deck(): BelongsTo
    {
        return $this->belongsTo(Deck::class);
    }

    public function options(): HasMany
    {
        return $this->hasMany(SlideOption::class)->orderBy('position')->orderBy('id');
    }

    /** Image (image / pin_on_image) or mp4 (video). Includes files soft-deleted from My Files. */
    public function mediaFile(): BelongsTo
    {
        return $this->belongsTo(File::class, 'media_file_id')->withTrashed();
    }

    public function runs(): HasMany
    {
        return $this->hasMany(DeckSessionSlideRun::class);
    }
}
