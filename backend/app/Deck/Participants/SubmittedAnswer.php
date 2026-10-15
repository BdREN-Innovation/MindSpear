<?php

namespace App\Deck\Participants;

use App\Models\Deck\DeckParticipantAnswer;

/** Result of AnswerSubmissionService::submit(). */
final readonly class SubmittedAnswer
{
    /**
     * @param  bool  $isUpdate  the participant already had an answer on this run (merged or replaced)
     * @param  bool  $merged  the stored payload was merged (AppendsSubmissions with multiple submissions on)
     */
    public function __construct(
        public DeckParticipantAnswer $answer,
        public bool $isUpdate,
        public bool $merged,
    ) {}
}
