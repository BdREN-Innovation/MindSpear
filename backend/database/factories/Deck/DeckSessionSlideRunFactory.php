<?php

namespace Database\Factories\Deck;

use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Deck\Slide;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DeckSessionSlideRun>
 */
class DeckSessionSlideRunFactory extends Factory
{
    protected $model = DeckSessionSlideRun::class;

    public function definition(): array
    {
        return [
            'deck_session_id' => DeckSession::factory(),
            'slide_id' => null,
            'position_snapshot' => fn (array $attributes) => (int) DeckSessionSlideRun::where('deck_session_id', $attributes['deck_session_id'])->max('position_snapshot') + 1,
            'type_snapshot' => 'poll_single',
            'title_snapshot' => fake()->sentence(4),
            'body_snapshot' => null,
            'config_snapshot' => [],
            'options_snapshot' => [],
            'state' => DeckSessionSlideRun::STATE_WAITING,
            'state_version' => 0,
        ];
    }

    public function inState(string $state): static
    {
        return $this->state(fn () => [
            'state' => $state,
            'state_version' => 1,
            'state_started_at' => now(),
            'voting_started_at' => in_array($state, [DeckSessionSlideRun::STATE_VOTING, DeckSessionSlideRun::STATE_OPEN, DeckSessionSlideRun::STATE_CLOSED], true) ? now() : null,
            'closed_at' => $state === DeckSessionSlideRun::STATE_CLOSED ? now() : null,
        ]);
    }

    /**
     * Snapshot an authoring slide the way session start does (without media URL
     * resolution). `options` is the snapshot shape the slide types expect.
     */
    public function fromSlide(Slide $slide): static
    {
        return $this->state(fn () => [
            'slide_id' => $slide->id,
            'position_snapshot' => $slide->position,
            'type_snapshot' => $slide->type,
            'title_snapshot' => $slide->title,
            'body_snapshot' => $slide->body,
            'config_snapshot' => $slide->config ?? [],
            'options_snapshot' => $slide->options()->get()->map(fn ($option) => [
                'id' => $option->id,
                'position' => $option->position,
                'label' => $option->label,
                'image_file_id' => $option->image_file_id,
                'image_url' => null,
                'is_correct' => $option->is_correct,
                'payload' => $option->payload ?? [],
            ])->values()->all(),
            'time_limit_seconds' => $slide->time_limit_seconds,
            'get_ready_seconds' => $slide->get_ready_seconds,
        ]);
    }
}
