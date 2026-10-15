<?php

namespace App\Deck\Authoring;

use App\Deck\Exceptions\DeckException;
use App\Deck\Slides\SlideTypeContract;
use App\Models\Deck\Deck;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use stdClass;

/**
 * Slide authoring for any product (plan §2.1, §2.5, §5.7 bulk). Every
 * change that moves positions runs in one transaction holding the deck row
 * lock (SlidePositions). Type rules come from the registry via SlideInput;
 * nothing here switches on a type key.
 */
class SlideAuthoringService
{
    /** Largest POST /slides/bulk (plan §5.7). */
    public const MAX_BULK = 50;

    /** Default cap on live slides per deck (config deck.max_slides_per_deck). */
    public const DEFAULT_MAX_SLIDES = 100;

    public function __construct(private readonly SlideInput $input) {}

    /** Most live slides a deck may hold; reorder accepts lists up to this size. */
    public static function maxSlides(): int
    {
        return max(1, (int) config('deck.max_slides_per_deck', self::DEFAULT_MAX_SLIDES));
    }

    /**
     * 422 slide_limit_reached when $adding more slides would take deck
     * $deckId past maxSlides(). Call under SlidePositions::lock().
     *
     * @throws DeckException
     */
    public static function assertRoom(int $deckId, int $adding): void
    {
        self::assertSlideCount(Slide::query()->where('deck_id', $deckId)->count() + $adding);
    }

    /**
     * 422 slide_limit_reached (also on validation_errors.slides) when a deck
     * would hold $total live slides, over maxSlides().
     *
     * @throws DeckException
     */
    public static function assertSlideCount(int $total): void
    {
        $max = self::maxSlides();

        if ($total > $max) {
            throw DeckException::slideLimit($max);
        }
    }

    /**
     * A new slide of $typeKey seeded from the registry (defaultConfig,
     * defaultOptions, deck timer defaults), after $afterPosition (null =
     * at the end).
     */
    public function append(Deck $deck, string $typeKey, ?int $afterPosition = null): Slide
    {
        $type = $this->input->supportedType($deck->product, $typeKey);

        return DB::transaction(function () use ($deck, $type, $afterPosition) {
            SlidePositions::lock($deck);
            self::assertRoom($deck->id, 1);
            $position = SlidePositions::open($deck->id, $afterPosition, 1);
            $slide = $this->create($deck, $type, $position);
            $deck->touch();

            return $slide;
        });
    }

    /**
     * Partial update: title, body, config (merged onto the stored config,
     * server-managed keys dropped), time_limit_seconds, get_ready_seconds.
     * All field errors are reported together. Runs under the deck row lock
     * and merges onto the slide row as it is now (re-read FOR UPDATE), so two
     * overlapping partial PATCHes both land. The result must fit the
     * slide.changed broadcast (SlideBroadcastBudget).
     *
     * @param  array  $data  validated input; `body` must be the raw (untrimmed) value
     */
    public function update(Slide $slide, array $data): Slide
    {
        $deck = $slide->deck;

        return DB::transaction(function () use ($deck, $slide, $data) {
            SlidePositions::lock($deck);

            $fresh = Slide::query()->whereKey($slide->id)->lockForUpdate()->first();
            if ($fresh === null) {
                throw DeckException::notFound('Slide not found.');
            }
            $fresh->setRelation('deck', $deck);

            $type = $this->input->typeOf($fresh, $deck->product);

            $errors = [];
            $changes = [];

            if (array_key_exists('title', $data)) {
                $changes['title'] = $this->input->title($data['title']);
            }

            if (array_key_exists('body', $data)) {
                $body = SlideInput::collect($errors, '', fn () => ['value' => $this->input->body($type, $data['body'])]);
                if ($body !== null) {
                    $changes['body'] = $body['value'];
                }
            }

            if (array_key_exists('config', $data)) {
                $config = SlideInput::collect($errors, '', fn () => $this->input->config($type, (array) $data['config'], $fresh->config ?? []));
                if ($config !== null) {
                    $changes['config'] = $config;
                }
            }

            $changes += SlideInput::collect($errors, '', fn () => $this->input->timing($type, $data)) ?? [];

            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            $content = array_intersect_key($changes, array_flip(['title', 'body', 'config']));
            if ($content !== []) {
                [$current, $options] = SlideBroadcastBudget::current($fresh);
                $field = array_key_first(array_intersect_key(array_flip(['config', 'body', 'title']), $content));
                SlideBroadcastBudget::assertFits($type, $fresh, $content + $current, $options, $field);
            }

            if ($changes !== []) {
                $fresh->fill($changes)->save();
                $deck->touch();
            }

            return $fresh;
        });
    }

