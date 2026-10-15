<?php

namespace App\Deck\Media;

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\DeckValidation;
use App\Deck\Slides\SlideTypeContract;
use App\Deck\Slides\SlideTypeRegistry;
use App\Deck\Slides\TakesMedia;
use App\Deck\Slides\Types\Quest\PinOnImageSlideType;
use App\Models\Deck\Deck;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use App\Models\File;
use App\Models\User;
use App\Modules\FileLibrary\Services\FileStorageService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Attaches My Files items to decks (plan §1.9, §2.1, §2.3): the deck cover,
 * an option image, and a slide's media (image / pin_on_image image, video
 * mp4) or a video slide's YouTube/Vimeo link.
 *
 * - The file must be the actor's own (FilePolicy::manage) and still in My
 *   Files (not soft-deleted); anything else is a 404 `not_found`, like
 *   another user's deck.
 * - The file's kind must fit the slot: covers and option images take an
 *   image; slides take what their slide type's TakesMedia::withMedia()
 *   accepts. Errors are 422 on `file_id` (or `video_url`).
 * - A video slide has a link OR an mp4, never both: setting one clears the
 *   other.
 * - Images whose width/height were never recorded (older uploads) get them
 *   read from the stored bytes on attach, so pin_on_image works for them.
 * - Every attach marks the file used (FileStorageService::markUsed).
 *
 * Detaching (null) never touches My Files.
 */
class DeckMediaService
{
    /** Mime types an image slot takes (the slide types' image formats). */
    public const IMAGE_MIMES = PinOnImageSlideType::IMAGE_MIMES;

    /** One representative mime per category, to ask a slide type what it takes. */
    private const CATEGORY_PROBES = [
        File::CATEGORY_IMAGE => 'image/png',
        File::CATEGORY_VIDEO => 'video/mp4',
    ];

    /** Bytes read from a non-local disk to find an image's size (headers and EXIF live up front). */
    private const HEAD_BYTES = 1024 * 1024;

    /** EXIF orientations that turn the stored image a quarter (browsers swap width and height). */
    private const TRANSPOSED_ORIENTATIONS = [5, 6, 7, 8];

    public function __construct(
        private readonly SlideTypeRegistry $registry,
        private readonly FileStorageService $storage,
    ) {}

    /** Sets (or with null, removes) the deck cover. */
    public function setCover(Deck $deck, User $actor, ?int $fileId): Deck
    {
        $file = $fileId === null ? null : $this->imageFile($actor, $fileId);

        $deck->forceFill(['cover_file_id' => $file?->id])->save();
        $this->markUsed($file);

        return $deck->setRelation('coverFile', $file);
    }

    /** Sets (or with null, removes) an option's image. */
    public function setOptionImage(SlideOption $option, User $actor, ?int $fileId): SlideOption
    {
        $file = $fileId === null ? null : $this->imageFile($actor, $fileId);

        DB::transaction(function () use ($option, $file) {
            $slide = $option->slide;
            $this->lockDeck($slide?->deck_id);

            $option->forceFill(['image_file_id' => $file?->id])->save();
            $slide?->deck?->touch();
        });
        $this->markUsed($file);

        return $option->setRelation('imageFile', $file);
    }

    /**
     * Attaches a My Files item as the slide's media, or removes it (null).
     * On a video slide an uploaded mp4 replaces the video link.
     *
     * @throws ValidationException 422 `file_id` when the slide type takes no media or not this kind of file
     */
    public function setSlideFile(Slide $slide, User $actor, ?int $fileId): Slide
    {
        $type = $this->typeOf($slide);
        $categories = $this->mediaCategories($type);
        if ($categories === []) {
            DeckValidation::fail(['file_id' => 'This slide type does not take media.']);
        }

        $file = $fileId === null ? null : $this->ownedFile($actor, $fileId);
        if ($file !== null) {
            $this->assertKind($file, $categories);
            $this->backfillDimensions($file);
        }

        $saved = DB::transaction(function () use ($slide, $type, $file, $categories) {
            $this->lockDeck($slide->deck_id);
            $locked = $this->lockSlide($slide);
            $changes = ['media_file_id' => $file?->id];

            if ($file !== null) {
                $config = $locked->config ?? [];
                if ($this->takesVideoUrl($type) && ($config['video_url'] ?? null) !== null) {
                    // Link and upload are exclusive: the upload wins.
                    $config = DeckValidation::prefixed('config', fn () => $type->validateConfig(array_replace($config, ['video_url' => null])));
                    $changes['config'] = $config;
                }

                $this->assertTypeTakes($type, $config, $file, $categories);
            }

            $locked->forceFill($changes)->save();
            $slide->deck?->touch();

            return $locked;
        });

        $this->markUsed($file);

        return $this->withRelations($saved, $slide)->setRelation('mediaFile', $file);
    }

