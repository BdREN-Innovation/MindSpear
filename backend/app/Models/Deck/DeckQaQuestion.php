<?php

namespace App\Models\Deck;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Audience question on a qa_audience slide. Change `upvote_count` only with
 * an atomic `upvote_count = upvote_count ± 1` update, never read-modify-write.
 */
class DeckQaQuestion extends Model
{
    /** @use HasFactory<\Database\Factories\Deck\DeckQaQuestionFactory> */
    use HasFactory;

    protected $dateFormat = 'Y-m-d H:i:s.vP';

    protected $fillable = [
        'deck_session_id',
        'slide_run_id',
        'participant_id',
        'body',
        'upvote_count',
        'is_answered',
        'is_hidden',
        'is_starred',
        'submitted_at',
    ];

    protected $attributes = [
        'upvote_count' => 0,
        'is_answered' => false,
        'is_hidden' => false,
        'is_starred' => false,
    ];

    protected $casts = [
        'deck_session_id' => 'integer',
        'slide_run_id' => 'integer',
        'participant_id' => 'integer',
        'upvote_count' => 'integer',
        'is_answered' => 'boolean',
        'is_hidden' => 'boolean',
        'is_starred' => 'boolean',
        'submitted_at' => 'datetime',
    ];

    public function session(): BelongsTo
    {
        return $this->belongsTo(DeckSession::class, 'deck_session_id');
    }

    public function run(): BelongsTo
    {
        return $this->belongsTo(DeckSessionSlideRun::class, 'slide_run_id');
    }

    public function participant(): BelongsTo
    {
        return $this->belongsTo(DeckParticipant::class, 'participant_id');
    }

    public function upvotes(): HasMany
    {
        return $this->hasMany(DeckQaUpvote::class, 'qa_question_id');
    }

    /** Questions the audience may see (host-hidden ones excluded). */
    public function scopeVisible(Builder $query): Builder
    {
        return $query->where($this->qualifyColumn('is_hidden'), false);
    }
}