    /** Soft-deletes $slide and closes the gap. Its options and My Files media are left alone. */
    public function delete(Slide $slide): void
    {
        $deck = $slide->deck;

        DB::transaction(function () use ($deck, $slide) {
            SlidePositions::lock($deck);
            $position = $this->currentPosition($slide);

            $slide->delete();
            SlidePositions::close($deck->id, $position);
            $deck->touch();
        });
    }

    /** A copy of $slide (options and *_file_id refs included) right after it. */
    public function duplicate(Slide $slide): Slide
    {
        $deck = $slide->deck;

        return DB::transaction(function () use ($deck, $slide) {
            SlidePositions::lock($deck);
            $after = $this->currentPosition($slide);
            self::assertRoom($deck->id, 1);
            $position = SlidePositions::open($deck->id, $after, 1);
            $copy = $this->copy($slide->load('options'), $deck->id, $position);
            $deck->touch();

            return $copy;
        });
    }

    /**
     * New order from [{id, position}]: the list must name every live slide
     * of the deck once. Positions only need to be distinct; slides are
     * renumbered 1..n in their order.
     *
     * @param  list<array{id:int|string, position:int|string}>  $items
     * @return list<array{id:int, position:int}>
     */
    public function reorder(Deck $deck, array $items): array
    {
        return DB::transaction(function () use ($deck, $items) {
            SlidePositions::lock($deck);

            $live = Slide::query()->where('deck_id', $deck->id)->pluck('id')->map(fn ($id) => (int) $id)->all();
            $liveSet = array_flip($live);

            $errors = [];
            foreach (array_values($items) as $index => $item) {
                if (! isset($liveSet[(int) $item['id']])) {
                    $errors["slides.{$index}.id"] = 'This slide is not in the deck (it may have been deleted).';
                }
            }

            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            if (count($items) !== count($live)) {
                throw DeckException::conflict('The slide list changed. Reload and try again.');
            }

            $sorted = array_values($items);
            usort($sorted, fn (array $a, array $b) => (int) $a['position'] <=> (int) $b['position']);

            $positions = [];
            foreach ($sorted as $index => $item) {
                $positions[(int) $item['id']] = $index + 1;
            }

            SlidePositions::apply($deck->id, $positions);
            $deck->touch();

            return SlidePositions::order($deck->id);
        });
    }

