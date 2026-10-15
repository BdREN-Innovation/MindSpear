<?php

namespace App\Deck\Http\Controllers;

use App\Deck\Http\Requests\AttachMediaFileRequest;
use App\Deck\Http\Requests\AttachSlideMediaRequest;
use App\Deck\Http\Resources\DeckPresenter;
use App\Deck\Http\Resources\OptionPresenter;
use App\Deck\Http\Resources\SlidePresenter;
use App\Deck\Media\DeckMediaService;
use Illuminate\Http\JsonResponse;

/**
 * My Files media on a deck (plan §2.1, §2.3): cover, option image, slide
 * media / video link. Nothing is uploaded here; the editor uploads through
 * /api/v1/library/files and attaches the returned id.
 */
class DeckMediaController extends DeckController
{
    public function __construct(private readonly DeckMediaService $media) {}

    /** PUT {deck}/cover {file_id|null} → {deck: DeckPresenter::summary} */
    public function cover(AttachMediaFileRequest $request, string $deck): JsonResponse
    {
        $model = $this->ownedDeck($request, $deck);
        $model = $this->media->setCover($model, $request->user(), $request->fileId());

        return $this->okResponse(
            ['deck' => DeckPresenter::summary($model)],
            $model->cover_file_id ? 'Cover updated.' : 'Cover removed.',
        );
    }

    /** PUT {deck}/slides/{slide}/options/{option}/image {file_id|null} → {option: OptionPresenter::option} */
    public function optionImage(AttachMediaFileRequest $request, string $deck, string $slide, string $option): JsonResponse
    {
        $model = $this->ownedOption($this->ownedSlide($this->ownedDeck($request, $deck), $slide), $option);
        $model = $this->media->setOptionImage($model, $request->user(), $request->fileId());

        return $this->okResponse(
            ['option' => OptionPresenter::option($model)],
            $model->image_file_id ? 'Image attached.' : 'Image removed.',
        );
    }

    /** PUT {deck}/slides/{slide}/media {file_id|null} | {video_url|null} → {slide: SlidePresenter::slide} */
    public function slideMedia(AttachSlideMediaRequest $request, string $deck, string $slide): JsonResponse
    {
        $model = $this->ownedSlide($this->ownedDeck($request, $deck), $slide);

        $model = $request->setsVideoUrl()
            ? $this->media->setSlideVideoUrl($model, $request->videoUrl())
            : $this->media->setSlideFile($model, $request->user(), $request->fileId());

        return $this->okResponse(['slide' => SlidePresenter::slide($model)], 'Slide media updated.');
    }
}
