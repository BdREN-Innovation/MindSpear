<?php

namespace App\Deck\Http\Resources;

use App\Models\Deck\SlideOption;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Collection;

/**
 * Authoring view of a slide option (camelCase). Owner-only: it includes
 * `isCorrect` (Quiz), so never use it for participants — live payloads come
 * from the slide type's serializeForParticipant().
 */
class OptionPresenter
{
    /** Relations option() reads; eager-load them for lists. */
    public const WITH = ['imageFile'];

    /**
     * @return array{id:int, slideId:int, position:int, label:?string, imageFileId:?int,
     *               image:?array, isCorrect:?bool, payload:array|object, createdAt:?string, updatedAt:?string}
     */
    public static function option(SlideOption $option): array
    {
        return [
            'id' => (int) $option->id,
            'slideId' => (int) $option->slide_id,
            'position' => (int) $option->position,
            'label' => $option->label,
            'imageFileId' => $option->image_file_id,
            'image' => MediaPresenter::file($option->image_file_id ? $option->imageFile : null),
            'isCorrect' => $option->is_correct,
            'payload' => MediaPresenter::object($option->payload),
            'createdAt' => MediaPresenter::iso($option->created_at),
            'updatedAt' => MediaPresenter::iso($option->updated_at),
        ];
    }

    /** @param iterable<SlideOption> $options */
    public static function collection(iterable $options): array
    {
        $options = $options instanceof Collection ? $options : collect($options);

        if ($options instanceof EloquentCollection) {
            $options->loadMissing(self::WITH);
        }

        return $options->map(fn (SlideOption $option) => self::option($option))->values()->all();
    }
}