    /**
     * Sets (or with null, removes) a video slide's YouTube/Vimeo link,
     * validated by the slide type. A link replaces an attached mp4.
     *
     * @throws ValidationException 422 `video_url`
     */
    public function setSlideVideoUrl(Slide $slide, ?string $url): Slide
    {
        $type = $this->typeOf($slide);
        if (! $this->takesVideoUrl($type)) {
            DeckValidation::fail(['video_url' => 'This slide type does not take a video link.']);
        }

        $saved = DB::transaction(function () use ($slide, $type, $url) {
            $this->lockDeck($slide->deck_id);
            $locked = $this->lockSlide($slide);
            // The type's errors are keyed `video_url`, the request field.
            $changes = ['config' => $type->validateConfig(array_replace($locked->config ?? [], ['video_url' => $url]))];
            if ($changes['config']['video_url'] !== null) {
                $changes['media_file_id'] = null;
            }

            $locked->forceFill($changes)->save();
            $slide->deck?->touch();

            return $locked;
        });

        return $this->withRelations($saved, $slide);
    }

    /**
     * Records width/height for an image that has none (uploads from before
     * they were recorded), read from the stored bytes. Leaves them null when
     * the image cannot be read.
     */
    public function backfillDimensions(File $file): File
    {
        if (! $file->isImage() || ($file->width > 0 && $file->height > 0)) {
            return $file;
        }

        $size = $this->readImageSize($file);
        if ($size !== null) {
            $file->forceFill(['width' => $size[0], 'height' => $size[1]])->save();
        }

        return $file;
    }

    /** The actor's own, non-deleted My Files row, else 404. */
    public function ownedFile(User $actor, int $fileId): File
    {
        $file = File::query()->find($fileId);

        if (! $file || $file->is_deleted || Gate::forUser($actor)->denies('manage', $file)) {
            throw DeckException::notFound('File not found.');
        }

        return $file;
    }

    /**
     * File categories a slide type takes as media ([] = none), asked of the
     * type itself: withMedia() throws for a kind it does not take.
     *
     * @return list<string>
     */
    public function mediaCategories(?SlideTypeContract $type): array
    {
        if (! $type instanceof TakesMedia) {
            return [];
        }

        $categories = [];
        foreach (self::CATEGORY_PROBES as $category => $mime) {
            // Never saved: just enough of a File for withMedia() to snapshot.
            $probe = (new File())->forceFill(['mime_type' => $mime, 'category' => $category, 'visibility' => File::VISIBILITY_PUBLIC, 'path' => 'probe']);
            $probe->syncOriginal();

            try {
                $type->withMedia([], $probe);
                $categories[] = $category;
            } catch (ValidationException) {
                // Not this kind.
            }
        }

        return $categories;
    }

    /** Whether the slide type keeps a video link in config (the video slide). */
    public function takesVideoUrl(?SlideTypeContract $type): bool
    {
        return $type !== null && array_key_exists('video_url', $type->defaultConfig());
    }

    private function markUsed(?File $file): void
    {
        if ($file !== null) {
            $this->storage->markUsed($file);
        }
    }

    private function imageFile(User $actor, int $fileId): File
    {
        $file = $this->ownedFile($actor, $fileId);
        $this->assertKind($file, [File::CATEGORY_IMAGE]);

        return $this->backfillDimensions($file);
    }

    /** @param list<string> $categories */
    private function assertKind(File $file, array $categories): void
    {
        $mime = strtolower((string) $file->mime_type);
        $fits = in_array($file->category, $categories, true) && match ($file->category) {
            File::CATEGORY_IMAGE => in_array($mime, self::IMAGE_MIMES, true),
            File::CATEGORY_VIDEO => str_starts_with($mime, 'video/'),
            default => false,
        };

        if (! $fits) {
            DeckValidation::fail(['file_id' => $this->kindMessage($categories)]);
        }
    }

