<?php

namespace App\Deck\Http\Controllers\Authoring;

use App\Deck\Authoring\SlideAuthoringService;
use App\Deck\Authoring\SlidePositions;
use App\Deck\Http\Controllers\DeckController;
use App\Deck\Http\Requests\Authoring\BulkSlidesRequest;
use App\Deck\Http\Requests\Authoring\ReorderSlidesRequest;
use App\Deck\Http\Requests\Authoring\StoreSlideRequest;
use App\Deck\Http\Requests\Authoring\UpdateSlideRequest;
use App\Deck\Http\Resources\SlidePresenter;
use App\Models\Deck\Deck;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Slides of a deck. Responses that move positions also return `order`:
 * [{id, position}] for every live slide, in order.
 */
class SlideAuthoringController extends DeckController
{
    public function __construct(private readonly SlideAuthoringService $slides) {}

    /** POST /{deck}/slides {type, after_position?} → 201 {slide, order}. */
    public function store(StoreSlideRequest $request, string $deck): JsonResponse
    {
        $model = $this->ownedDeck($request, $deck);
        $data = $request->validated();
        $slide = $this->slides->append($model, $data['type'], isset($data['after_position']) ? (int) $data['after_position'] : null);

        return $this->createdResponse(['slide' => SlidePresenter::slide($slide), 'order' => $this->order($model)], 'Slide added.');
    }

    /** GET /{deck}/slides/{slide} → {slide}. */
    public function show(Request $request, string $deck, string $slide): JsonResponse
    {
        return $this->okResponse(['slide' => SlidePresenter::slide($this->ownedSlide($this->ownedDeck($request, $deck), $slide))]);
    }

    /** PATCH /{deck}/slides/{slide} → {slide}. */
    public function update(UpdateSlideRequest $request, string $deck, string $slide): JsonResponse
    {
        $model = $this->slides->update($this->ownedSlide($this->ownedDeck($request, $deck), $slide), $request->changes());

        return $this->okResponse(['slide' => SlidePresenter::slide($model)], 'Slide updated.');
    }

    /** DELETE /{deck}/slides/{slide} → {order}. */
    public function destroy(Request $request, string $deck, string $slide): JsonResponse
    {
        $model = $this->ownedDeck($request, $deck);
        $this->slides->delete($this->ownedSlide($model, $slide));

        return $this->okResponse(['order' => $this->order($model)], 'Slide deleted.');
    }

    /** POST /{deck}/slides/{slide}/duplicate → 201 {slide, order}. */
    public function duplicate(Request $request, string $deck, string $slide): JsonResponse
    {
        $model = $this->ownedDeck($request, $deck);
        $copy = $this->slides->duplicate($this->ownedSlide($model, $slide));

        return $this->createdResponse(['slide' => SlidePresenter::slide($copy), 'order' => $this->order($model)], 'Slide duplicated.');
    }

    /** POST /{deck}/slides/reorder [{id, position}] → {order}. */
    public function reorder(ReorderSlidesRequest $request, string $deck): JsonResponse
    {
        $order = $this->slides->reorder($this->ownedDeck($request, $deck), $request->validated()['slides']);

        return $this->okResponse(['order' => $order], 'Order saved.');
    }

    /** POST /{deck}/slides/bulk → 201 {slides: [slide], order}. */
    public function bulk(BulkSlidesRequest $request, string $deck): JsonResponse
    {
        $model = $this->ownedDeck($request, $deck);
        $created = $this->slides->bulk($model, $request->slides(), $request->afterPosition());

        return $this->createdResponse(['slides' => SlidePresenter::collection($created), 'order' => $this->order($model)], 'Slides added.');
    }

    private function order(Deck $deck): array
    {
        return SlidePositions::order($deck->id);
    }
}
