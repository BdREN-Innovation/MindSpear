<?php

namespace App\Models\Deck;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\DB;

/**
 * A slide frozen for one session (type, title, body, config, options) plus
 * its runtime state. All live behaviour reads these snapshots, never the
 * authoring Slide. `state_version` increments on every transition so clients
 * can drop stale events.
 */
class DeckSessionSlideRun extends Model
{
    /** @use HasFactory<\Database\Factories\Deck\DeckSessionSlideRunFactory> */
    use HasFactory;

    public const STATE_WAITING = 'waiting';

    public const STATE_GET_READY = 'get_ready';

    public const STATE_VOTING = 'voting';

    /** Q&A slides use `open` instead of `voting`: no timer, moderation queue. */
    public const STATE_OPEN = 'open';

    public const STATE_CLOSED = 'closed';

    /**
     * Quiz (hidden_until_reveal) and spinner runs end here instead of
     * `closed`: answers are no longer accepted and the correct answer,
     * aggregate and leaderboard delta are public. Terminal, like `closed`.
     */
    public const STATE_REVEAL = 'reveal';

    public const STATES = [
        self::STATE_WAITING,
        self::STATE_GET_READY,
        self::STATE_VOTING,
        self::STATE_OPEN,
        self::STATE_CLOSED,
        self::STATE_REVEAL,
    ];

    /** States after which a run never takes answers again (its aggregate is final). */
    public const FINAL_STATES = [
        self::STATE_CLOSED,
        self::STATE_REVEAL,
    ];

    protected $table = 'deck_session_slide_runs';

    /** Keep milliseconds: timers and answer times are measured to the millisecond. */
    protected $dateFormat = 'Y-m-d H:i:s.vP';

    protected $fillable = [
        'deck_session_id',
        'slide_id',
        'position_snapshot',
        'type_snapshot',
        'title_snapshot',
        'body_snapshot',
        'config_snapshot',
        'options_snapshot',
        'time_limit_seconds',
        'get_ready_seconds',
        'state',
        'state_version',
        'state_started_at',
        'voting_started_at',
        'closed_at',
    ];

    protected $attributes = [
        'config_snapshot' => '{}',
        'options_snapshot' => '[]',
        'state' => self::STATE_WAITING,
        'state_version' => 0,
    ];

    protected $casts = [
        'deck_session_id' => 'integer',
        'slide_id' => 'integer',
        'position_snapshot' => 'integer',
        'body_snapshot' => 'array',
        'config_snapshot' => 'array',
        'options_snapshot' => 'array',
        'time_limit_seconds' => 'integer',
        'get_ready_seconds' => 'integer',
        'state_version' => 'integer',
        'state_started_at' => 'datetime',
        'voting_started_at' => 'datetime',
        'closed_at' => 'datetime',
    ];

    public function session(): BelongsTo
    {
        return $this->belongsTo(DeckSession::class, 'deck_session_id');
    }

    /** The authoring slide; null once it was hard-deleted. */
    public function slide(): BelongsTo
    {
        return $this->belongsTo(Slide::class)->withTrashed();
    }

    public function answers(): HasMany
    {
        return $this->hasMany(DeckParticipantAnswer::class, 'slide_run_id');
    }

    public function qaQuestions(): HasMany
    {
        return $this->hasMany(DeckQaQuestion::class, 'slide_run_id');
    }

    /** Submissions are accepted while voting (polls) or open (Q&A). */
    public function acceptsSubmissions(): bool
    {
        return in_array($this->state, [self::STATE_VOTING, self::STATE_OPEN], true);
    }

    /** closed or reveal: no more answers, the aggregate is final. */
    public function isFinal(): bool
    {
        return in_array($this->state, self::FINAL_STATES, true);
    }

    public function isRevealed(): bool
    {
        return $this->state === self::STATE_REVEAL;
    }

    /** Runs that are the current slide of their session. */
    public function scopeCurrent(Builder $query): Builder
    {
        return $query->whereExists(fn ($sub) => $sub->select(DB::raw(1))
            ->from('deck_sessions')
            ->whereColumn('deck_sessions.current_slide_run_id', $this->qualifyColumn('id')));
    }
}
