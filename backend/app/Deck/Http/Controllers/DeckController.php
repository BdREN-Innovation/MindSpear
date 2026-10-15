<?php

namespace App\Deck\Http\Controllers;

use App\Deck\Exceptions\DeckException;
use App\Deck\Http\DeckRoutes;
use App\Deck\Http\DeckValidation;
use App\Deck\Http\Middleware\ResolveDeckParticipant;
use App\Http\Controllers\api\v1\ApiBaseController;
use App\Models\Deck\Deck;
use App\Models\Deck\DeckParticipant;
use App\Models\Deck\DeckSession;
use App\Models\Deck\DeckSessionSlideRun;
use App\Models\Deck\Slide;
use App\Models\Deck\SlideOption;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Lookups shared by every deck controller (authoring and live, any product).
 * Anything that is missing, someone else's, another product's or
 * soft-deleted is a 404 (DeckException::notFound), never a 403.
 *
 * $product defaults to the route's product (DeckRoutes::product()).
 */
abstract class DeckController extends ApiBaseController
{
    /** 'quest' | 'quiz', from the route's `product` default. */
    protected function product(Request $request): string
    {
        return DeckRoutes::product($request);
    }

    /** A non-deleted deck of $product owned by the signed-in user. */
    protected function ownedDeck(Request $request, int|string $deckId, ?string $product = null): Deck
    {
        $product ??= $this->product($request);
        $id = DeckRoutes::id($deckId);

        $deck = $id === null ? null : Deck::query()->forProduct($product)->find($id);

        if (! $deck || ! $request->user() || Gate::forUser($request->user())->denies('manage', $deck)) {
            throw DeckException::notFound('Deck not found.');
        }

        return $deck;
    }

    /** A non-deleted slide of $deck (its `deck` relation set). */
    protected function ownedSlide(Deck $deck, int|string $slideId): Slide
    {
        $id = DeckRoutes::id($slideId);
        $slide = $id === null ? null : $deck->slides()->whereKey($id)->first();

        if (! $slide) {
            throw DeckException::notFound('Slide not found.');
        }

        return $slide->setRelation('deck', $deck);
    }

    /** An option of $slide (its `slide` relation set). */
    protected function ownedOption(Slide $slide, int|string $optionId): SlideOption
    {
        $id = DeckRoutes::id($optionId);
        $option = $id === null ? null : $slide->options()->whereKey($id)->first();

        if (! $option) {
            throw DeckException::notFound('Option not found.');
        }

        return $option->setRelation('slide', $slide);
    }

    /** A session of a $product deck hosted by the signed-in user (`deck` loaded, soft-deleted decks included). */
    protected function ownedSession(Request $request, int|string $sessionId, ?string $product = null): DeckSession
    {
        $product ??= $this->product($request);
        $id = DeckRoutes::id($sessionId);

        $session = $id === null ? null : DeckSession::with('deck')->find($id);

        if (
            ! $session
            || ! $session->deck
            || $session->deck->product !== $product
            || ! $request->user()
            || Gate::forUser($request->user())->denies('manage', $session)
        ) {
            throw DeckException::notFound('Session not found.');
        }

        return $session;
    }

    /** A slide run of $session (its `session` relation set). */
    protected function sessionRun(DeckSession $session, int|string $runId): DeckSessionSlideRun
    {
        $id = DeckRoutes::id($runId);
        $run = $id === null ? null : $session->runs()->whereKey($id)->first();

        if (! $run) {
            throw DeckException::notFound('Slide not found in this session.');
        }

        return $run->setRelation('session', $session);
    }

    /** The participant of a `deck.participant` route. */
    protected function participant(Request $request): DeckParticipant
    {
        return ResolveDeckParticipant::participant($request);
    }

    /** The session of a `deck.participant` route. */
    protected function participantSession(Request $request): DeckSession
    {
        return ResolveDeckParticipant::session($request);
    }

    /** Runs $callback; slide-type ValidationExceptions come back keyed "{$prefix}.{key}" (e.g. config.option_ids). */
    protected function prefixErrors(string $prefix, Closure $callback): mixed
    {
        return DeckValidation::prefixed($prefix, $callback);
    }
}
