<?php

namespace App\Modules\FunGame\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FunGameAnswer extends Model
{
    /** Keep milliseconds: deadlines and answer times are scored to the millisecond. */
    protected $dateFormat = 'Y-m-d H:i:s.vP';

    protected $fillable = [
        'fun_game_participant_id',
        'fun_game_question_id',
        'option_id',
        'submitted_at',
        'is_correct',
        'opened_at',
        'response_ms',
        'points',
    ];

    protected $casts = [
        'fun_game_participant_id' => 'integer',
        'fun_game_question_id' => 'integer',
        'submitted_at' => 'datetime',
        'is_correct' => 'boolean',
        'opened_at' => 'datetime',
        'response_ms' => 'integer',
        'points' => 'float',
    ];

    public function participant(): BelongsTo
    {
        return $this->belongsTo(FunGameParticipant::class, 'fun_game_participant_id');
    }

    public function question(): BelongsTo
    {
        return $this->belongsTo(FunGameQuestion::class, 'fun_game_question_id');
    }
}
