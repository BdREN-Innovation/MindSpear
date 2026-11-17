<?php

namespace Database\Factories\Deck;

use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckParticipantAnswer;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DeckParticipantAnswer>
 */
class DeckParticipantAnswerFactory extends Factory
{
    protected $model = DeckParticipantAnswer::class;

    public function definition(): array
    {
        return [
            'slide_run_id' => DeckSessionSlideRun::factory(),
            // A participant of the same session as the run.
            'deck_participant_id' => fn (array $attributes) => DeckParticipant::factory()->create([
                'deck_session_id' => DeckSessionSlideRun::findOrFail($attributes['slide_run_id'])->deck_session_id,
            ])->id,
            'answer_payload' => [],
            'time_to_answer_ms' => 1500,
            'submitted_at' => now(),
        ];
    }
}
