"use client";

import { DeckApiError } from "@/features/deck/api/errors";
import type { DeckProduct } from "@/features/deck/types";
import { productCopy } from "@/features/deck/productCopy";
import { usePresenterSession } from "./hooks/usePresenterSession";
import { LivePresenter } from "./components/LivePresenter";
import { StartErrorScreen, StartingScreen } from "./components/StartErrorScreen";

// Presenter (host) mode, Quest plan Phase 6. Routes:
// app/(protected)/quests/[id]/present and app/(protected)/quizzes/[id]/present
// — rendered full-screen by the protected layout (no app header / sidebar).
// The product picks the API (/quest-sessions or /quiz-sessions), the
// channels and the quiz controls (Start → Reveal → Next, spin, leaderboard).
//   starting → start or resume the deck's live session
//   error    → why it can't start (flag off, slide needs an image, …)
//   live     → LivePresenter (keyed by session, so "Present again" is a clean slate)

export interface PresenterShellProps {
	deckId: number;
	/** Default quest. */
	product?: DeckProduct;
}

export function PresenterShell({ deckId, product = "quest" }: PresenterShellProps) {
	const { result, deck, retry, restart } = usePresenterSession(deckId, product);

	if (!Number.isInteger(deckId) || deckId <= 0) {
		return (
			<StartErrorScreen
				deckId={deckId}
				product={product}
				deck={null}
				error={new DeckApiError(`${productCopy(product).Noun} not found.`, "not_found", 404)}
				onRetry={retry}
			/>
		);
	}

	if (result.status === "starting") return <StartingScreen title={deck?.title} />;

	if (result.status === "error") {
		return <StartErrorScreen deckId={deckId} product={product} deck={deck} error={result.error} onRetry={retry} />;
	}

	return (
		<LivePresenter
			key={result.state.session_id}
			deckId={deckId}
			product={product}
			deck={deck}
			initialState={result.state}
			resumed={result.resumed}
			onPresentAgain={restart}
		/>
	);
}
