<?php

namespace App\Deck\Http\Controllers\Authoring;

use App\Deck\Authoring\SlideOptionService;
use App\Deck\Http\Controllers\DeckController;
use App\Deck\Http\Requests\Authoring\OptionRequest;
use App\Deck\Http\Requests\Authoring\ReorderOptionsRequest;
use App\Deck\Http\Resources\OptionPresenter;
use App\Deck\Http\Resources\SlidePresenter;
use App\Models\Deck\Slide;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Options of a slide; every response carries the slide with its options in order. */
class SlideOptionController extends DeckController
{
    public function __construct(private readonly SlideOptionService $options) {}

    /** POST /{deck}/slides/{slide}/options {label?, payload?} → 201 {option, slide}. */
    public function store(OptionRequest $request, string $deck, string $slide): JsonResponse
    {
        $model = $this->ownedSlide($this->ownedDeck($request, $deck), $slide);
        $option = $this->options->add($model, $request->validated());

        return $this->createdResponse(['option' => OptionPresenter::option($option), 'slide' => $this->slide($model)], 'Option added.');
    }

    /** PATCH /{deck}/slides/{slide}/options/{option} {label?, payload?} → {option, slide}. */
    public function update(OptionRequest $request, string $deck, string $slide, string $option): JsonResponse
    {
        $model = $this->ownedSlide($this->ownedDeck($request, $deck), $slide);
        $updated = $this->options->update($this->ownedOption($model, $option), $request->validated());

        return $this->okResponse(['option' => OptionPresenter::option($updated), 'slide' => $this->slide($model)], 'Option updated.');
    }

    /** DELETE /{deck}/slides/{slide}/options/{option} → {slide}. */
    public function destroy(Request $request, string $deck, string $slide, string $option): JsonResponse
    {
        $model = $this->ownedSlide($this->ownedDeck($request, $deck), $slide);
        $this->options->delete($this->ownedOption($model, $option));

        return $this->okResponse(['slide' => $this->slide($model)], 'Option deleted.');
    }

    /**
     * POST /{deck}/slides/{slide}/options/reorder [{id, position}] (positions
     * 1..n, every option once) → {slide}, options in the new order.
     */
    public function reorder(ReorderOptionsRequest $request, string $deck, string $slide): JsonResponse
    {
        $model = $this->ownedSlide($this->ownedDeck($request, $deck), $slide);
        $this->options->reorder($model, $request->items());

        return $this->okResponse(['slide' => $this->slide($model)], 'Options reordered.');
    }

    private function slide(Slide $slide): array
    {
        return SlidePresenter::slide($slide->unsetRelation('options'));
    }
}
