<?php

namespace App\Deck\Sessions;

use App\Deck\Exceptions\DeckException;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\TakesMedia;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Host starts a live session of a deck (plan §3.1, "Session slide snapshots").
 *
 * Every non-deleted slide is frozen into one deck_session_slide_runs row, in
 * deck order (position_snapshot = 1..N). Live code only ever reads those
 * snapshots, so editing the deck mid-session cannot corrupt the session.
 *
 * - config_snapshot: the slide config, with `media` rebuilt from the slide's
 *   My Files row (TakesMedia::withMedia, file withTrashed, URL from
 *   File::url) so a file deleted mid-session keeps working. Types that need
 *   media (pin_on_image: requiresMedia()) must have it: 422 keyed
 *   `slides.{position}.media`.
 * - options_snapshot: list<{id, position, label, image_file_id, image_url,
 *   is_correct, payload}>.
 * - time_limit_seconds / get_ready_seconds: only types that accept answers
 *   are timed, and only by the slide's own values. Authoring seeds every new
 *   answer slide from the deck settings (SlideInput::seedTiming) and a later
 *   change of the deck default must never reach existing slides, so null or
 *   0 on the slide means off: there is no deck-settings fallback here. Q&A
 *   and content runs are always untimed (null).
 *
 * One live session per deck: the deck row is locked while checking, and a
 * second start answers 409 conflict with data.session_id of the live one.
 */
class SessionLauncher
{
    public function __construct(
        private readonly SlideTypeRegistry $registry,
        private readonly JoinCodeGenerator $joinCodes,
    ) {}

    /**
     * @throws DeckException 409 when the deck has no slides or already has a live session,
     *                       422 unsupported_type for a slide type the product does not offer
     * @throws ValidationException 422 keyed slides.{position}.* when a slide cannot be snapshotted
     */
    public function start(Deck $deck, User $host): DeckSession
    {
        return DB::transaction(function () use ($deck, $host) {
            // Serialises concurrent starts of the same deck.
            $locked = Deck::query()->whereKey($deck->id)->lockForUpdate()->first();
            if (! $locked) {
                throw DeckException::notFound('Deck not found.');
            }

            $live = DeckSession::query()->where('deck_id', $locked->id)->live()->orderByDesc('id')->first();
            if ($live) {
                throw new DeckException(
                    'This deck already has a live session. End it before starting another one.',
                    409,
                    DeckException::CODE_CONFLICT,
                    ['session_id' => (int) $live->id],
                );
            }

            $slides = $locked->slides()->with(['mediaFile', 'options.imageFile'])->get();
            if ($slides->isEmpty()) {
                throw DeckException::conflict('Add at least one slide before starting a session.');
            }

            $snapshots = [];
            foreach ($slides->values() as $index => $slide) {
                $snapshots[] = $this->snapshot($locked->product, $slide, $index + 1);
            }

            $now = now();
            $session = DeckSession::create([
                'deck_id' => $locked->id,
                'host_user_id' => $host->id,
                'public_channel_key' => $this->publicChannelKey(),
                'join_code' => $this->joinCodes->generate(),
                'status' => DeckSession::STATUS_LIVE,
                'started_at' => $now,
            ]);

            $first = null;
            foreach ($snapshots as $snapshot) {
                $run = DeckSessionSlideRun::create(['deck_session_id' => $session->id] + $snapshot);
                $first ??= $run;
            }

            $session->forceFill(['current_slide_run_id' => $first->id])->save();

            return $session->setRelation('deck', $locked);
        });
    }

    /** Run attributes for one slide (everything except deck_session_id). */
    private function snapshot(string $product, Slide $slide, int $position): array
    {
        $type = $this->registry->has((string) $slide->type) ? $this->registry->for($slide->type) : null;

        if (! $type || ! in_array($product, $type->products(), true)) {
            $message = "Slide {$slide->position} uses a slide type this product does not offer.";

            throw new DeckException($message, 422, DeckException::CODE_UNSUPPORTED_TYPE, [
                'type' => $slide->type,
                'position' => (int) $slide->position,
                'validation_errors' => ["slides.{$slide->position}.type" => [$message]],
            ]);
        }

        $config = $this->snapshotConfig($type, $slide);
        $timed = $type->acceptsAnswers();

        return [
            'slide_id' => $slide->id,
            'position_snapshot' => $position,
            'type_snapshot' => $slide->type,
            'title_snapshot' => $slide->title,
            'body_snapshot' => $slide->body,
            'config_snapshot' => $config,
            'options_snapshot' => $slide->options->map(fn (SlideOption $option) => self::optionSnapshot($option))->values()->all(),
            'time_limit_seconds' => $timed ? self::seconds($slide->time_limit_seconds) : null,
            'get_ready_seconds' => $timed ? self::seconds($slide->get_ready_seconds) : null,
            'state' => DeckSessionSlideRun::STATE_WAITING,
            'state_version' => 0,
        ];
    }

    /** Slide config with server-owned media; 422 keyed slides.{position}.* naming the slide. */
    private function snapshotConfig(SlideTypeContract $type, Slide $slide): array
    {
        $config = is_array($slide->config) ? $slide->config : [];

        try {
            if ($type instanceof TakesMedia) {
                $config = $type->withMedia($config, $slide->media_file_id ? $slide->mediaFile : null);
            }

            if (method_exists($type, 'requiresMedia') && $type->requiresMedia() && method_exists($type, 'assertMediaPresent')) {
                $type->assertMediaPresent($config);
            }
        } catch (ValidationException $e) {
            $errors = [];
            foreach ($e->errors() as $key => $messages) {
                $errors["slides.{$slide->position}.{$key}"] = array_map(
                    fn (string $message) => "Slide {$slide->position}: {$message}",
                    $messages,
                );
            }

            throw ValidationException::withMessages($errors);
        }

        return $config;
    }

    /** @return array{id:int, position:int, label:?string, image_file_id:?int, image_url:?string, is_correct:?bool, payload:array} */
    public static function optionSnapshot(SlideOption $option): array
    {
        return [
            'id' => (int) $option->id,
            'position' => (int) $option->position,
            'label' => $option->label,
            'image_file_id' => $option->image_file_id,
            'image_url' => $option->image_file_id && $option->imageFile ? $option->imageFile->url : null,
            'is_correct' => $option->is_correct,
            'payload' => is_array($option->payload) ? $option->payload : [],
        ];
    }

    private function publicChannelKey(): string
    {
        do {
            $key = Str::lower(Str::random(32));
        } while (DeckSession::query()->where('public_channel_key', $key)->exists());

        return $key;
    }

    /** A positive whole number of seconds, or null (untimed / off). */
    private static function seconds(mixed $value): ?int
    {
        if (is_string($value) && ctype_digit($value)) {
            $value = (int) $value;
        }

        return is_int($value) && $value > 0 ? $value : null;
    }
}
