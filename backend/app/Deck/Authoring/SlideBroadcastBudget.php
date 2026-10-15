<?php

namespace App\Deck\Authoring;

use App\Deck\Broadcasts\Payloads\SlideChangedPayload;
use App\Deck\Http\DeckValidation;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\TakesMedia;
use App\Events\Live\LiveBroadcastEvent;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Deck\Slide;
use App\Models\File;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Keeps every authorable slide small enough for its public `slide.changed`
 * broadcast. That event carries the participant serialisation of the run
 * (title, rich-text body, public config, every option's label, image url and
 * payload), and Reverb answers a publish over `max_request_size` (10,000
 * bytes, headers included) with 413, so participants would never see the
 * slide. Pusher JSON-encodes the payload twice (data is a JSON string inside
 * the JSON body), so a non-ASCII character costs up to 7 bytes.
 *
 * measure() builds the run the session launcher would snapshot from the
 * slide as it is about to be stored, serialises it through the slide type
 * (serializeForParticipant) and SlideChangedPayload/LiveBroadcastEvent, and
 * returns the size of the Pusher HTTP body. Ids, channel key and timestamps
 * use worst-case widths.
 */
final class SlideBroadcastBudget
{
    /** Largest Pusher body allowed; leaves room for the HTTP headers under Reverb's 10,000-byte limit. */
    public const MAX_BYTES = 8_500;

    /** Sizing id: wider than any id this app will reach (10 digits). */
    private const WIDE_ID = 9_999_999_999;

    /**
     * @param  array{title:?string, body:?array, config:array}  $content  the slide's stored values after this write
     * @param  list<array{label:?string, payload:array, image_file_id?:?int}>  $options  every option after this write, in order
     */
    public static function measure(SlideTypeContract $type, Slide $slide, array $content, array $options): int
    {
        $config = $content['config'];
        if ($type instanceof TakesMedia) {
            try {
                $config = $type->withMedia($config, $slide->media_file_id ? File::withTrashed()->find($slide->media_file_id) : null);
            } catch (ValidationException) {
                // The session launcher rejects such media; size without it.
            }
        }

        $now = now();
        $run = new DeckSessionSlideRun();
        $run->forceFill([
            'id' => self::WIDE_ID,
            'deck_session_id' => self::WIDE_ID,
            'slide_id' => self::WIDE_ID,
            'position_snapshot' => 99_999,
            'type_snapshot' => $type->key(),
            'title_snapshot' => $content['title'],
            'body_snapshot' => $content['body'],
            'config_snapshot' => $config,
            'options_snapshot' => self::optionSnapshots($options),
            'time_limit_seconds' => $type->acceptsAnswers() ? DeckSettings::MAX_TIME_LIMIT : null,
            'get_ready_seconds' => $type->acceptsAnswers() ? DeckSettings::MAX_GET_READY : null,
            'state' => DeckSessionSlideRun::STATE_WAITING,
            'state_version' => 99_999,
            'state_started_at' => $now,
            'voting_started_at' => $now,
            'closed_at' => $now,
        ]);

        try {
            $payload = SlideChangedPayload::fromRun($run, $type->serializeForParticipant($run), 99_999);
            $channel = 'session.' . $slide->deck?->product . '.' . str_repeat('x', 32);
            $event = LiveBroadcastEvent::fromPayload($payload, $channel, [
                'module' => (string) $slide->deck?->product,
                'session_id' => self::WIDE_ID,
                'broadcasted_at' => $now->toISOString(),
            ]);

            $body = json_encode([
                'name' => $event->broadcastAs(),
                'data' => json_encode($event->broadcastWith() + ['socket' => null], JSON_THROW_ON_ERROR),
                'channels' => [$channel],
            ], JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            return PHP_INT_MAX;
        }

        return strlen($body);
    }

    /**
     * 422 on $field when the slide would not fit.
     *
     * @throws ValidationException
     */
    public static function assertFits(SlideTypeContract $type, Slide $slide, array $content, array $options, string $field): void
    {
        $bytes = self::measure($type, $slide, $content, $options);

        if ($bytes > self::MAX_BYTES) {
            DeckValidation::fail([$field => 'This slide has too much content to send to participants live. Shorten the title, text, options or settings.']);
        }
    }

    /** The slide's current content (title, body, config) and options (with image urls), as stored. */
    public static function current(Slide $slide): array
    {
        $options = $slide->options()->with('imageFile')->orderBy('position')->get()->map(fn ($option) => [
            'label' => $option->label,
            'payload' => is_array($option->payload) ? $option->payload : [],
            'image_file_id' => $option->image_file_id,
            'image_url' => $option->image_file_id && $option->imageFile ? $option->imageFile->url : null,
            'id' => (int) $option->id,
        ])->all();

        return [
            ['title' => $slide->title, 'body' => $slide->body, 'config' => is_array($slide->config) ? $slide->config : []],
            $options,
        ];
    }

    private static function optionSnapshots(array $options): array
    {
        $rows = [];
        foreach (array_values($options) as $index => $option) {
            $rows[] = [
                'id' => self::WIDE_ID,
                'position' => $index + 1,
                'label' => $option['label'] ?? null,
                'image_file_id' => $option['image_file_id'] ?? null,
                'image_url' => $option['image_url'] ?? null,
                'is_correct' => null,
                'payload' => $option['payload'] ?? [],
            ];
        }

        return $rows;
    }
}
