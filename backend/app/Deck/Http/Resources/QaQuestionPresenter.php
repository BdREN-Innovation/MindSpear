<?php

namespace App\Deck\Http\Resources;

use App\Deck\Broadcasts\Payloads\QaQuestionModeratedPayload;
use App\Deck\Qa\QaFeed;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckQaQuestion;

/**
 * Q&A questions for the live-session API. Unlike the owner-only authoring
 * presenters these are snake_case, because each item is exactly the object
 * the realtime events carry (`qa.question.submitted` / `.moderated`), so a
 * client merges REST reads and broadcasts into one list without mapping:
 *
 *   participant: {question_id, slide_run_id, body, participant_emoji,
 *                 upvote_count, is_answered, is_starred, submitted_at,
 *                 is_hidden: false, has_upvoted, is_mine}
 *   host:        {question_id, slide_run_id, body, participant_emoji,
 *                 upvote_count, is_answered, is_starred, submitted_at,
 *                 participant_id, is_hidden}
 *
 * Never shows a participant's display name or token data; participants
 * never receive participant_id or hidden questions.
 */
final class QaQuestionPresenter
{
    /** The host view of a question: the host `qa.question.moderated` payload. */
    public static function forHost(DeckQaQuestion $question): array
    {
        return QaQuestionModeratedPayload::forHost($question)->toArray();
    }

    /** A (visible) question as $viewer sees it. */
    public static function forParticipant(DeckQaQuestion $question, DeckParticipant $viewer, bool $hasUpvoted): array
    {
        return QaQuestionModeratedPayload::forPublic($question)->toArray() + [
            'has_upvoted' => $hasUpvoted,
            'is_mine' => $question->participant_id !== null && (int) $question->participant_id === (int) $viewer->id,
        ];
    }

    /**
     * {slide_run_id, state, viewer: host|participant, sort: top|new,
     *  show_feed_to_participants, own_only, total, limit, questions[]}.
     * `total` counts every question this viewer may see; `questions` holds
     * the first `limit` of them in feed order.
     */
    public static function feed(QaFeed $feed): array
    {
        $participant = $feed->participant;

        return [
            'slide_run_id' => $feed->run->id,
            'state' => $feed->run->state,
            'viewer' => $feed->forHost() ? 'host' : 'participant',
            'sort' => $feed->sort,
            'show_feed_to_participants' => $feed->showFeedToParticipants,
            'own_only' => $feed->ownOnly,
            'total' => $feed->total,
            'limit' => $feed->limit,
            'questions' => $feed->questions->map(fn (DeckQaQuestion $question) => $participant === null
                ? self::forHost($question)
                : self::forParticipant($question, $participant, $feed->hasUpvoted($question)))->values()->all(),
        ];
    }

    /** The answer to an upvote / remove-upvote request. */
    public static function vote(DeckQaQuestion $question, int $upvoteCount, bool $hasUpvoted): array
    {
        return [
            'question_id' => $question->id,
            'slide_run_id' => $question->slide_run_id,
            'upvote_count' => $upvoteCount,
            'has_upvoted' => $hasUpvoted,
        ];
    }
}
