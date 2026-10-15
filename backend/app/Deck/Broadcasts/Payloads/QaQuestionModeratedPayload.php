<?php

namespace App\Deck\Broadcasts\Payloads;

use App\Deck\Broadcasts\BroadcastPayload;
use App\Models\Deck\DeckQaQuestion;

/**
 * `qa.question.moderated`, sent twice per change: forHost() with the full
 * state on the private host channel, and forPublic() on the public channel.
 * The public copy of a hidden question is only {question_id, slide_run_id,
 * is_hidden: true} so clients drop it without ever seeing its body; when it
 * is unhidden the public copy carries the body again so it can reappear.
 */
final readonly class QaQuestionModeratedPayload implements BroadcastPayload
{
    private function __construct(
        private string $visibility,
        private array $data,
    ) {}

    public static function forHost(DeckQaQuestion $question): self
    {
        return new self(self::VISIBILITY_HOST, [
            ...self::visibleFields($question),
            'participant_id' => $question->participant_id,
            'is_hidden' => (bool) $question->is_hidden,
        ]);
    }

    public static function forPublic(DeckQaQuestion $question): self
    {
        if ($question->is_hidden) {
            return new self(self::VISIBILITY_PUBLIC, [
                'question_id' => $question->id,
                'slide_run_id' => $question->slide_run_id,
                'is_hidden' => true,
            ]);
        }

        return new self(self::VISIBILITY_PUBLIC, [
            ...self::visibleFields($question),
            'is_hidden' => false,
        ]);
    }

    public function eventName(): string
    {
        return 'qa.question.moderated';
    }

    public function visibility(): string
    {
        return $this->visibility;
    }

    public function toArray(): array
    {
        return $this->data;
    }

    private static function visibleFields(DeckQaQuestion $question): array
    {
        return [
            'question_id' => $question->id,
            'slide_run_id' => $question->slide_run_id,
            'body' => $question->body,
            'participant_emoji' => $question->participant?->emoji_avatar,
            'upvote_count' => (int) $question->upvote_count,
            'is_answered' => (bool) $question->is_answered,
            'is_starred' => (bool) $question->is_starred,
            'submitted_at' => $question->submitted_at?->toISOString(),
        ];
    }
}
