<?php

namespace App\Services\Live;

use App\Deck\Broadcasts\DeckBroadcaster;
use App\Deck\Broadcasts\Payloads\ParticipantCountUpdatedPayload;
use App\Events\Live\ImmediateLiveBroadcastEvent;
use App\Models\Deck\DeckSession;
use App\Models\Quest\QuestParticipant;
use App\Models\Quest\QuestSession;
use App\Models\Quiz\QuizParticipant;
use App\Models\Quiz\QuizSession;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Throwable;

class LiveSessionService
{
    public const MODULE_QUEST = 'quest';

    public const MODULE_QUIZ = 'quiz';

    public function ensurePublicChannelKey(Model $session): string
    {
        if ($session->public_channel_key) {
            return $session->public_channel_key;
        }

        $column = match (true) {
            $session instanceof DeckSession => 'deck_sessions',
            $session instanceof QuestSession => 'quest_sessions',
            default => 'quiz_sessions',
        };

        do {
            $key = Str::lower(Str::random(32));
        } while (DB::table($column)->where('public_channel_key', $key)->exists());

        $session->forceFill(['public_channel_key' => $key])->save();

        return $key;
    }

    public function publicChannel(string $module, string $publicChannelKey): string
    {
        return "session.{$module}.{$publicChannelKey}";
    }

    public function hostChannel(string $module, int $sessionId): string
    {
        return "host.{$module}.{$sessionId}";
    }

    /** Deck sessions keep host channels apart from legacy ids during coexistence. */
    public function deckHostChannel(string $product, int $sessionId): string
    {
        return "host.{$product}.v2.{$sessionId}";
    }

    public function publicChannelFor(QuestSession|QuizSession|DeckSession $session): string
    {
        return $this->publicChannel($this->moduleFor($session), $this->ensurePublicChannelKey($session));
    }

    /** host.{module}.{id} for legacy sessions, host.{product}.v2.{id} for deck sessions. */
    public function hostChannelFor(QuestSession|QuizSession|DeckSession $session): string
    {
        return $session instanceof DeckSession
            ? $this->deckHostChannel($session->product(), (int) $session->id)
            : $this->hostChannel($this->moduleFor($session), (int) $session->id);
    }

    /** quest | quiz; for a deck session it is the deck's product. */
    public function moduleFor(QuestSession|QuizSession|DeckSession $session): string
    {
        return match (true) {
            $session instanceof DeckSession => $session->product(),
            $session instanceof QuestSession => self::MODULE_QUEST,
            default => self::MODULE_QUIZ,
        };
    }

    public function broadcastPublic(string $module, Model $session, string $event, array $payload = []): void
    {
        $this->assertDeckModule($module, $session);
        $publicChannelKey = $this->ensurePublicChannelKey($session);

        $this->afterCommit(function () use ($module, $publicChannelKey, $event, $payload) {
            $channel = $this->publicChannel($module, $publicChannelKey);

            $this->broadcastSafely(new ImmediateLiveBroadcastEvent(
                $channel,
                $event,
                $this->withMeta($module, $event, $payload),
            ), $channel, $event);
        });
    }

    public function broadcastHost(string $module, Model $session, string $event, array $payload = []): void
    {
        $this->assertDeckModule($module, $session);
        // A deck session id can equal a legacy one: never fall back to host.{module}.{id}.
        $channel = $session instanceof DeckSession
            ? $this->deckHostChannel($module, (int) $session->id)
            : $this->hostChannel($module, (int) $session->id);

        $this->afterCommit(function () use ($module, $channel, $event, $payload) {
            $this->broadcastSafely(new ImmediateLiveBroadcastEvent(
                $channel,
                $event,
                $this->withMeta($module, $event, $payload),
                private: true,
            ), $channel, $event);
        });
    }

    public function state(string $module, QuestSession|QuizSession $session): array
    {
        $this->ensurePublicChannelKey($session);
        $session->loadMissing($module === self::MODULE_QUEST ? 'quest' : 'quiz');
        $session->loadCount('participants');

        return [
            'module' => $module,
            'session_id' => $session->id,
            'session_code' => $session->session_id,
            'public_channel_key' => $session->public_channel_key,
            'public_channel' => $this->publicChannel($module, $session->public_channel_key),
            'host_channel' => $this->hostChannel($module, (int) $session->id),
            'running_status' => (bool) $session->running_status,
            'current_question_id' => $module === self::MODULE_QUIZ ? $session->current_question_id : null,
            'current_task_id' => $module === self::MODULE_QUEST ? $session->current_task_id : null,
            'timer_state' => $session->timer_state,
            'participant_count' => $session->participants_count,
            'start_datetime' => optional($session->start_datetime)->toISOString(),
            'end_datetime' => optional($session->end_datetime)->toISOString(),
            'updated_at' => optional($session->updated_at)->toISOString(),
        ];
    }

    public function participantCountPayload(QuestSession|QuizSession|DeckSession $session): array
    {
        if ($session instanceof DeckSession) {
            return [
                'session_id' => $session->id,
                'participant_count' => ParticipantCountUpdatedPayload::countFor($session),
            ];
        }

        $session->loadCount('participants');

        return [
            'session_id' => $session->id,
            'participant_count' => $session->participants_count,
        ];
    }

