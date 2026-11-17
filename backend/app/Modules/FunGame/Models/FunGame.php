<?php

namespace App\Modules\FunGame\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

class FunGame extends Model
{
    use SoftDeletes;

    public const STATUS_DRAFT = 'draft';

    public const STATUS_PUBLISHED = 'published';

    public const TIMER_TOTAL = 'total';

    public const TIMER_PER_QUESTION = 'per_question';

    public const SCORING_MARKS = 'marks';

    /** Kahoot-style: correct answers earn more the faster they come. */
    public const SCORING_SPEED = 'speed';

    /** Every player gets the same questions (drawn when the game starts). */
    public const SELECTION_SAME = 'same';

    /** Every player gets their own random questions from the pool. */
    public const SELECTION_DIFFERENT = 'different';

    protected $fillable = [
        'user_id',
        'title',
        'description',
        'instructions',
        'status',
        'timer_mode',
        'total_seconds',
        'allow_navigation',
        'seconds_per_question',
        'default_marks',
        'default_negative_marks',
        'source_deck_id',
        'scoring_mode',
        'shuffle_questions',
        'questions_per_player',
        'question_selection',
    ];

    protected $casts = [
        'user_id' => 'integer',
        'total_seconds' => 'integer',
        'allow_navigation' => 'boolean',
        'seconds_per_question' => 'integer',
        'default_marks' => 'float',
        'default_negative_marks' => 'float',
        'source_deck_id' => 'integer',
        'shuffle_questions' => 'boolean',
        'questions_per_player' => 'integer',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function questions(): HasMany
    {
        return $this->hasMany(FunGameQuestion::class)->orderBy('position')->orderBy('id');
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(FunGameSession::class);
    }

    public function latestSession(): HasOne
    {
        return $this->hasOne(FunGameSession::class)->latestOfMany();
    }

    public function isPerQuestion(): bool
    {
        return $this->timer_mode === self::TIMER_PER_QUESTION;
    }

    /** A session that is running blocks changes to questions and timer. */
    public function hasRunningSession(): bool
    {
        return $this->sessions()
            ->whereIn('status', [FunGameSession::STATUS_LIVE, FunGameSession::STATUS_FINISHING])
            ->exists();
    }

    public function hasOpenSession(): bool
    {
        return $this->sessions()->where('status', '!=', FunGameSession::STATUS_FINISHED)->exists();
    }
}
