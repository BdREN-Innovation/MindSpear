<?php

namespace App\Deck\Slides;

use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Support\Collection;

/**
 * One slide type of the shared slide engine (Quest and Quiz). Every type
 * ships the same hooks; controllers dispatch through SlideTypeRegistry and
 * never switch on `type`.
 *
 * `$options` is always a run's options_snapshot:
 * list<array{id:int, position:int, label:?string, image_file_id:?int, image_url:?string, is_correct:?bool, payload:array}>.
 * Media for image/pin_on_image/video lives in `$config['media']` = {file_id, url, width, height, mime}.
 */
interface SlideTypeContract
{
    /** Results update live on the presenter while voting (Quest polls). */
    public const REVEAL_LIVE = 'live_aggregate';

    /** Results stay hidden until the host reveals them (Quiz). */
    public const REVEAL_HIDDEN = 'hidden_until_reveal';

    /** Host-moderated feed (Q&A). */
    public const REVEAL_MODERATED = 'moderated_feed';

    /** Content slides: nothing to reveal. */
    public const REVEAL_NONE = 'none';

    public const CATEGORY_POLL = 'poll';

    public const CATEGORY_INTERACTIVE = 'interactive';

    public const CATEGORY_CONTENT = 'content';

    public function key(): string;

    /** @return list<string> e.g. ['quest'] or ['quest', 'quiz'] */
    public function products(): array;

    /** 'poll' | 'interactive' | 'content' */
    public function category(): string;

    public function revealModel(): string;

    /** False for content types. */
    public function acceptsAnswers(): bool;

    public function defaultConfig(): array;

    /** @return list<array{label: ?string, payload: array}> seeded on slide creation */
    public function defaultOptions(): array;

    /**
     * Normalised config for author edits.
     *
     * @throws \Illuminate\Validation\ValidationException
     */
    public function validateConfig(array $config): array;

    /**
     * Normalised participant submission.
     *
     * @throws \Illuminate\Validation\ValidationException
     */
    public function validateAnswer(array $payload, array $config, array $options): array;

    /** Quest types return ScoreResult::zero(). */
    public function score(array $payload, array $config, array $options, int $timeToAnswerMs): ScoreResult;

    /**
     * Pure and deterministic: same answers in, same snapshot out.
     *
     * @param  Collection<int, \App\Models\Deck\DeckParticipantAnswer>  $answers
     */
    public function aggregate(array $config, array $options, Collection $answers): array;

    public function serializeForPresenter(DeckSessionSlideRun $run, array $aggregate): array;

    /** Never includes the aggregate, `is_correct` or any other answer-key data. */
    public function serializeForParticipant(DeckSessionSlideRun $run): array;
}
