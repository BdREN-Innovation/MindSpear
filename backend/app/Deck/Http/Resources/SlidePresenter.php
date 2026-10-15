<?php

namespace App\Deck\Http\Resources;

use App\Deck\Slides\SlideTypeRegistry;
use App\Models\Deck\Slide;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Collection;

/**
 * Authoring view of a slide (camelCase), with its options. `config` and
 * `body` are the stored JSONB as-is (their inner keys stay snake_case, the
 * shapes documented on each slide type class). Media is server-owned:
 * `mediaFileId` + `media` come from slides.media_file_id, never config.
 * Owner-only (see OptionPresenter).
 */
class SlidePresenter
{
    /** Relations slide() reads; eager-load them for lists. */
    public const WITH = ['mediaFile', 'options.imageFile'];

    /**
     * @return array{id:int, deckId:int, type:string, category:?string, revealModel:?string,
     *               acceptsAnswers:?bool, position:int, title:?string, body:?array, config:array|object,
     *               mediaFileId:?int, media:?array, timeLimitSeconds:?int, getReadySeconds:?int,
     *               pointsMin:?int, pointsMax:?int, speedBonusEnabled:?bool, options:list<array>,
     *               createdAt:?string, updatedAt:?string}
     */
    public static function slide(Slide $slide): array
    {
        // mediaFile is read lazily below only when media_file_id is set.
        $slide->loadMissing('options.imageFile');
        $registry = app(SlideTypeRegistry::class);
        $type = $registry->has((string) $slide->type) ? $registry->for($slide->type) : null;

        return [
            'id' => (int) $slide->id,
            'deckId' => (int) $slide->deck_id,
            'type' => $slide->type,
            // null for a type key the registry no longer knows.
            'category' => $type?->category(),
            'revealModel' => $type?->revealModel(),
            'acceptsAnswers' => $type?->acceptsAnswers(),
            'position' => (int) $slide->position,
            'title' => $slide->title,
            'body' => $slide->body,
            'config' => MediaPresenter::object($slide->config),
            'mediaFileId' => $slide->media_file_id,
            'media' => MediaPresenter::file($slide->media_file_id ? $slide->mediaFile : null),
            'timeLimitSeconds' => $slide->time_limit_seconds,
            'getReadySeconds' => $slide->get_ready_seconds,
            // Quiz only; null on Quest slides.
            'pointsMin' => $slide->points_min,
            'pointsMax' => $slide->points_max,
            'speedBonusEnabled' => $slide->speed_bonus_enabled,
            'options' => OptionPresenter::collection($slide->options),
            'createdAt' => MediaPresenter::iso($slide->created_at),
            'updatedAt' => MediaPresenter::iso($slide->updated_at),
        ];
    }

    /** @param iterable<Slide> $slides */
    public static function collection(iterable $slides): array
    {
        $slides = $slides instanceof Collection ? $slides : collect($slides);

        if ($slides instanceof EloquentCollection) {
            $slides->loadMissing(self::WITH);
        }

        return $slides->map(fn (Slide $slide) => self::slide($slide))->values()->all();
    }
}
