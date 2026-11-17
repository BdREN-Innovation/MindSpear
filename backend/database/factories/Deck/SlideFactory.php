<?php

namespace Database\Factories\Deck;

use App\Models\Deck\Deck;
use App\Models\Deck\Slide;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Slide>
 */
class SlideFactory extends Factory
{
    protected $model = Slide::class;

    public function definition(): array
    {
        return [
            'deck_id' => Deck::factory(),
            'type' => 'poll_single',
            // Next free 1-based position in the deck.
            'position' => fn (array $attributes) => (int) Slide::where('deck_id', $attributes['deck_id'])->max('position') + 1,
            'title' => fake()->sentence(4),
            'body' => null,
            'config' => [],
        ];
    }

    public function ofType(string $type, array $config = []): static
    {
        return $this->state(['type' => $type, 'config' => $config]);
    }
}
