<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Models\Deck\DeckQaQuestion;

/**
 * `qa.question.submitted`: a new audience question for the feed. Carries the
 * author's emoji only, never the participant id or name, so the public feed
 * stays anonymous. Host visibility is used when the slide hides the feed from
 * participants (`show_feed_to_participants: false`).
 */
final readonly class QaQuestionSubmittedPayload implements BroadcastPayload
{
    public function __construct(
        public int $questionId,
        public int $slideRunId,
        public string $body,
        public ?string $participantEmoji,
        public int $upvoteCount,
        public ?string $submittedAt,
        private string $visibility = self::VISIBILITY_PUBLIC,
    ) {}

    public static function fromQuestion(DeckQaQuestion $question, string $visibility = self::VISIBILITY_PUBLIC): self
    {
        return new self(
            questionId: $question->id,
            slideRunId: $question->slide_run_id,
            body: $question->body,
            participantEmoji: $question->participant?->emoji_avatar,
            upvoteCount: (int) $question->upvote_count,
            submittedAt: $question->submitted_at?->toISOString(),
            visibility: $visibility,
        );
    }

    public function eventName(): string
    {
        return 'qa.question.submitted';
    }

    public function visibility(): string
    {
        return $this->visibility;
    }

    public function toArray(): array
    {
        return [
            'question_id' => $this->questionId,
            'slide_run_id' => $this->slideRunId,
            'body' => $this->body,
            'participant_emoji' => $this->participantEmoji,
            'upvote_count' => $this->upvoteCount,
            'is_answered' => false,
            'is_starred' => false,
            'submitted_at' => $this->submittedAt,
        ];
    }
}
