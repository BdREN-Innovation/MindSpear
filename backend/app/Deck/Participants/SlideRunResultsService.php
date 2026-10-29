<?php

namespace App\Deck\Participants;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Deck\Exceptions\DeckException;
use App\Deck\Sessions\QuizRuntime;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\Types\Quest\OpenEndedSlideType;
use App\Models\Deck\DeckSessionSlideRun;
use App\Deck\Broadcasts\LiveAggregateService;
use Illuminate\Support\Facades\Cache;

/**
 * GET /slide-runs/{run}/aggregate — the snapshot late joiners, reconnects and
 * the review screen read instead of waiting for the next broadcast.
 *
 * The host always gets it. A participant gets it only when
 * LiveAggregateService::resultsVisibility() is public (a live_aggregate type
 * with show_results_to_participants on), the same rule the broadcasts follow,
 * and only for a run the host has reached (the session's current run, or one
 * that left `waiting`): otherwise 403 `results_hidden`, so participants
 * cannot read ahead (type, option ids) of slides not shown yet. Quiz runs
 * (hidden_until_reveal) are host-only until they are revealed, then public
 * (correct answers included). The
 * aggregate is computed from the run's
 * snapshots and answers; a closed run accepts no more answers (see
 * AnswerSubmissionService), so its aggregate is the frozen final one.
 */
class SlideRunResultsService
{
    public const CODE_RESULTS_HIDDEN = 'results_hidden';

    /** Seconds a closed run's (frozen) participant snapshot is reused, so token holders cannot force recomputes. */
    public const CLOSED_CACHE_SECONDS = 60;

    public function __construct(
        private readonly SlideTypeRegistry $registry,
        private readonly LiveAggregateService $aggregates,
    ) {}

    /** 'public' | 'host'; runs of an unknown type stay with the host. */
    public function visibility(DeckSessionSlideRun $run): string
    {
        return $this->registry->has((string) $run->type_snapshot)
            ? $this->aggregates->resultsVisibility($run)
            : BroadcastPayload::VISIBILITY_HOST;
    }

    public function forHost(DeckSessionSlideRun $run, ?int $page = null): array
    {
        return $this->snapshot($run, $page);
    }

    /**
     * @param  DeckSessionSlideRun  $run  with its `session` relation set (DeckController::sessionRun)
     *
     * @throws DeckException 403 results_hidden
     */
    public function forParticipant(DeckSessionSlideRun $run, ?int $page = null): array
    {
        if (! $this->reached($run) || $this->visibility($run) !== BroadcastPayload::VISIBILITY_PUBLIC) {
            throw new DeckException('Results are not shown to participants for this slide.', 403, self::CODE_RESULTS_HIDDEN);
        }

        if (! $run->isFinal()) {
            return $this->snapshot($run, $page);
        }

        $key = sprintf('deck:run-results:%d:%d:%s', $run->id, (int) $run->state_version, $page ?? 'preview');
        $cached = Cache::remember($key, self::CLOSED_CACHE_SECONDS, fn () => $this->snapshot($run, $page));

        return array_replace($cached, ['server_time' => now()->toISOString()]);
    }

    /** Whether participants have been shown $run: it is the current run or has left `waiting`. */
    public function reached(DeckSessionSlideRun $run): bool
    {
        if ($run->state !== DeckSessionSlideRun::STATE_WAITING) {
            return true;
        }

        $session = $run->relationLoaded('session') ? $run->session : $run->session()->first();

        return $session !== null && (int) $session->current_slide_run_id === (int) $run->id;
    }

    /**
     * {slide_run_id, type, state, state_version, closed_at, final, visibility,
     *  total_responses, aggregate, server_time}. `aggregate` is the type's
     * broadcast aggregate ({} for types without one); for open_ended,
     * ?page=N returns that page of full-text cards (OpenEndedSlideType::page()).
     */
    public function snapshot(DeckSessionSlideRun $run, ?int $page = null): array
    {
        $key = (string) $run->type_snapshot;
        $type = $this->registry->has($key) ? $this->registry->for($key) : null;
        $config = $run->config_snapshot ?? [];

        if (! $type) {
            $aggregate = [];
        } elseif ($run->isRevealed() && $page === null) {
            // Quiz / spinner after the reveal: the frozen reveal aggregate (cached, spin result included).
            $aggregate = app(QuizRuntime::class)->aggregate($run);
        } else {
            $answers = $run->answers()->orderBy('id')->get();
            $aggregate = $page !== null && $type instanceof OpenEndedSlideType
                ? $type->page($config, $answers, $page)
                : $type->aggregate($config, $run->options_snapshot ?? [], $answers);
        }

        return [
            'slide_run_id' => $run->id,
            'type' => $key,
            'state' => $run->state,
            'state_version' => $run->state_version,
            'closed_at' => $run->closed_at?->toISOString(),
            'final' => $run->isFinal(),
            'visibility' => $this->visibility($run),
            'total_responses' => $aggregate['total_responses'] ?? null,
            'aggregate' => $aggregate === [] ? (object) [] : $aggregate,
            'server_time' => now()->toISOString(),
        ];
    }
}
