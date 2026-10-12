<?php

namespace App\Modules\FunGame\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FunGameSession extends Model
{
    public const STATUS_WAITING = 'waiting';

    public const STATUS_LIVE = 'live';

    public const STATUS_FINISHING = 'finishing';

    public const STATUS_FINISHED = 'finished';

    /** Keep milliseconds: deadlines and answer times are scored to the millisecond. */
    protected $dateFormat = 'Y-m-d H:i:s.vP';

    protected $fillable = [
        'fun_game_id',
        'join_code',
        'public_channel_key',
        'status',
        'starts_at',
        'started_at',
        'deadline',
        'current_question_index',
        'current_question_id',
        'question_opened_at',
        'question_deadline',
        'locked_question_index',
        'next_opens_at',
        'finishing_at',
        'finished_at',
        'timer_snapshot',
        'ended_by_host',
        'join_closes_at',
        'ends_at',
    ];

    protected $casts = [
        'fun_game_id' => 'integer',
        'starts_at' => 'datetime',
        'started_at' => 'datetime',
        'deadline' => 'datetime',
        'current_question_index' => 'integer',
        'current_question_id' => 'integer',
        'question_opened_at' => 'datetime',
        'question_deadline' => 'datetime',
        'locked_question_index' => 'integer',
        'next_opens_at' => 'datetime',
        'finishing_at' => 'datetime',
        'finished_at' => 'datetime',
        'timer_snapshot' => 'array',
        'ended_by_host' => 'boolean',
        'join_closes_at' => 'datetime',
        'ends_at' => 'datetime',
    ];

    public function game(): BelongsTo
    {
        return $this->belongsTo(FunGame::class, 'fun_game_id')->withTrashed();
    }

    public function participants(): HasMany
    {
        return $this->hasMany(FunGameParticipant::class);
    }

    public function isPerQuestion(): bool
    {
        $mode = $this->timer_snapshot['mode'] ?? $this->game?->timer_mode;

        return $mode === FunGame::TIMER_PER_QUESTION;
    }

    /** Question ids in play order: frozen at start, the game's current order before that. */
    public function questionIds(): array
    {
        if (isset($this->timer_snapshot['question_ids'])) {
            return array_map('intval', $this->timer_snapshot['question_ids']);
        }

        return $this->game->questions()->pluck('id')->map(fn ($id) => (int) $id)->all();
    }

    /** marks | speed, frozen when the session starts. */
    public function scoringMode(): string
    {
        return $this->timer_snapshot['scoring_mode'] ?? $this->game?->scoring_mode ?? FunGame::SCORING_MARKS;
    }

    /** How many questions each player answers (from the snapshot once started). */
    public function questionsPerPlayer(): int
    {
        $pool = count($this->questionIds());
        $n = $this->timer_snapshot['per_player'] ?? $this->game?->questions_per_player;

        return $n ? min((int) $n, $pool) : $pool;
    }

    /** The questions every player shares ("same" selection), or null when each player draws their own. */
    public function sharedQuestionIds(): ?array
    {
        if (($this->timer_snapshot['selection'] ?? FunGame::SELECTION_SAME) === FunGame::SELECTION_DIFFERENT) {
            return null;
        }

        return array_map('intval', $this->timer_snapshot['drawn_ids'] ?? $this->questionIds());
    }

    public function isJoinOpen(): bool
    {
        return $this->status === self::STATUS_WAITING
            || ($this->status === self::STATUS_LIVE && (! $this->join_closes_at || now()->lt($this->join_closes_at)));
    }
}
