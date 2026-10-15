<?php

namespace Database\Factories\Deck;

use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SlideOption>
 */
class SlideOptionFactory extends Factory
{
    protected $model = SlideOption::class;

    public function definition(): array
    {
        return [
            'slide_id' => Slide::factory(),
            'position' => fn (array $attributes) => (int) SlideOption::where('slide_id', $attributes['slide_id'])->max('position') + 1,
            'label' => fake()->word(),
            'payload' => [],
        ];
    }
}
