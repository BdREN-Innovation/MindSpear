<?php

namespace Database\Factories\Deck;

use App\Models\Deck\Deck;
use App\Models\Deck\DeckSession;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<DeckSession>
 */
class DeckSessionFactory extends Factory
{
    protected $model = DeckSession::class;

    public function definition(): array
    {
        return [
            'deck_id' => Deck::factory(),
            'host_user_id' => fn (array $attributes) => Deck::withTrashed()->findOrFail($attributes['deck_id'])->owner_id,
            'public_channel_key' => fn () => Str::lower(Str::random(32)),
            // Not the real join-code format (see the join-code generator); just unique.
            'join_code' => fn () => Str::upper(Str::random(10)),
            'status' => DeckSession::STATUS_PENDING,
        ];
    }

    public function live(): static
    {
        return $this->state(['status' => DeckSession::STATUS_LIVE, 'started_at' => now()]);
    }

    public function ended(): static
    {
        return $this->state(['status' => DeckSession::STATUS_ENDED, 'started_at' => now()->subHour(), 'ended_at' => now()]);
    }
}
