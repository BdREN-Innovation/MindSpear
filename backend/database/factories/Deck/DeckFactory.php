<?php

namespace Database\Factories\Deck;

use App\Models\Deck\Deck;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

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

    /**
     * A throwaway host. UserFactory still targets a `name` column the users
     * table no longer has, so deck tests create users with the real columns.
     * Quest v2 is on (authoring and hosting need it); pass false for a user
     * without it, or null to leave the column at its database default.
     */
    public static function newOwner(?bool $questV2 = true): User
    {
        return User::create([
            'first_name' => 'Deck',
            'last_name' => 'Owner',
            'email' => 'deck-owner-' . Str::uuid() . '@example.test',
            'email_verified_at' => now(),
            'is_verified' => true,
            'password' => Hash::make('password'),
        ] + ($questV2 === null ? [] : ['quest_v2_enabled' => $questV2]));
    }
}
