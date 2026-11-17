<?php

namespace App\Deck\Slides;

use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * Defaults for slide types. Concrete types live under app/Deck/Slides/Types
 * and are discovered automatically. Override the hooks you need; to add
 * fields to the participant view use participantExtras() so the privacy
 * stripping here still applies.
 */
abstract class AbstractSlideType implements SlideTypeContract
{
    /** Config keys that are answer keys and must never reach participants. */
    private const ALWAYS_PRIVATE_CONFIG_KEYS = [
        'answer_key',
        'correct_answer',
        'correct_answers',
        'correct_option_id',
        'correct_option_ids',
        'correct_order',
    ];

    /** Option payload keys that reveal the answer. */
    private const ALWAYS_PRIVATE_OPTION_KEYS = [
        'is_correct',
        'correct_order_index',
    ];

    public function products(): array
    {
        return ['quest'];
    }

    public function acceptsAnswers(): bool
    {
        return true;
    }

    public function defaultConfig(): array
    {
        return [];
    }

    public function defaultOptions(): array
    {
        return [];
    }

    /** Defaults filled in; types with author-editable config override this. */
    public function validateConfig(array $config): array
    {
        return array_replace($this->defaultConfig(), $config);
    }

    public function validateAnswer(array $payload, array $config, array $options): array
    {
        if (! $this->acceptsAnswers()) {
            throw ValidationException::withMessages(['answer' => 'This slide does not accept answers.']);
        }

        return $payload;
    }

    public function score(array $payload, array $config, array $options, int $timeToAnswerMs): ScoreResult
    {
        return ScoreResult::zero();
    }

    public function aggregate(array $config, array $options, Collection $answers): array
    {
        return ['total_responses' => $answers->count()];
    }

    public function serializeForParticipant(DeckSessionSlideRun $run): array
    {
        $base = [
            'id' => $run->id,
            'slide_id' => $run->slide_id,
            'type' => $run->type_snapshot,
            'category' => $this->category(),
            'reveal_model' => $this->revealModel(),
            'accepts_answers' => $this->acceptsAnswers(),
            'position' => $run->position_snapshot,
            'title' => $run->title_snapshot,
            'body' => $run->body_snapshot,
            'config' => $this->publicConfig($run->config_snapshot ?? []),
            'options' => $this->publicOptions($run->options_snapshot ?? []),
            'state' => $run->state,
            'state_version' => $run->state_version,
            'time_limit_seconds' => $run->time_limit_seconds,
            'get_ready_seconds' => $run->get_ready_seconds,
            'state_started_at' => $run->state_started_at?->toISOString(),
            'voting_started_at' => $run->voting_started_at?->toISOString(),
            'closed_at' => $run->closed_at?->toISOString(),
        ];

        // Extras can add fields but never an aggregate.
        return Arr::except(array_merge($base, $this->participantExtras($run)), ['aggregate']);
    }

    public function serializeForPresenter(DeckSessionSlideRun $run, array $aggregate): array
    {
        return array_merge($this->serializeForParticipant($run), ['aggregate' => $aggregate]);
    }

    /** Extra participant-safe fields for this type. */
    protected function participantExtras(DeckSessionSlideRun $run): array
    {
        return [];
    }

    /** Type-specific config keys to hide from participants (on top of the answer-key defaults). */
    protected function privateConfigKeys(): array
    {
        return [];
    }

    /** Type-specific option payload keys to hide from participants. */
    protected function privateOptionPayloadKeys(): array
    {
        return [];
    }

    /** Config without answer keys or `_`-prefixed internal keys. */
    protected function publicConfig(array $config): array
    {
        $hidden = array_merge(self::ALWAYS_PRIVATE_CONFIG_KEYS, $this->privateConfigKeys());

        return array_filter(
            Arr::except($config, $hidden),
            fn ($key) => ! is_string($key) || ! str_starts_with($key, '_'),
            ARRAY_FILTER_USE_KEY,
        );
    }

    /** @return list<array{id:int, position:int, label:?string, image_url:?string, payload:array}> */
    protected function publicOptions(array $options): array
    {
        $hidden = array_merge(self::ALWAYS_PRIVATE_OPTION_KEYS, $this->privateOptionPayloadKeys());

        return array_values(array_map(fn (array $option) => [
            'id' => $option['id'] ?? null,
            'position' => $option['position'] ?? null,
            'label' => $option['label'] ?? null,
            'image_url' => $option['image_url'] ?? null,
            'payload' => Arr::except($option['payload'] ?? [], $hidden),
        ], $options));
    }
}
