<?php

namespace App\Modules\FunGame\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Soft-deleted when removed from a game, so sessions that already used the
 * question keep it. Look questions up `withTrashed()` by a session's ids.
 */
class FunGameQuestion extends Model
{
    use SoftDeletes;

    public const TYPE_SINGLE_CHOICE = 'single_choice';

    protected $fillable = [
        'fun_game_id',
        'position',
        'type',
        'text',
        'image_url',
        'options',
        'correct_option_id',
        'marks',
        'negative_marks',
        'seconds_override',
    ];

    protected $casts = [
        'fun_game_id' => 'integer',
        'position' => 'integer',
        'options' => 'array',
        'marks' => 'float',
        'negative_marks' => 'float',
        'seconds_override' => 'integer',
    ];

    public function game(): BelongsTo
    {
        return $this->belongsTo(FunGame::class, 'fun_game_id');
    }

    public function hasOption(?string $optionId): bool
    {
        return $optionId !== null
            && collect($this->options)->contains(fn (array $option) => $option['id'] === $optionId);
    }
}
