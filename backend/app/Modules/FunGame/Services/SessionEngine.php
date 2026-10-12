<?php

namespace App\Modules\FunGame\Services;

use App\Modules\FunGame\Http\Resources\SessionPresenter;
use App\Modules\FunGame\Jobs\FinaliseFunGameSession;
use App\Modules\FunGame\Models\FunGame;
use App\Modules\FunGame\Models\FunGameParticipant;
use App\Modules\FunGame\Models\FunGameSession;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * The session lifecycle: waiting → live → finishing → finished.
 *
 * While live, every player works through the questions at their own pace
 * (PlayerEngine). New players can join during the first two minutes; the
 * session ends when everyone has finished after that, when the host ends it,
 * or at the hard end time (join window + the game's length + a grace period),
 * whichever comes first.
 *
 * The server owns every transition. `sync()` applies whatever is due and runs
 * on every read and write and once a second in `fun-games:tick`, so the
 * outcome never depends on a client being connected.
 */
class SessionEngine
{
    /** A session stuck in "finishing" this long is finalised inline (no queue worker running). */
    private const FINALISE_FALLBACK_SECONDS = 10;

    public function __construct(
        private readonly TimerService $timer,
        private readonly ScoringService $scoring,
        private readonly FunGameBroadcaster $broadcaster,
        private readonly FunGameLogger $logger,
        private readonly SessionPresenter $presenter,
        private readonly ParticipantTokens $tokens,
        private readonly PlayerEngine $players,
    ) {}

    // ------------------------------------------------------------------ host actions

    public function createSession(FunGame $game, ?CarbonInterface $startsAt): FunGameSession
    {
        if ($game->status !== FunGame::STATUS_PUBLISHED) {
            throw FunGameException::conflict('Publish the game before hosting it.');
        }
        if (! $game->questions()->exists()) {
            throw FunGameException::conflict('Add at least one question before hosting.');
        }
        if ($game->hasOpenSession()) {
            throw FunGameException::conflict('This game already has a session that hasn\'t finished.');
        }

        $session = FunGameSession::create([
            'fun_game_id' => $game->id,
            'join_code' => $this->uniqueJoinCode(),
            'public_channel_key' => $this->uniqueChannelKey(),
            'status' => FunGameSession::STATUS_WAITING,
            'starts_at' => $startsAt,
        ]);

        $this->logger->info('session.created', [
            'session_id' => $session->id,
            'game_id' => $game->id,
            'user_id' => $game->user_id,
            'starts_at' => TimerService::iso($startsAt),
            'join_code' => $session->join_code,
        ]);

        return $session;
    }

    public function start(FunGameSession $session): FunGameSession
    {
        return $this->locked($session, function (FunGameSession $s, Carbon $now) {
            if ($s->status !== FunGameSession::STATUS_WAITING) {
                throw FunGameException::conflict('This session has already started.');
            }
            $this->doStart($s, $now, 'host');
        });
    }

    public function end(FunGameSession $session): FunGameSession
    {
        return $this->locked($session, function (FunGameSession $s, Carbon $now) {
            if (! in_array($s->status, [FunGameSession::STATUS_WAITING, FunGameSession::STATUS_LIVE], true)) {
                throw FunGameException::conflict('This session has already ended.');
            }
            $this->doBeginFinishing($s, $now, byHost: true);
        });
    }

    // ------------------------------------------------------------------ clock

    /** Apply every transition that is due. Safe to call any number of times. */
    public function sync(FunGameSession $session): FunGameSession
    {
        if ($session->status === FunGameSession::STATUS_FINISHED) {
            return $session;
        }

        return $this->locked($session, fn () => null);
    }

    /** Called by the job, or inline by `sync()` when no queue worker picked the job up. */
    public function finalise(int $sessionId): void
    {
        $session = FunGameSession::find($sessionId);
        if (! $session || $session->status !== FunGameSession::STATUS_FINISHING) {
            return;
        }
        $this->locked($session, function (FunGameSession $s) {
            $this->doFinalise($s);
        });
    }

    // ------------------------------------------------------------------ participants

    /**
     * Join by name and email. Joining again with the same email resumes the same
     * participant (new token, same answers), e.g. after switching device.
     *
     * @return array{participant: FunGameParticipant, token: string, rejoined: bool}
     */
    public function join(FunGameSession $session, string $name, string $email): array
    {
        $email = Str::lower(trim($email));
        $name = trim(preg_replace('/\s+/', ' ', $name));
        $result = null;

        $this->locked($session, function (FunGameSession $s, Carbon $now) use ($name, $email, &$result) {
            if (in_array($s->status, [FunGameSession::STATUS_FINISHING, FunGameSession::STATUS_FINISHED], true)) {
                throw FunGameException::conflict('This game has ended.');
            }

            $participant = FunGameParticipant::query()
                ->where('fun_game_session_id', $s->id)
                ->where('email', $email)
                ->first();
            $rejoined = (bool) $participant;
            // Players who already joined can always come back; new ones only during the join window.
            if (! $rejoined && ! $s->isJoinOpen()) {
                throw FunGameException::conflict('This game has already started, and joining has closed.');
            }

            if (! $participant) {
                $participant = FunGameParticipant::create([
                    'fun_game_session_id' => $s->id,
                    'name' => $name,
                    'email' => $email,
                    'joined_at' => $now,
                    'last_seen_at' => $now,
                ]);
            } else {
                $participant->forceFill(['name' => $name, 'last_seen_at' => $now])->save();
            }
            $token = $this->tokens->issue($participant);

            $this->logger->info($rejoined ? 'participant.rejoined' : 'participant.joined', [
                'session_id' => $s->id,
                'game_id' => $s->fun_game_id,
                'participant_id' => $participant->id,
                'session_status' => $s->status,
            ]);

            if (! $rejoined) {
                $this->broadcaster->toHost($s, 'participant.joined', $this->presenter->participantSummary($participant));
                $this->broadcastState($s);
            }

            $result = ['participant' => $participant, 'token' => $token, 'rejoined' => $rejoined];
        });

        return $result;
    }

    // ------------------------------------------------------------------ transitions (row locked)

    /** Runs `$action` with the session row locked, after applying due transitions. */
    private function locked(FunGameSession $session, callable $action): FunGameSession
    {
        return DB::transaction(function () use ($session, $action) {
            $s = FunGameSession::query()->whereKey($session->id)->lockForUpdate()->firstOrFail();
            $s->setRelation('game', $session->relationLoaded('game') ? $session->game : $s->game()->first());
            $now = now();
            for ($i = 0; $i < 6 && $this->step($s, $now); $i++) {
                // keep applying until nothing more is due
            }
            $action($s, $now);

            return $s;
        });
    }

    private function step(FunGameSession $s, Carbon $now): bool
    {
        switch ($s->status) {
            case FunGameSession::STATUS_WAITING:
                if ($s->starts_at && $now->gte($s->starts_at)) {
                    $this->doStart($s, $now, 'schedule');

                    return true;
                }

                return false;

            case FunGameSession::STATUS_LIVE:
                if ($s->ends_at && $now->gte($s->ends_at)) {
                    $this->doBeginFinishing($s, $s->ends_at);

                    return true;
                }
                $this->catchUpPlayers($s, $now);
                if ($s->join_closes_at && $now->gte($s->join_closes_at)
                    && ! $s->participants()->whereNull('finished_at')->exists()) {
                    $this->doBeginFinishing($s, $now);

                    return true;
                }

                return false;

            case FunGameSession::STATUS_FINISHING:
                if ($s->finishing_at && $now->diffInSeconds($s->finishing_at, true) >= self::FINALISE_FALLBACK_SECONDS) {
                    $this->logger->warning('session.finalise_fallback', ['session_id' => $s->id]);
                    $this->doFinalise($s);

                    return true;
                }

                return false;
        }

        return false;
    }

    private function doStart(FunGameSession $s, Carbon $now, string $trigger): void
    {
        $snapshot = $this->timer->snapshot($s->game);
        if (! $snapshot['question_ids']) {
            if ($trigger === 'host') {
                throw FunGameException::conflict('This game has no questions.');
            }
            // A scheduled start must not wedge the session: close it instead.
            $this->logger->error('session.start_without_questions', $this->ctx($s));
            $this->doBeginFinishing($s, $now);

            return;
        }
        $s->forceFill([
            'status' => FunGameSession::STATUS_LIVE,
            'started_at' => $now,
            'timer_snapshot' => $snapshot,
        ]);
        $joinCloses = $now->copy()->addSeconds(TimerService::JOIN_WINDOW_SECONDS);
        $s->forceFill([
            'join_closes_at' => $joinCloses,
            'ends_at' => $joinCloses->copy()->addSeconds($this->timer->playSeconds($s) + TimerService::END_GRACE_SECONDS),
        ])->save();

        $this->logger->info('session.started', $this->ctx($s, [
            'trigger' => $trigger,
            'mode' => $s->isPerQuestion() ? 'per_question' : 'total',
            'scoring' => $s->scoringMode(),
            'join_closes_at' => TimerService::iso($s->join_closes_at),
            'ends_at' => TimerService::iso($s->ends_at),
        ]));
        $this->broadcastState($s);
    }

    /** Applies passed deadlines for players who aren't asking (phone asleep, tab closed). */
    private function catchUpPlayers(FunGameSession $s, Carbon $now): void
    {
        // Leave the grace period to the player's own submit, so a just-in-time answer still counts.
        $now = $now->copy()->subMilliseconds(TimerService::ANSWER_GRACE_MS);
        $due = $s->participants()
            ->whereNull('finished_at')
            ->where(fn ($q) => $q->where('current_deadline', '<=', $now)->orWhere('personal_deadline', '<=', $now))
            ->get();
        foreach ($due as $p) {
            $this->players->catchUp($s, $p, $now);
        }
        if ($due->isNotEmpty()) {
            $this->broadcaster->toHost($s, 'leaderboard.updated', $this->presenter->leaderboard($s, true));
        }
    }

    private function doBeginFinishing(FunGameSession $s, CarbonInterface $at, bool $byHost = false): void
    {
        // Everyone still playing stops here; their remaining questions are unanswered.
        $end = $at->lessThan(now()) ? Carbon::parse($at) : now();
        foreach ($s->participants()->whereNull('finished_at')->get() as $p) {
            $this->players->catchUp($s, $p, $end);
            $this->players->finish($s, $p, $end);
        }
        $s->forceFill([
            'status' => FunGameSession::STATUS_FINISHING,
            'finishing_at' => now(),
            'ended_by_host' => $byHost,
        ])->save();

        $this->logger->info($byHost ? 'session.ended_by_host' : 'session.finishing', $this->ctx($s, [
            'at' => TimerService::iso($at),
        ]));
        $this->broadcastState($s);

        try {
            FinaliseFunGameSession::dispatch($s->id)->afterCommit();
        } catch (Throwable $e) {
            // sync() finalises inline after FINALISE_FALLBACK_SECONDS.
            $this->logger->error('session.finalise_dispatch_failed', $this->ctx($s), $e);
        }
    }

    private function doFinalise(FunGameSession $s): void
    {
        if ($s->status !== FunGameSession::STATUS_FINISHING) {
            return;
        }
        try {
            $standings = $this->scoring->persist($s);
        } catch (Throwable $e) {
            $this->logger->error('session.finalise_failed', $this->ctx($s), $e);
            throw $e;
        }
        $s->forceFill(['status' => FunGameSession::STATUS_FINISHED, 'finished_at' => now()])->save();

        $this->logger->info('session.finished', $this->ctx($s, [
            'participants' => $standings->count(),
            'top_score' => $standings->first()['score'] ?? null,
        ]));

        $this->broadcaster->toEveryone($s, 'session.finished', ['finishedAt' => TimerService::iso($s->finished_at)]);
        $this->broadcastState($s);
        $this->broadcaster->toParticipants($s, 'leaderboard.published', $this->presenter->leaderboard($s, false));
        $this->broadcaster->toHost($s, 'leaderboard.published', $this->presenter->leaderboard($s, true));
    }

    // ------------------------------------------------------------------ helpers

    private function broadcastState(FunGameSession $s): void
    {
        $this->broadcaster->toEveryone($s, 'session.state', $this->presenter->state($s));
    }

    private function ctx(FunGameSession $s, array $extra = []): array
    {
        return ['session_id' => $s->id, 'game_id' => $s->fun_game_id] + $extra;
    }

    /** "G" + 6 characters without look-alikes (0/O, 1/I). */
    private function uniqueJoinCode(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        do {
            $code = 'G';
            for ($i = 0; $i < 6; $i++) {
                $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
        } while (FunGameSession::query()->where('join_code', $code)->exists());

        return $code;
    }

    private function uniqueChannelKey(): string
    {
        do {
            $key = Str::lower(Str::random(32));
        } while (FunGameSession::query()->where('public_channel_key', $key)->exists());

        return $key;
    }
}