    public function activeParticipantsPayload(QuestSession|QuizSession $session): array
    {
        return $session->participants()
            ->with('user')
            ->where('status', 'In Progress')
            ->oldest()
            ->get()
            ->map(fn (Model $participant) => $this->participantPayload($participant))
            ->values()
            ->all();
    }

    public function broadcastParticipantJoined(string $module, QuestSession|QuizSession $session, int $participantId): void
    {
        $publicPayload = array_merge($this->participantCountPayload($session), [
            'participant_id' => $participantId,
        ]);
        $hostPayload = array_merge(
            $publicPayload,
            $this->participantPayload($this->findParticipant($module, $participantId)),
        );

        $this->broadcastPublic($module, $session, 'participant.joined', $publicPayload);
        $this->broadcastHost($module, $session, 'participant.joined', $hostPayload);
        $this->broadcastParticipantCount($module, $session);
    }

    /** Deck sessions send the typed payload once, on the public channel the host also listens to. */
    public function broadcastParticipantCount(string $module, QuestSession|QuizSession|DeckSession $session): void
    {
        if ($session instanceof DeckSession) {
            $this->assertDeckModule($module, $session);
            // Count after the commit: two joins in concurrent transactions would
            // each count only their own uncommitted row and both report N+1.
            $this->afterCommit(fn () => app(DeckBroadcaster::class)->broadcast(
                $session,
                ParticipantCountUpdatedPayload::fromSession($session),
            ));

            return;
        }

        $payload = $this->participantCountPayload($session);

        $this->broadcastPublic($module, $session, 'participant.count.updated', $payload);
        $this->broadcastHost($module, $session, 'participant.count.updated', $payload);
    }

    public function broadcastParticipantCompleted(
        string $module,
        QuestSession|QuizSession $session,
        Model $participant,
        array $extraPayload = []
    ): void {
        $session->loadCount([
            'participants',
            'participants as completed_participants_count' => fn ($query) => $query->where('status', 'Completed'),
        ]);

        $payload = array_merge([
            'session_id' => $session->id,
            'participant_id' => $participant->getKey(),
            'participant_count' => $session->participants_count,
            'completed_participant_count' => $session->completed_participants_count,
            'status' => $participant->status,
            'completed_at' => optional($participant->end_time)->toISOString(),
        ], $extraPayload);

        $this->broadcastPublic($module, $session, 'participant.completed', $payload);
        $this->broadcastHost($module, $session, 'participant.completed', $payload);
        $this->broadcastPublic($module, $session, 'leaderboard.updated', $payload);
        $this->broadcastHost($module, $session, 'leaderboard.updated', $payload);
    }

    public function afterCommit(callable $callback): void
    {
        if (DB::transactionLevel() > 0) {
            DB::afterCommit($callback);

            return;
        }

        $callback();
    }

    /** A deck session only broadcasts under its own product; a mismatch is a bug. */
    private function assertDeckModule(string $module, Model $session): void
    {
        if ($session instanceof DeckSession && $session->product() !== $module) {
            throw new InvalidArgumentException("Deck session {$session->id} is a {$session->product()} session, not {$module}.");
        }
    }

    private function withMeta(string $module, string $event, array $payload): array
    {
        return array_merge($payload, [
            'module' => $module,
            'event' => $event,
            'broadcasted_at' => now()->toISOString(),
        ]);
    }

    private function broadcastSafely(ImmediateLiveBroadcastEvent $event, string $channel, string $eventName): void
    {
        try {
            broadcast($event);
        } catch (Throwable $exception) {
            Log::warning('Live broadcast failed after database commit.', [
                'channel' => $channel,
                'event' => $eventName,
                'message' => $exception->getMessage(),
            ]);
        }
    }

    private function findParticipant(string $module, int $participantId): ?Model
    {
        $participantClass = $module === self::MODULE_QUEST
            ? QuestParticipant::class
            : QuizParticipant::class;

        return $participantClass::with('user')->find($participantId);
    }

    private function participantPayload(?Model $participant): array
    {
        if (! $participant) {
            return [
                'participant_name' => null,
                'participant_user_id' => null,
                'is_anonymous' => null,
                'status' => null,
            ];
        }

        return [
            'participant_id' => (int) $participant->getKey(),
            'participant_name' => $this->participantDisplayName($participant),
            'participant_user_id' => $participant->user_id ? (int) $participant->user_id : null,
            'is_anonymous' => (bool) $participant->is_anonymous,
            'status' => $participant->status,
            'joined_at' => optional($participant->created_at)->toISOString(),
        ];
    }

    private function participantDisplayName(Model $participant): string
    {
        $anonymousName = data_get($participant->anonymous_details, 'name');

        if ($anonymousName) {
            return (string) $anonymousName;
        }

        if ($participant->relationLoaded('user') && $participant->user) {
            $fullName = trim((string) $participant->user->full_name);

            if ($fullName !== '') {
                return $fullName;
            }

            if ($participant->user->email) {
                return $participant->user->email;
            }
        }

        return 'Participant ' . $participant->getKey();
    }
}
