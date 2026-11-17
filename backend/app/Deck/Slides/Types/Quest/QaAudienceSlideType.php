<?php

namespace App\Deck\Slides\Types\Quest;

use App\Deck\Qa\LiveQaService;
use App\Deck\Slides\AbstractSlideType;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * Audience Q&A (Mentimeter Q&A). Questions and upvotes do NOT go through the
 * answer pipeline: they live in deck_qa_questions / deck_qa_upvotes and are
 * handled by LiveQaService. So acceptsAnswers() is false (validateAnswer
 * always throws) and the aggregate only describes the feed settings; the feed
 * itself comes from LiveQaService::topN().
 *
 * Config:
 *   {allow_anonymous: bool, show_feed_to_participants: bool, sort: 'top'|'newest',
 *    profanity_filter_enabled: bool, max_question_length: int 10..1000 (default 280)}
 *   ('new' is accepted for sort and normalised to 'newest'.)
 *   LiveQaService::submitQuestion enforces max_question_length from the run's
 *   config_snapshot (falling back to these defaults), and the participant UI
 *   reads it for its character counter.
 *
 * Aggregate:
 *   {total_responses: 0, feed_source: 'live_qa', sort, show_feed_to_participants, allow_anonymous}
 */
class QaAudienceSlideType extends AbstractSlideType
{
    public const KEY = 'qa_audience';

    public const SORT_TOP = 'top';

    public const SORT_NEWEST = 'newest';

    public const MIN_QUESTION_LENGTH = 10;

    public function key(): string
    {
        return self::KEY;
    }

    public function category(): string
    {
        return self::CATEGORY_INTERACTIVE;
    }

    public function revealModel(): string
    {
        return self::REVEAL_MODERATED;
    }

    /** Questions go through LiveQaService, not deck_participant_answers. */
    public function acceptsAnswers(): bool
    {
        return false;
    }

    public function defaultConfig(): array
    {
        return [
            'allow_anonymous' => true,
            'show_feed_to_participants' => true,
            'sort' => self::SORT_TOP,
            'profanity_filter_enabled' => true,
            'max_question_length' => LiveQaService::MAX_BODY_LENGTH,
        ];
    }

    /**
     * Optional authoring hook (Phase 2, SlideInput::seedConfig()): a new Q&A
     * slide starts with the deck's default_qa_sort (plan §5.6).
     */
    public function seedConfigFromDeck(array $config, array $deckSettings): array
    {
        $sort = $deckSettings['default_qa_sort'] ?? null;

        if (in_array($sort, [self::SORT_TOP, self::SORT_NEWEST], true)) {
            $config['sort'] = $sort;
        }

        return $config;
    }

    public function validateConfig(array $config): array
    {
        $config = array_replace($this->defaultConfig(), $config);

        if (($config['sort'] ?? null) === 'new') {
            $config['sort'] = self::SORT_NEWEST;
        }

        Validator::make($config, [
            'allow_anonymous' => ['required', 'boolean'],
            'show_feed_to_participants' => ['required', 'boolean'],
            'sort' => ['required', Rule::in([self::SORT_TOP, self::SORT_NEWEST])],
            'profanity_filter_enabled' => ['required', 'boolean'],
            'max_question_length' => ['required', 'integer', 'min:' . self::MIN_QUESTION_LENGTH, 'max:' . LiveQaService::MAX_BODY_LENGTH_CEILING],
        ])->validate();

        return [
            'allow_anonymous' => (bool) $config['allow_anonymous'],
            'show_feed_to_participants' => (bool) $config['show_feed_to_participants'],
            'sort' => $config['sort'],
            'profanity_filter_enabled' => (bool) $config['profanity_filter_enabled'],
            'max_question_length' => (int) $config['max_question_length'],
        ];
    }

    /** Describes the feed only; questions are read from LiveQaService::topN(). */
    public function aggregate(array $config, array $options, Collection $answers): array
    {
        $config = array_replace($this->defaultConfig(), $config);

        return [
            'total_responses' => 0,
            'feed_source' => 'live_qa',
            'sort' => $config['sort'] === 'new' ? self::SORT_NEWEST : $config['sort'],
            'show_feed_to_participants' => (bool) $config['show_feed_to_participants'],
            'allow_anonymous' => (bool) $config['allow_anonymous'],
        ];
    }
}
