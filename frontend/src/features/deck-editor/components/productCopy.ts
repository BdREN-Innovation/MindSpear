import type { DeckProduct } from "@/features/deck/types";

// Words and routes that differ between the v2 deck products, so the editor
// and presenter shells serve Quest and Quiz with the same code.

export interface DeckProductCopy {
	product: DeckProduct;
	/** "quest" / "quiz" */
	noun: string;
	/** "Quest" / "Quiz" */
	Noun: string;
	/** "quests" / "quizzes" */
	plural: string;
	/** Rollout name in messages: "Quest v2" / "Quiz v2". */
	v2: string;
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
		v2: "Quest v2",
		libraryHref: "/my-library/quest-page",
		editHref: (id) => `/quests/${encodeURIComponent(String(id))}/edit`,
		presentHref: (id) => `/quests/${encodeURIComponent(String(id))}/present`,
	},
	quiz: {
		product: "quiz",
		noun: "quiz",
		Noun: "Quiz",
		plural: "quizzes",
		v2: "Quiz v2",
		libraryHref: "/my-library/quiz-page",
		editHref: (id) => `/quizzes/${encodeURIComponent(String(id))}/edit`,
		presentHref: (id) => `/quizzes/${encodeURIComponent(String(id))}/present`,
	},
};

export function productCopy(product: DeckProduct | null | undefined): DeckProductCopy {
	return COPY[product === "quiz" ? "quiz" : "quest"];
}
