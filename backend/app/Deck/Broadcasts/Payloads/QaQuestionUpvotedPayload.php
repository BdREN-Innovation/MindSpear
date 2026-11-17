<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;

/**
 * `qa.question.upvoted`: the question's current upvote count (absolute, not
 * a delta, so a missed event heals on the next one). Debounced per question.
 * Host visibility is used for a hidden question, and when the slide hides the
 * feed from participants (`show_feed_to_participants: false`), so the host's
 * moderation panel stays current without the count reaching the audience.
 */
final readonly class QaQuestionUpvotedPayload implements BroadcastPayload
{
    public function __construct(
        public int $questionId,
        public int $slideRunId,
        public int $upvoteCount,
        private string $visibility = self::VISIBILITY_PUBLIC,
    ) {}

    public function eventName(): string
    {
        return 'qa.question.upvoted';
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
            'upvote_count' => $this->upvoteCount,
        ];
    }
}