    /**
     * Adds up to MAX_BULK slides in one transaction after $afterPosition
     * (null = at the end). Everything is validated before anything is
     * written, so one bad slide saves nothing.
     *
     * @param  list<array{type:string, title?:?string, body?:?array, config?:?array, options?:?list<array{label?:?string, payload?:?array}>}>  $slides
     * @return EloquentCollection<int, Slide> the new slides, in order
     */
    public function bulk(Deck $deck, array $slides, ?int $afterPosition = null): EloquentCollection
    {
        $slides = array_values($slides);

        $unsupported = [];
        $types = [];
        foreach ($slides as $index => $data) {
            try {
                $types[$index] = $this->input->supportedType($deck->product, $data['type'] ?? null);
            } catch (DeckException) {
                $unsupported[] = "slides.{$index}.type";
            }
        }

        if ($unsupported !== []) {
            $first = $slides[(int) explode('.', $unsupported[0])[1]]['type'] ?? null;

            throw SlideInput::unsupported(is_string($first) ? $first : null, $unsupported);
        }

        $errors = [];
        $prepared = [];
        foreach ($slides as $index => $data) {
            $type = $types[$index];
            $prefix = "slides.{$index}";

            $prepared[$index] = [
                'type' => $type,
                'attributes' => [
                    'title' => $this->input->title(isset($data['title']) ? (string) $data['title'] : null),
                    'body' => SlideInput::collect($errors, $prefix, fn () => $this->input->body($type, $data['body'] ?? null)),
                    'config' => SlideInput::collect($errors, '', fn () => $this->input->config($type, (array) ($data['config'] ?? []), $this->input->seedConfig($type, $deck->settings), "{$prefix}.config")),
                ],
                'options' => SlideInput::collect($errors, $prefix, fn () => $this->input->options($type, $data['options'] ?? null)),
            ];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        foreach ($prepared as $index => $item) {
            $draft = (new Slide())->setRelation('deck', $deck);
            SlideInput::collect($errors, '', fn () => SlideBroadcastBudget::assertFits(
                $item['type'],
                $draft,
                $item['attributes'],
                $item['options'],
                "slides.{$index}",
            ));
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return DB::transaction(function () use ($deck, $prepared, $afterPosition) {
            SlidePositions::lock($deck);
            self::assertRoom($deck->id, count($prepared));
            $position = SlidePositions::open($deck->id, $afterPosition, count($prepared));

            // Eloquent collection: SlidePresenter::collection() eager-loads it in one go.
            $created = new EloquentCollection();
            $optionRows = [];
            foreach ($prepared as $item) {
                $slide = $this->create($deck, $item['type'], $position++, $item['attributes'], []);
                $optionRows = array_merge($optionRows, self::optionRows($slide->id, $item['options']));
                $created->push($slide);
            }

            self::insertOptions($optionRows);
            $deck->touch();

            return $created;
        });
    }

    /**
     * Inserts a slide of $type at $position (the caller has opened it) with
     * the type's defaults; $attributes override them. $options null = the
     * type's defaultOptions(); [] = none (caller inserts its own).
     */
    public function create(Deck $deck, SlideTypeContract $type, int $position, array $attributes = [], ?array $options = null): Slide
    {
        $slide = Slide::create(array_replace([
            'deck_id' => $deck->id,
            'type' => $type->key(),
            'position' => $position,
            'title' => null,
            'body' => null,
            'config' => $this->input->seedConfig($type, $deck->settings),
        ], $this->input->seedTiming($type, $deck->settings), $attributes));

        self::insertOptions(self::optionRows($slide->id, $options ?? $this->input->options($type, null)));

        return $slide;
    }

    /** Copies $slide (with its loaded `options`) into deck $deckId at $position. */
    public function copy(Slide $slide, int $deckId, int $position): Slide
    {
        $copy = Slide::create([
            'deck_id' => $deckId,
            'type' => $slide->type,
            'position' => $position,
            'title' => $slide->title,
            'body' => $slide->body,
            'config' => $slide->config ?? [],
            'media_file_id' => $slide->media_file_id,
            'time_limit_seconds' => $slide->time_limit_seconds,
            'get_ready_seconds' => $slide->get_ready_seconds,
            'points_min' => $slide->points_min,
            'points_max' => $slide->points_max,
            'speed_bonus_enabled' => $slide->speed_bonus_enabled,
        ]);

        self::insertOptions(self::optionRows($copy->id, $slide->options->map(fn (SlideOption $option) => [
            'label' => $option->label,
            'payload' => $option->payload ?? [],
            'image_file_id' => $option->image_file_id,
            'is_correct' => $option->is_correct,
        ])->all()));

        return $copy;
    }

    /**
     * Rows for insertOptions(), positions 1..n in list order.
     *
     * @param  list<array{label:?string, payload?:array, image_file_id?:?int, is_correct?:?bool}>  $options
     */
    public static function optionRows(int $slideId, array $options): array
    {
        $now = now();
        $rows = [];

        foreach (array_values($options) as $index => $option) {
            $payload = $option['payload'] ?? [];
            $rows[] = [
                'slide_id' => $slideId,
                'position' => $index + 1,
                'label' => $option['label'] ?? null,
                'image_file_id' => $option['image_file_id'] ?? null,
                'is_correct' => $option['is_correct'] ?? null,
                'payload' => json_encode($payload === [] ? new stdClass() : $payload),
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        return $rows;
    }

    public static function insertOptions(array $rows): void
    {
        foreach (array_chunk($rows, 500) as $chunk) {
            SlideOption::query()->insert($chunk);
        }
    }

    /** $slide's position read under the deck lock (404 when it was deleted meanwhile). */
    private function currentPosition(Slide $slide): int
    {
        $position = Slide::query()->whereKey($slide->id)->value('position');

        if ($position === null) {
            throw DeckException::notFound('Slide not found.');
        }

        return (int) $position;
    }
}
