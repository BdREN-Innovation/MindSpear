<?php

namespace App\Models\Deck;

use App\Models\File;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SlideOption extends Model
{
    /** @use HasFactory<\Database\Factories\Deck\SlideOptionFactory> */
    use HasFactory;

    protected $fillable = [
        'slide_id',
        'position',
        'label',
        'image_file_id',
        'is_correct',
        'payload',
    ];

    protected $attributes = [
        'payload' => '{}',
    ];

    protected $casts = [
        'slide_id' => 'integer',
        'position' => 'integer',
        'image_file_id' => 'integer',
        'is_correct' => 'boolean',
        'payload' => 'array',
    ];

    public function slide(): BelongsTo
    {
        return $this->belongsTo(Slide::class);
    }

    public function imageFile(): BelongsTo
    {
        return $this->belongsTo(File::class, 'image_file_id')->withTrashed();
    }
}
