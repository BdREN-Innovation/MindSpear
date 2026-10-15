"use client";

import { DeckApiError } from "@/features/deck/api/errors";
import { usePresenterSession } from "./hooks/usePresenterSession";
import { LivePresenter } from "./components/LivePresenter";
import { StartErrorScreen, StartingScreen } from "./components/StartErrorScreen";

// Quest v2 presenter (host) mode, plan Phase 6. Route:
// app/(protected)/quests/[id]/present — rendered full-screen by the
// protected layout (no app header / sidebar).
//   starting → start or resume the deck's live session
//   error    → why it can't start (flag off, slide needs an image, …)
//   live     → LivePresenter (keyed by session, so "Present again" is a clean slate)

export interface PresenterShellProps {
	deckId: number;
}

export function PresenterShell({ deckId }: PresenterShellProps) {
	const { result, deck, retry, restart } = usePresenterSession(deckId);

	if (!Number.isInteger(deckId) || deckId <= 0) {
		return (
			<StartErrorScreen
				deckId={deckId}
				deck={null}
				error={new DeckApiError("Quest not found.", "not_found", 404)}
				onRetry={retry}
			/>
		);
	}

	if (result.status === "starting") return <StartingScreen title={deck?.title} />;

	if (result.status === "error") {
		return <StartErrorScreen deckId={deckId} deck={deck} error={result.error} onRetry={retry} />;
	}

	return (
		<LivePresenter
			key={result.state.session_id}
			deckId={deckId}
			deck={deck}
			initialState={result.state}
			resumed={result.resumed}
			onPresentAgain={restart}
		/>
	);
}
