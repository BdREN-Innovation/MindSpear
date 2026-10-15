<?php

namespace App\Models\Deck;

use App\Models\File;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A unit of authoring in the shared slide engine. `product` decides which
 * slide types, reveal model and scoring apply (Quest now, Quiz later).
 */
class Deck extends Model
{
    /** @use HasFactory<\Database\Factories\Deck\DeckFactory> */
    use HasFactory;

    use SoftDeletes;

    public const PRODUCT_QUEST = 'quest';

    public const PRODUCT_QUIZ = 'quiz';

    public const PRODUCTS = [self::PRODUCT_QUEST, self::PRODUCT_QUIZ];

    protected $fillable = [
        'owner_id',
        'product',
        'title',
        'description',
        'cover_file_id',
        'settings',
        'published_at',
    ];

    protected $attributes = [
        'settings' => '{}',
    ];

    protected $casts = [
        'owner_id' => 'integer',
        'cover_file_id' => 'integer',
        'settings' => 'array',
        'published_at' => 'datetime',
    ];

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    /** Live (not soft-deleted) slides in presentation order. */
    public function slides(): HasMany
    {
        return $this->hasMany(Slide::class)->orderBy('position')->orderBy('id');
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(DeckSession::class);
    }

    /** Library files are soft-deleted; a deck keeps showing a cover its owner removed from My Files. */
    public function coverFile(): BelongsTo
    {
        return $this->belongsTo(File::class, 'cover_file_id')->withTrashed();
    }

    public function isQuest(): bool
    {
        return $this->product === self::PRODUCT_QUEST;
    }

    public function isQuiz(): bool
    {
        return $this->product === self::PRODUCT_QUIZ;
    }

    public function scopeQuest(Builder $query): Builder
    {
        return $query->where($this->qualifyColumn('product'), self::PRODUCT_QUEST);
    }

    public function scopeQuiz(Builder $query): Builder
    {
        return $query->where($this->qualifyColumn('product'), self::PRODUCT_QUIZ);
    }

    public function scopeForProduct(Builder $query, string $product): Builder
    {
        return $query->where($this->qualifyColumn('product'), $product);
    }

    public function scopeOwnedBy(Builder $query, User|int $user): Builder
    {
        return $query->where($this->qualifyColumn('owner_id'), $user instanceof User ? $user->getKey() : $user);
    }
}
