<?php

namespace App\Deck\Qa;

use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckQaQuestion;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Database\Eloquent\Collection;

/**
 * One read of a Q&A feed, as SessionQaService::feed() built it for a viewer:
 * the host (`$participant` null: hidden questions included, starred first)
 * or one participant (hidden questions excluded; only their own questions
 * when `$ownOnly`). QaQuestionPresenter::feed() shapes it for the API.
 */
final readonly class QaFeed
{
    /**
     * @param  Collection<int, DeckQaQuestion>  $questions  in feed order, at most $limit
     * @param  array<int, true>  $upvotedIds  question ids the participant has upvoted (empty for the host)
     */
    public function __construct(
        public DeckSessionSlideRun $run,
        public ?DeckParticipant $participant,
        public Collection $questions,
        public int $total,
        public int $limit,
        public string $sort,
        public bool $showFeedToParticipants,
        public bool $ownOnly,
        public array $upvotedIds = [],
    ) {}

    public function forHost(): bool
    {
        return $this->participant === null;
    }

    public function hasUpvoted(DeckQaQuestion $question): bool
    {
        return isset($this->upvotedIds[$question->id]);
    }
}
