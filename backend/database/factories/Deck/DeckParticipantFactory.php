<?php

namespace Database\Factories\Deck;

use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckSession;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<DeckParticipant>
 */
class DeckParticipantFactory extends Factory
{
    protected $model = DeckParticipant::class;

    public function definition(): array
    {
        return [
            'deck_session_id' => DeckSession::factory(),
            'display_name' => fake()->firstName(),
            'emoji_avatar' => fake()->randomElement(['🦊', '🐼', '🐙', '🦉', '🐢']),
            'participant_token_hash' => fn () => hash('sha256', Str::random(40)),
            'participant_token_expires_at' => now()->addDay(),
            'joined_at' => now(),
        ];
    }
}
