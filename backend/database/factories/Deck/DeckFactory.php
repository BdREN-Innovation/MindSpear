<?php

namespace Database\Factories\Deck;

use App\Models\Deck\Deck;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Deck>
 */
class DeckFactory extends Factory
{
    protected $model = Deck::class;

    public function definition(): array
    {
        return [
            'owner_id' => fn () => self::newOwner()->id,
            'product' => Deck::PRODUCT_QUEST,
            'title' => fake()->sentence(3),
            'description' => null,
            'settings' => [],
        ];
    }

    public function quiz(): static
    {
        return $this->state(['product' => Deck::PRODUCT_QUIZ]);
    }

    public function ownedBy(User $user): static
    {
        return $this->state(['owner_id' => $user->id]);
    }

    public function published(): static
    {
        return $this->state(['published_at' => now()]);
    }

    /** A throwaway host, "Deck Owner". */
    public static function newOwner(): User
    {
        return User::factory()->create(['first_name' => 'Deck', 'last_name' => 'Owner']);
    }
}
