import type { DeckProduct } from "./types";

// Words and routes that differ between the deck products, so the editor,
// presenter and library serve quizzes and quests with the same code.

export interface DeckProductCopy {
	product: DeckProduct;
	/** "quest" / "quiz" */
	noun: string;
	/** "Quest" / "Quiz" */
	Noun: string;
	/** "quests" / "quizzes" */
	plural: string;
	/** One line about the product, e.g. under a library heading. */
	tagline: string;
	/** My Library page of the product. */
	libraryHref: string;
	editHref(deckId: number | string): string;
	presentHref(deckId: number | string): string;
}

const COPY: Record<DeckProduct, DeckProductCopy> = {
	quest: {
		product: "quest",
		noun: "quest",
		Noun: "Quest",
		plural: "quests",
		tagline: "Slide-based polls, word clouds and Q&A with live results.",
		libraryHref: "/my-library/quest-page",
		editHref: (id) => `/quests/${encodeURIComponent(String(id))}/edit`,
		presentHref: (id) => `/quests/${encodeURIComponent(String(id))}/present`,
	},
	quiz: {
		product: "quiz",
		noun: "quiz",
		Noun: "Quiz",
		plural: "quizzes",
		tagline: "Live quizzes with scoring and a leaderboard.",
		libraryHref: "/my-library/quiz-page",
		editHref: (id) => `/quizzes/${encodeURIComponent(String(id))}/edit`,
		presentHref: (id) => `/quizzes/${encodeURIComponent(String(id))}/present`,
	},
};

export function productCopy(product: DeckProduct | null | undefined): DeckProductCopy {
	return COPY[product === "quiz" ? "quiz" : "quest"];
}
