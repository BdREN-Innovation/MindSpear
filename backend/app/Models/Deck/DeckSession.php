<?php

namespace App\Models\Deck;

use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class DeckSession extends Model
{
    /** @use HasFactory<\Database\Factories\Deck\DeckSessionFactory> */
    use HasFactory;

    public const STATUS_PENDING = 'pending';

    public const STATUS_LIVE = 'live';

    public const STATUS_ENDED = 'ended';

    /** Keep milliseconds: timers and answer times are measured to the millisecond. */
    protected $dateFormat = 'Y-m-d H:i:s.vP';

    protected $fillable = [
        'deck_id',
        'host_user_id',
        'public_channel_key',
        'join_code',
        'status',
        'current_slide_run_id',
        'timer_state',
        'started_at',
        'ended_at',
    ];

    protected $hidden = [
        'public_channel_key',
    ];

    protected $attributes = [
        'status' => self::STATUS_PENDING,
    ];

    protected $casts = [
        'deck_id' => 'integer',
        'host_user_id' => 'integer',
        'current_slide_run_id' => 'integer',
        'timer_state' => 'array',
        'started_at' => 'datetime',
        'ended_at' => 'datetime',
    ];

    public function deck(): BelongsTo
    {
        return $this->belongsTo(Deck::class)->withTrashed();
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(User::class, 'host_user_id');
    }

    public function runs(): HasMany
    {
        return $this->hasMany(DeckSessionSlideRun::class)->orderBy('position_snapshot');
    }

    public function currentRun(): BelongsTo
    {
        return $this->belongsTo(DeckSessionSlideRun::class, 'current_slide_run_id');
    }

    public function participants(): HasMany
    {
        return $this->hasMany(DeckParticipant::class);
    }

    public function qaQuestions(): HasMany
    {
        return $this->hasMany(DeckQaQuestion::class);
    }

    /** Product of the deck this session runs (quest | quiz). */
    public function product(): string
    {
        return $this->loadMissing('deck')->deck->product;
    }

    public function isLive(): bool
    {
        return $this->status === self::STATUS_LIVE;
    }

    public function scopeLive(Builder $query): Builder
    {
        return $query->where($this->qualifyColumn('status'), self::STATUS_LIVE);
    }

    public function scopeForProduct(Builder $query, string $product): Builder
    {
        return $query->whereHas('deck', fn (Builder $deck) => $deck->where('product', $product));
    }
}
