<?php

namespace App\Models\Deck;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Anonymous audience member. Only the SHA-256 hash of the participant token is stored. */
class DeckParticipant extends Model
{
    /** @use HasFactory<\Database\Factories\Deck\DeckParticipantFactory> */
    use HasFactory;

    protected $dateFormat = 'Y-m-d H:i:s.vP';

    protected $fillable = [
        'deck_session_id',
        'display_name',
        'emoji_avatar',
        'participant_token_hash',
        'participant_token_expires_at',
        'participant_token_revoked_at',
        'total_points',
        'joined_at',
        'left_at',
    ];

    protected $hidden = [
        'participant_token_hash',
    ];

    protected $casts = [
        'deck_session_id' => 'integer',
        'total_points' => 'integer',
        'participant_token_expires_at' => 'datetime',
        'participant_token_revoked_at' => 'datetime',
        'joined_at' => 'datetime',
        'left_at' => 'datetime',
    ];

    public function session(): BelongsTo
    {
        return $this->belongsTo(DeckSession::class, 'deck_session_id');
    }

    public function answers(): HasMany
    {
        return $this->hasMany(DeckParticipantAnswer::class);
    }

    public function qaQuestions(): HasMany
    {
        return $this->hasMany(DeckQaQuestion::class, 'participant_id');
    }

    public function qaUpvotes(): HasMany
    {
        return $this->hasMany(DeckQaUpvote::class, 'participant_id');
    }
}
