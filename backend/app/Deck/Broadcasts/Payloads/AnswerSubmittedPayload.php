<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Models\Deck\DeckParticipantAnswer;

/**
 * `answer.submitted`: one participant answered (or changed their answer).
 * Host only: it names the participant and holds the raw answer, so it must
 * never reach the public channel. visibility() is fixed for that reason.
 */
final readonly class AnswerSubmittedPayload implements BroadcastPayload
{
    public string $serverTime;

    public function __construct(
        public int $slideRunId,
        public int $answerId,
        public int $participantId,
        public ?string $displayName,
        public ?string $emojiAvatar,
        public array $answer,
        public ?int $timeToAnswerMs,
        public ?string $submittedAt,
        public ?int $totalResponses = null,
        public bool $isUpdate = false,
        ?string $serverTime = null,
    ) {
        $this->serverTime = $serverTime ?? now()->toISOString();
    }

    /**
     * @param  int|null  $totalResponses  answers on the run after this one
     * @param  bool  $isUpdate  the participant replaced an earlier answer
     */
    public static function fromAnswer(DeckParticipantAnswer $answer, ?int $totalResponses = null, bool $isUpdate = false): self
    {
        $participant = $answer->participant;

        return new self(
            slideRunId: $answer->slide_run_id,
            answerId: $answer->id,
            participantId: $answer->deck_participant_id,
            displayName: $participant?->display_name,
            emojiAvatar: $participant?->emoji_avatar,
            answer: $answer->answer_payload ?? [],
            timeToAnswerMs: $answer->time_to_answer_ms,
            submittedAt: $answer->submitted_at?->toISOString(),
            totalResponses: $totalResponses,
            isUpdate: $isUpdate,
        );
    }

    public function eventName(): string
    {
        return 'answer.submitted';
    }

    public function visibility(): string
    {
        return self::VISIBILITY_HOST;
    }

    public function toArray(): array
    {
        return [
            'slide_run_id' => $this->slideRunId,
            'answer_id' => $this->answerId,
            'participant_id' => $this->participantId,
            'display_name' => $this->displayName,
            'emoji_avatar' => $this->emojiAvatar,
            'answer' => $this->answer,
            'time_to_answer_ms' => $this->timeToAnswerMs,
            'submitted_at' => $this->submittedAt,
            'total_responses' => $this->totalResponses,
            'is_update' => $this->isUpdate,
            'server_time' => $this->serverTime,
        ];
    }
}
