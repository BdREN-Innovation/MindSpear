<?php

namespace App\Deck\Authoring;

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\DeckValidation;
use App\Deck\Support\OptionLimits;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Options of a slide (choices, ranking items, scale statements, ...).
 * Counts stay within config('deck.option_limits') (OptionLimits): the cap
 * keeps whole-aggregate broadcasts under Reverb's publish limit, the
 * minimum keeps the slide answerable. Types without options refuse them.
 * Count checks run under the deck row lock (SlidePositions::lock), the same
 * lock slide moves take first, so the two never wait on each other in
 * opposite order.
 */
class SlideOptionService
{
    public function __construct(private readonly SlideInput $input) {}

    /** Appends an option at the end (422 `options` when the type has none or the cap is reached). */
    public function add(Slide $slide, array $data): SlideOption
    {
        $deck = $slide->deck;
        $type = $this->input->typeOf($slide, $deck->product);

        if (! $this->input->takesOptions($type)) {
            DeckValidation::fail(['options' => 'This slide type has no options.']);
        }

        $label = $this->input->label($data['label'] ?? null);
        $payload = $this->input->payload($data['payload'] ?? null);

        return DB::transaction(function () use ($slide, $deck, $type, $label, $payload) {
            SlidePositions::lock($deck);

            $count = $slide->options()->count();
            $max = OptionLimits::max($type->key());
            if ($count >= $max) {
                DeckValidation::fail(['options' => "This slide can have at most {$max} options."]);
            }

            [$content, $options] = SlideBroadcastBudget::current($slide);
            $options[] = ['label' => $label, 'payload' => $payload];
            SlideBroadcastBudget::assertFits($type, $slide, $content, $options, 'options');

            $option = SlideOption::create([
                'slide_id' => $slide->id,
                'position' => (int) $slide->options()->max('position') + 1,
                'label' => $label,
                'payload' => $payload,
            ]);

            $slide->touch();
            $deck->touch();

            return $option->setRelation('slide', $slide);
        });
    }

    /** label and/or payload; the slide must still fit its slide.changed broadcast (422 on the changed field). */
    public function update(SlideOption $option, array $data): SlideOption
    {
        $slide = $option->slide;
        $changes = [];

        if (array_key_exists('label', $data)) {
            $changes['label'] = $this->input->label($data['label']);
        }

        if (array_key_exists('payload', $data)) {
            $changes['payload'] = $this->input->payload($data['payload']);
        }

        if ($changes === []) {
            return $option;
        }

        $type = $this->input->typeOf($slide, $slide->deck->product);

        return DB::transaction(function () use ($option, $slide, $type, $changes) {
            SlidePositions::lock($slide->deck);

            [$content, $options] = SlideBroadcastBudget::current($slide);
            foreach ($options as $index => $row) {
                if ($row['id'] === (int) $option->id) {
                    $options[$index] = array_replace($row, $changes);
                }
            }
            SlideBroadcastBudget::assertFits($type, $slide, $content, $options, array_key_exists('payload', $changes) ? 'payload' : 'label');

            $option->fill($changes)->save();
            $slide->touch();
            $slide->deck->touch();

            return $option;
        });
    }

    /**
     * New option order from [{id, position}] with 0-based positions (the
     * request checked they are exactly 0..n-1). The list must name every
     * option of $slide: 422 `options.N.id` for an id that is not on the
     * slide, 409 conflict when one is missing. Stored 1..n in one UPDATE.
     *
     * @param  list<array{id:int, position:int}>  $items
     */
    public function reorder(Slide $slide, array $items): void
    {
        DB::transaction(function () use ($slide, $items) {
            SlidePositions::lock($slide->deck);

            $current = array_flip($slide->options()->pluck('id')->map(fn ($id) => (int) $id)->all());

            $errors = [];
            foreach (array_values($items) as $index => $item) {
                if (! isset($current[$item['id']])) {
                    $errors["options.{$index}.id"] = 'This option is not on this slide (it may have been deleted).';
                }
            }

            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            if (count($items) !== count($current)) {
                throw DeckException::conflict('The option list changed. Reload and try again.');
            }

            // slide_options has no unique position index: one CASE update is safe.
            $cases = [];
            $bindings = [];
            foreach ($items as $item) {
                $cases[] = 'WHEN ? THEN CAST(? AS integer)';
                array_push($bindings, $item['id'], $item['position']);
            }

            $ids = array_column($items, 'id');

            DB::update(
                'UPDATE slide_options SET position = CASE id ' . implode(' ', $cases) . ' END, updated_at = ?'
                . ' WHERE slide_id = ? AND id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')',
                [...$bindings, now(), $slide->id, ...$ids],
            );

            $slide->touch();
            $slide->deck->touch();
        });
    }

    /** Removes the option and closes the gap (422 `options` below the type's minimum). */
    public function delete(SlideOption $option): void
    {
        $slide = $option->slide;
        $min = OptionLimits::min((string) $slide->type);

        DB::transaction(function () use ($option, $slide, $min) {
            SlidePositions::lock($slide->deck);

            $position = SlideOption::query()->whereKey($option->id)->value('position');
            if ($position === null) {
                return;
            }

            if ($slide->options()->count() - 1 < $min) {
                throw ValidationException::withMessages([
                    'options' => "This slide needs at least {$min} " . ($min === 1 ? 'option' : 'options') . '.',
                ]);
            }

            $option->delete();

            // slide_options has no unique position index: a plain shift is safe.
            SlideOption::query()->where('slide_id', $slide->id)->where('position', '>', $position)->decrement('position');

            $slide->touch();
            $slide->deck->touch();
        });
    }
}
