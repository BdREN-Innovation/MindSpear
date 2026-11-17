<?php

namespace App\Models\Deck;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeckQaUpvote extends Model
{
    /** @use HasFactory<\Database\Factories\Deck\DeckQaUpvoteFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    protected $dateFormat = 'Y-m-d H:i:s.vP';

    protected $fillable = [
        'qa_question_id',
        'participant_id',
    ];

    protected $casts = [
        'qa_question_id' => 'integer',
        'participant_id' => 'integer',
    ];

    public function question(): BelongsTo
    {
        return $this->belongsTo(DeckQaQuestion::class, 'qa_question_id');
    }

    public function participant(): BelongsTo
    {
        return $this->belongsTo(DeckParticipant::class, 'participant_id');
    }
}
