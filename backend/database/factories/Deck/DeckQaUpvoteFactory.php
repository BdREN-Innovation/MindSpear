<?php

namespace Database\Factories\Deck;

use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckQaQuestion;
use App\Models\Deck\DeckQaUpvote;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Creates the row only; callers that test counts must also bump
 * deck_qa_questions.upvote_count themselves.
 *
 * @extends Factory<DeckQaUpvote>
 */
class DeckQaUpvoteFactory extends Factory
{
    protected $model = DeckQaUpvote::class;

    public function definition(): array
    {
        return [
            'qa_question_id' => DeckQaQuestion::factory(),
            'participant_id' => fn (array $attributes) => DeckParticipant::factory()->create([
                'deck_session_id' => DeckQaQuestion::findOrFail($attributes['qa_question_id'])->deck_session_id,
            ])->id,
        ];
    }
}
