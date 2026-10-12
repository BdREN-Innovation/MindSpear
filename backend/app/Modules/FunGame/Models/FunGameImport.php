<?php

namespace App\Modules\FunGame\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FunGameImport extends Model
{
    protected $fillable = [
        'fun_game_id',
        'user_id',
        'source',
        'source_quiz_id',
        'mode',
        'previous_questions',
        'previous_timer',
        'added_count',
        'removed_count',
        'undone_at',
        'added_question_ids',
        'removed_question_ids',
        'skipped',
    ];

    protected $casts = [
        'fun_game_id' => 'integer',
        'user_id' => 'integer',
        'source_quiz_id' => 'integer',
        'previous_questions' => 'array',
        'previous_timer' => 'array',
        'added_count' => 'integer',
        'removed_count' => 'integer',
        'undone_at' => 'datetime',
        'added_question_ids' => 'array',
        'removed_question_ids' => 'array',
        'skipped' => 'array',
    ];

    public function game(): BelongsTo
    {
        return $this->belongsTo(FunGame::class, 'fun_game_id');
    }
}