    /**
     * The slide type has the last word on the mime (withMedia()), and a type
     * that needs a usable image (pin_on_image) also needs its width/height.
     *
     * @param  list<string>  $categories
     */
    private function assertTypeTakes(SlideTypeContract $type, array $config, File $file, array $categories): void
    {
        try {
            $snapshot = $type->withMedia($config, $file);
        } catch (ValidationException) {
            DeckValidation::fail(['file_id' => $this->kindMessage($categories)]);
        }

        if (method_exists($type, 'requiresMedia') && $type->requiresMedia() && method_exists($type, 'assertMediaPresent')) {
            try {
                $type->assertMediaPresent($snapshot);
            } catch (ValidationException) {
                DeckValidation::fail(['file_id' => 'We could not read this image\'s width and height. Upload it to My Files again and attach the new copy.']);
            }
        }
    }

    /** @param list<string> $categories */
    private function kindMessage(array $categories): string
    {
        $image = in_array(File::CATEGORY_IMAGE, $categories, true);
        $video = in_array(File::CATEGORY_VIDEO, $categories, true);

        return match (true) {
            $image && $video => 'Choose an image (jpg, png, gif or webp) or an mp4 video from My Files.',
            $video => 'Choose an mp4 video from My Files.',
            default => 'Choose an image (jpg, png, gif or webp) from My Files.',
        };
    }

    private function typeOf(Slide $slide): ?SlideTypeContract
    {
        $key = (string) $slide->type;

        return $this->registry->has($key) ? $this->registry->for($key) : null;
    }

    /**
     * Locks the deck row until the transaction ends, before any slide or
     * option row. Deck authoring locks the deck first too
     * (SlidePositions::lock) and then writes the deck's slides and options,
     * so taking the same order here keeps a media attach and, say, a
     * reorder from deadlocking (40P01) when they overlap. The deck may be
     * soft-deleted, like SlidePositions::lock.
     */
    private function lockDeck(?int $deckId): void
    {
        if ($deckId !== null) {
            Deck::withTrashed()->whereKey($deckId)->lockForUpdate()->value('id');
        }
    }

    /** The slide row, re-read under a row lock (after the deck's) so a concurrent config edit is not overwritten. */
    private function lockSlide(Slide $slide): Slide
    {
        $locked = Slide::query()->whereKey($slide->getKey())->lockForUpdate()->first();

        if (! $locked) {
            throw DeckException::notFound('Slide not found.');
        }

        return $locked;
    }

    /** $saved with the relations the caller already had on $original (deck, options). */
    private function withRelations(Slide $saved, Slide $original): Slide
    {
        foreach (['deck', 'options'] as $relation) {
            if ($original->relationLoaded($relation)) {
                $saved->setRelation($relation, $original->getRelation($relation));
            }
        }

        return $saved;
    }

    /**
     * [width, height] as the browser shows the image (EXIF quarter turns
     * swap them, like ImageProcessor at upload), or null when unreadable.
     *
     * @return array{0:int, 1:int}|null
     */
    private function readImageSize(File $file): ?array
    {
        if (! $file->disk_path) {
            return null;
        }

        try {
            $disk = Storage::disk($file->disk ?: $this->storage->disk());

            $path = null;
            try {
                $path = $disk->path($file->disk_path);
            } catch (Throwable) {
                // Not a local disk.
            }

            if ($path !== null && is_file($path)) {
                $info = @getimagesize($path);
                $exif = fn () => @exif_read_data($path);
            } else {
                $stream = $disk->readStream($file->disk_path);
                if (! is_resource($stream)) {
                    return null;
                }
                $head = (string) stream_get_contents($stream, self::HEAD_BYTES);
                fclose($stream);

                $info = @getimagesizefromstring($head);
                $exif = function () use ($head) {
                    $memory = fopen('php://memory', 'r+b');
                    fwrite($memory, $head);
                    rewind($memory);

                    try {
                        return @exif_read_data($memory);
                    } finally {
                        fclose($memory);
                    }
                };
            }

            if ($info === false || ($info[0] ?? 0) <= 0 || ($info[1] ?? 0) <= 0) {
                return null;
            }

            [$width, $height] = [(int) $info[0], (int) $info[1]];
            if (($info[2] ?? null) === IMAGETYPE_JPEG && function_exists('exif_read_data')) {
                $data = $exif();
                $orientation = is_array($data) ? (int) ($data['Orientation'] ?? 1) : 1;
                if (in_array($orientation, self::TRANSPOSED_ORIENTATIONS, true)) {
                    [$width, $height] = [$height, $width];
                }
            }

            return [$width, $height];
        } catch (Throwable $e) {
            report($e);

            return null;
        }
    }
}
