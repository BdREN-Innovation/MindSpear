<?php

namespace App\Deck\Slides\Types\Quiz;

use App\Deck\Scoring\QuizScoring;
use App\Deck\Slides\AbstractSlideType;
use App\Deck\Slides\ScoreResult;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Support\Collection;

/**
 * Base for the scored Quiz v2 types (pick_answer_single/multi, short_answer,
 * match_pairs, correct_order, categorise). Abstract, so discovery skips it.
 *
 * products ['quiz'], category poll, reveal model hidden_until_reveal.
 *
 * Scoring: a type turns an answer into an Evaluation (credit 0..1, fully
 * correct or not) through judge(); score() applies QuizScoring with the
 * run's config['scoring'] block (points_min / points_max / speed bonus /
 * time limit). Malformed answers score 0, isCorrect false.
 *
 * Aggregate (every scored type), plus the type's breakdown() fields:
 *   {total_responses: int, correct_responses: int (fully correct),
 *    partially_correct_responses: int (0 < credit < 1; always 0 for the
 *      all-or-nothing types: pick_answer_single/multi, short_answer),
 *    incorrect_responses: int (credit 0),
 *    correct_percentage: float (correct_responses / total_responses * 100, 2 dp),
 *    ...breakdown,
 *    correct: correctAnswer() (the answer key)}
 *   Stored answers that are not answers of the type at all are skipped.
 *
 * Participant view: AbstractSlideType's, with `options` rebuilt in
 * displayOptions() order (position = 1-based display index), each
 * {id: publicId(), position, label, image_url, payload} with answer-key
 * payload keys removed, plus `options_hidden` (bool). serializeForViewer()
 * builds it for one participant: shuffled types (correct_order, match_pairs'
 * right column, categorise) give every participant an order of their own
 * (QuizOptions::shuffle); serializeForParticipant() (public broadcasts) is
 * the run-level order. While the run is `waiting` or `get_ready` a live
 * participant view has `options: []` and `options_hidden: true` (title,
 * body and config still shown), so nothing can be precomputed before
 * answering opens; phones re-read GET state when the run enters `voting`.
 * The presenter view (host only) always has the options, in the run-level
 * order, and adds per option `option_id` (the real id) and the full
 * `payload`, plus `answer_key` (= correctAnswer()) and `aggregate`.
 */
abstract class AbstractQuizType extends AbstractSlideType
{
    /** Seconds a new slide of this type is timed for (defaultSlideAttributes). */
    public const DEFAULT_TIME_LIMIT = 30;

    /** Run states in which a live participant view hides the options (the "Get ready" screen shows the question only). */
    public const OPTIONS_HIDDEN_STATES = [DeckSessionSlideRun::STATE_WAITING, DeckSessionSlideRun::STATE_GET_READY];

    public function products(): array
    {
        return ['quiz'];
    }

    public function category(): string
    {
        return self::CATEGORY_POLL;
    }

    public function revealModel(): string
    {
        return self::REVEAL_HIDDEN;
    }

    /**
     * Slide columns a new slide of this type is seeded with (plan §1.2).
     * Optional authoring hook (call when method_exists): the registry
     * contract only seeds config and options.
     *
     * @return array{time_limit_seconds:?int, points_min:?int, points_max:?int, speed_bonus_enabled:?bool}
     */
    public function defaultSlideAttributes(): array
    {
        return [
            'time_limit_seconds' => static::DEFAULT_TIME_LIMIT,
            'points_min' => QuizScoring::DEFAULT_POINTS_MIN,
            'points_max' => QuizScoring::DEFAULT_POINTS_MAX,
            'speed_bonus_enabled' => QuizScoring::DEFAULT_SPEED_BONUS,
        ];
    }

    /**
     * The correct answer, as the aggregate's `correct` block. Host and
     * after-reveal only (my-answer's correct_answer).
     */
    abstract public function correctAnswer(array $config, array $options): array;

    /** Whatever judge() needs from the config and options, computed once per score/aggregate. */
    abstract protected function answerKey(array $config, array $options): array;

    /** How right $payload is against $key; null when it is not an answer of this type at all. */
    abstract protected function judge(array $payload, array $key): ?Evaluation;

    /**
     * Type-specific aggregate fields from the valid stored payloads.
     *
     * @param  list<array>  $payloads
     */
    abstract protected function breakdown(array $config, array $options, array $key, array $payloads): array;

