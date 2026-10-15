<?php

namespace Database\Factories\Deck;

use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckQaQuestion;
use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DeckQaQuestion>
 */
class DeckQaQuestionFactory extends Factory
{
    protected $model = DeckQaQuestion::class;

    public function definition(): array
    {
        return [
            'slide_run_id' => DeckSessionSlideRun::factory()->state(['type_snapshot' => 'qa_audience']),
            'deck_session_id' => fn (array $attributes) => DeckSessionSlideRun::findOrFail($attributes['slide_run_id'])->deck_session_id,
            'participant_id' => fn (array $attributes) => DeckParticipant::factory()->create([
                'deck_session_id' => $attributes['deck_session_id'],
            ])->id,
            'body' => fake()->sentence() . '?',
            'submitted_at' => now(),
        ];
    }
}
