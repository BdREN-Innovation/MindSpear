<?php

namespace App\Modules\FunGame\Services;

use App\Modules\FunGame\Http\Resources\SessionPresenter;
use App\Modules\FunGame\Models\FunGameAnswer;
use App\Modules\FunGame\Models\FunGameParticipant;
use App\Modules\FunGame\Models\FunGameQuestion;
use App\Modules\FunGame\Models\FunGameSession;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * One player's way through a live game: questions one at a time, in the
 * player's own order, each answer final.
 *
 * Per-question timer: every question has its own deadline; when it passes the
 * question counts as unanswered and the next one opens at that moment — time
 * runs on while the player is away.
 * Total timer: one personal deadline, starting when the first question opens.
 *
 * Nothing here trusts the client's clock. The player's clock starts when they
 * first ask for a question; every deadline is capped by the session's hard end.
 *
 * Locking: the session row (shared) then the participant row (update), the
 * same order SessionEngine uses (session for update), so an ending session
 * and a submit can't interleave.
 */
class PlayerEngine
{
    public function __construct(
        private readonly TimerService $timer,
        private readonly ScoringService $scoring,
        private readonly SessionPresenter $presenter,
        private readonly FunGameBroadcaster $broadcaster,
        private readonly FunGameLogger $logger,
    ) {}

    /** The player's current question (opening it if needed), or that they've finished. */
    public function current(FunGameSession $session, FunGameParticipant $participant): array
    {
        return $this->withLocks($session, $participant, function (FunGameSession $s, FunGameParticipant $p, Carbon $now) {
            if ($s->status === FunGameSession::STATUS_LIVE) {
                $this->catchUp($s, $p, $now);
                if (! $p->finished_at && $p->current_opened_at === null) {
                    $this->open($s, $p, (int) ($p->current_index ?? 0), $now);
                }
            }

            return $this->presenter->progress($s, $p);
        });
    }