    public function evaluate(array $payload, array $config, array $options): ?Evaluation
    {
        return $this->judge($payload, $this->answerKey($config, $options));
    }

    public function score(array $payload, array $config, array $options, int $timeToAnswerMs): ScoreResult
    {
        $evaluation = $this->evaluate($payload, $config, $options);

        if ($evaluation === null) {
            return QuizScoring::wrong();
        }

        return QuizScoring::result($config, $timeToAnswerMs, $evaluation->credit, $evaluation->correct);
    }

    public function aggregate(array $config, array $options, Collection $answers): array
    {
        $key = $this->answerKey($config, $options);
        $payloads = [];
        $correct = 0;
        $partial = 0;
        $incorrect = 0;

        foreach ($answers as $answer) {
            $payload = $answer->answer_payload ?? null;
            $evaluation = is_array($payload) ? $this->judge($payload, $key) : null;
            if ($evaluation === null) {
                continue;
            }

            $payloads[] = $payload;
            match (true) {
                $evaluation->correct => $correct++,
                $evaluation->credit > 0 => $partial++,
                default => $incorrect++,
            };
        }

        $total = count($payloads);

        return [
            'total_responses' => $total,
            'correct_responses' => $correct,
            'partially_correct_responses' => $partial,
            'incorrect_responses' => $incorrect,
            'correct_percentage' => QuizOptions::percentage($correct, $total),
            ...$this->breakdown($config, $options, $key, $payloads),
            'correct' => $this->correctAnswer($config, $options),
        ];
    }

    /** The run-level participant view (public broadcasts); options hidden until voting. */
    public function serializeForParticipant(DeckSessionSlideRun $run): array
    {
        return $this->serializeForViewer($run, null);
    }

    /**
     * The participant view for $participantId (null = the run-level order).
     * $hideUntilVoting false keeps the options in every state (the host's
     * run list, the post-session review, authoring's size budget).
     */
    public function serializeForViewer(DeckSessionSlideRun $run, ?int $participantId, bool $hideUntilVoting = true): array
    {
        $view = parent::serializeForParticipant($run);
        $hidden = $hideUntilVoting && in_array($run->state, self::OPTIONS_HIDDEN_STATES, true);
        $view['options'] = $hidden ? [] : $this->participantOptions($run, $participantId);
        $view['options_hidden'] = $hidden;

        return $view;
    }

    public function serializeForPresenter(DeckSessionSlideRun $run, array $aggregate): array
    {
        $view = $this->serializeForViewer($run, null, false);
        $display = $this->displayOptions($run, null);

        $view['options'] = array_map(
            fn (array $row, array $option) => $this->presenterOption($row, $option),
            $view['options'],
            $display,
        );
        $view['answer_key'] = $this->correctAnswer($run->config_snapshot ?? [], $run->options_snapshot ?? []);
        $view['aggregate'] = $aggregate;

        return $view;
    }

    /**
     * The options $participantId sees (null = the run-level order), in the
     * order they see them. Default: every option in author order.
     *
     * @return list<array>
     */
    protected function displayOptions(DeckSessionSlideRun $run, ?int $participantId = null): array
    {
        return QuizOptions::sorted($run->options_snapshot ?? []);
    }

    /** The id participants answer with: the option id, or an opaque key (QuizOptions::key with the run's $config). */
    protected function publicId(array $option, array $config): int|string
    {
        return (int) $option['id'];
    }

    /** Payload participants see for $option (answer-key keys already removed from $public). */
    protected function participantPayload(array $option, array $public): array
    {
        return $public;
    }

    /** One presenter option row: the participant row with the real `option_id` and the full payload. */
    protected function presenterOption(array $row, array $option): array
    {
        return array_replace($row, [
            'option_id' => (int) $option['id'],
            'payload' => is_array($option['payload'] ?? null) ? $option['payload'] : [],
        ]);
    }

    /** @return list<array{id:int|string, position:int, label:?string, image_url:?string, payload:array}> */
    private function participantOptions(DeckSessionSlideRun $run, ?int $participantId): array
    {
        $display = $this->displayOptions($run, $participantId);
        $public = $this->publicOptions($display);
        $config = $run->config_snapshot ?? [];

        foreach ($public as $index => &$row) {
            $row['id'] = $this->publicId($display[$index], $config);
            $row['position'] = $index + 1;
            $row['payload'] = $this->participantPayload($display[$index], $row['payload']);
        }
        unset($row);

        return $public;
    }
}
