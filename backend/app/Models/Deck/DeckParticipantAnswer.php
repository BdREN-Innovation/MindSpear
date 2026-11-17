<?php

namespace App\Models\Deck;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One row per participant per slide run; multi-entry types keep a list inside `answer_payload`. */
class DeckParticipantAnswer extends Model
{
    /** @use HasFactory<\Database\Factories\Deck\DeckParticipantAnswerFactory> */
    use HasFactory;

    protected $dateFormat = 'Y-m-d H:i:s.vP';

    protected $fillable = [
        'deck_participant_id',
        'slide_run_id',
        'answer_payload',
        'time_to_answer_ms',
        'is_correct',
        'points_awarded',
        'submitted_at',
    ];

    protected $casts = [
        'deck_participant_id' => 'integer',
        'slide_run_id' => 'integer',
        'answer_payload' => 'array',
        'time_to_answer_ms' => 'integer',
        'is_correct' => 'boolean',
        'points_awarded' => 'integer',
        'submitted_at' => 'datetime',
    ];

    public function participant(): BelongsTo
    {
        return $this->belongsTo(DeckParticipant::class, 'deck_participant_id');
    }

    public function run(): BelongsTo
    {
        return $this->belongsTo(DeckSessionSlideRun::class, 'slide_run_id');
    }
}