    /**
     * Records the answer to the current question (`$optionId` null = skip) and
     * moves on. Accepted only for the question on screen, before its deadline.
     *
     * @return array{ack: array, progress: array}
     */
    public function submit(FunGameSession $session, FunGameParticipant $participant, int $questionId, ?string $optionId): array
    {
        $result = $this->withLocks($session, $participant, function (FunGameSession $s, FunGameParticipant $p, Carbon $now) use ($questionId, $optionId) {
            $reject = function (string $reason) use ($s, $p, $questionId, $optionId, $now) {
                $this->catchUp($s, $p, $now);
                $this->logger->info('answer.rejected', [
                    'session_id' => $s->id,
                    'participant_id' => $p->id,
                    'question_id' => $questionId,
                    'reason' => $reason,
                ]);

                return ['ack' => $this->ack(false, $reason, $questionId, $optionId, $now), 'progress' => $this->presenter->progress($s, $p)];
            };

            if ($s->status !== FunGameSession::STATUS_LIVE) {
                return $reject($s->status === FunGameSession::STATUS_WAITING ? 'locked' : 'finished');
            }
            if ($p->finished_at) {
                return $reject('finished');
            }
            $order = $p->question_order ?? [];
            $currentId = $p->current_opened_at !== null ? ($order[$p->current_index] ?? null) : null;
            if ($currentId !== $questionId) {
                // An earlier question that was never answered closed before this arrived.
                $position = array_search($questionId, $order, true);
                $passed = $position !== false && $position < (int) $p->current_index
                    && ! FunGameAnswer::query()->where('fun_game_participant_id', $p->id)->where('fun_game_question_id', $questionId)->exists();

                return $reject($passed ? 'late' : 'locked');
            }
            $deadline = $this->deadlineOf($s, $p);
            if ($deadline && $now->greaterThan($deadline->copy()->addMilliseconds(TimerService::ANSWER_GRACE_MS))) {
                return $reject('late');
            }
            $question = FunGameQuestion::withTrashed()->find($questionId);
            if (! $question || ($optionId !== null && ! $question->hasOption($optionId))) {
                return $reject('invalid');
            }

            if ($optionId !== null) {
                $limitMs = $s->isPerQuestion() ? $this->timer->secondsForQuestion($s, $questionId) * 1000 : PHP_INT_MAX;
                $responseMs = min(TimerService::ms($p->current_opened_at, $now), $limitMs);
                $correct = $optionId === $question->correct_option_id;
                FunGameAnswer::query()->insertOrIgnore([
                    'fun_game_participant_id' => $p->id,
                    'fun_game_question_id' => $questionId,
                    'option_id' => $optionId,
                    // Formatted here: the query builder would drop the milliseconds.
                    'opened_at' => $p->current_opened_at->format(TimerService::DB_FORMAT),
                    'submitted_at' => $now->format(TimerService::DB_FORMAT),
                    'response_ms' => $responseMs,
                    'is_correct' => $correct,
                    'points' => $this->scoring->answerPoints($s, $question, $correct, $responseMs),
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            $this->logger->info($optionId === null ? 'answer.skipped' : 'answer.accepted', [
                'session_id' => $s->id,
                'participant_id' => $p->id,
                'question_id' => $questionId,
                'index' => $p->current_index,
            ]);
            $this->moveOn($s, $p, $now);

            return ['ack' => $this->ack(true, null, $questionId, $optionId, $now), 'progress' => $this->presenter->progress($s, $p)];
        });

        $this->notifyHost($session, (bool) ($result['progress']['finished'] ?? false));

        return $result;
    }

    /**
     * Applies every deadline that has passed for this player. Called with the
     * session row locked (by either engine).
     */
    public function catchUp(FunGameSession $s, FunGameParticipant $p, CarbonInterface $now): void
    {
        if ($p->finished_at || $p->current_opened_at === null) {
            return;
        }
        if (! $s->isPerQuestion()) {
            if ($p->personal_deadline && $now->gte($p->personal_deadline)) {
                $this->finish($s, $p, $p->personal_deadline);
            }

            return;
        }
        // Each expired question is unanswered; the next one opened when it expired.
        for ($guard = 0; $guard <= count($p->question_order ?? []) && ! $p->finished_at; $guard++) {
            if (! $p->current_deadline || $now->lt($p->current_deadline)) {
                return;
            }
            $this->moveOn($s, $p, Carbon::parse($p->current_deadline));
        }
    }

    /** Ends the player's run at `$at` (all remaining questions unanswered). */
    public function finish(FunGameSession $s, FunGameParticipant $p, CarbonInterface $at): void
    {
        if ($p->finished_at) {
            return;
        }
        $p->forceFill([
            'finished_at' => $at,
            'current_opened_at' => null,
            'current_deadline' => null,
            'elapsed_ms' => $p->first_opened_at ? TimerService::ms($p->first_opened_at, $at) : null,
        ])->save();
        $this->logger->info('participant.finished', [
            'session_id' => $s->id,
            'participant_id' => $p->id,
            'answered_through' => $p->current_index,
            'elapsed_ms' => $p->elapsed_ms,
        ]);
    }

    // ------------------------------------------------------------------ internals

    /** Leaves the current question (answered at `$at`, or expired at `$at`) and opens the next, if any. */
    private function moveOn(FunGameSession $s, FunGameParticipant $p, CarbonInterface $at): void
    {
        $next = (int) $p->current_index + 1;
        if ($next >= count($p->question_order ?? [])) {
            $this->finish($s, $p, $at);

            return;
        }
        $this->open($s, $p, $next, Carbon::parse($at));
    }

    private function open(FunGameSession $s, FunGameParticipant $p, int $index, Carbon $at): void
    {
        if (! $p->question_order) {
            $p->question_order = $this->drawFor($s);
        }
        $updates = [
            'question_order' => $p->question_order,
            'current_index' => $index,
            'current_opened_at' => $at,
        ];
        $hardEnd = $s->ends_at;
        if ($p->first_opened_at === null) {
            $updates['first_opened_at'] = $at;
            if (! $s->isPerQuestion()) {
                $deadline = $at->copy()->addSeconds($this->timer->totalSeconds($s));
                $updates['personal_deadline'] = $hardEnd && $deadline->gt($hardEnd) ? $hardEnd : $deadline;
            }
        }
        if ($s->isPerQuestion()) {
            $deadline = $at->copy()->addSeconds($this->timer->secondsForQuestion($s, (int) $p->question_order[$index]));
            $updates['current_deadline'] = $hardEnd && $deadline->gt($hardEnd) ? $hardEnd : $deadline;
        }
        $p->forceFill($updates)->save();
    }

    /**
     * This player's questions: the shared set, or their own random draw from
     * the pool. Shuffled, or in the game's order when shuffling is off.
     */
    private function drawFor(FunGameSession $s): array
    {
        $pool = $s->questionIds();
        $ids = $s->sharedQuestionIds();
        if ($ids === null) {
            $perPlayer = $s->questionsPerPlayer();
            $picked = $perPlayer >= count($pool) ? $pool : (array) array_rand(array_flip($pool), $perPlayer);
            $picked = array_flip($picked);
            $ids = array_values(array_filter($pool, fn ($id) => isset($picked[$id])));
        }
        if ($s->timer_snapshot['shuffle'] ?? true) {
            shuffle($ids);
        }

        return $ids;
    }

    private function deadlineOf(FunGameSession $s, FunGameParticipant $p): ?CarbonInterface
    {
        return $s->isPerQuestion() ? $p->current_deadline : $p->personal_deadline;
    }

    /** Session (shared) then participant (for update), inside one transaction. */
    private function withLocks(FunGameSession $session, FunGameParticipant $participant, callable $action): array
    {
        return DB::transaction(function () use ($session, $participant, $action) {
            $s = FunGameSession::query()->whereKey($session->id)->sharedLock()->firstOrFail();
            $s->setRelation('game', $session->relationLoaded('game') ? $session->game : $s->game()->first());
            $p = FunGameParticipant::query()->whereKey($participant->id)->lockForUpdate()->firstOrFail();

            return $action($s, $p, now());
        });
    }

    /** Live table for the host, at most once a second (always when someone finishes). */
    private function notifyHost(FunGameSession $s, bool $force): void
    {
        if ($force || Cache::add("fungame:progress:{$s->id}", true, 1)) {
            $fresh = FunGameSession::with('game')->find($s->id);
            $this->broadcaster->toHost($fresh, 'leaderboard.updated', $this->presenter->leaderboard($fresh, true));
            $this->broadcaster->toHost($fresh, 'admin.stats', $this->presenter->stats($fresh));
        }
    }

    private function ack(bool $accepted, ?string $reason, int $questionId, ?string $optionId, CarbonInterface $now): array
    {
        return [
            'accepted' => $accepted,
            'reason' => $reason,
            'questionId' => (string) $questionId,
            'optionId' => $optionId,
            'serverTime' => TimerService::iso($now),
        ];
    }
}
