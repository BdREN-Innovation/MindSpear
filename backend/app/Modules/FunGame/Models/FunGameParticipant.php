<?php

namespace App\Modules\FunGame\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FunGameParticipant extends Model
{
    /** Keep milliseconds: deadlines and answer times are scored to the millisecond. */
    protected $dateFormat = 'Y-m-d H:i:s.vP';

    protected $fillable = [
        'fun_game_session_id',
        'name',
        'email',
        'joined_at',
        'last_seen_at',
        'finished_at',
        'score',
        'correct_count',
        'incorrect_count',
        'unanswered_count',
        'rank',
        'question_order',
        'current_index',
        'current_opened_at',
        'current_deadline',
        'first_opened_at',
        'personal_deadline',
        'elapsed_ms',
    ];

    protected $hidden = [
        'participant_token_hash',
        'participant_token_expires_at',
        'participant_token_revoked_at',
    ];

    protected $casts = [
        'fun_game_session_id' => 'integer',
        'participant_token_expires_at' => 'datetime',
        'participant_token_revoked_at' => 'datetime',
        'joined_at' => 'datetime',
        'last_seen_at' => 'datetime',
        'finished_at' => 'datetime',
        'score' => 'float',
        'correct_count' => 'integer',
        'incorrect_count' => 'integer',
        'unanswered_count' => 'integer',
        'rank' => 'integer',
        'question_order' => 'array',
        'current_index' => 'integer',
        'current_opened_at' => 'datetime',
        'current_deadline' => 'datetime',
        'first_opened_at' => 'datetime',
        'personal_deadline' => 'datetime',
        'elapsed_ms' => 'integer',
    ];

    public function session(): BelongsTo
    {
        return $this->belongsTo(FunGameSession::class, 'fun_game_session_id');
    }

    public function answers(): HasMany
    {
        return $this->hasMany(FunGameAnswer::class);
    }
}
