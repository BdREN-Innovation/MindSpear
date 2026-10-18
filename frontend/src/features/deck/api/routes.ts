import type { DeckProduct } from "../types";

// URL prefixes under /api/v1 per product, mirroring backend config('deck.routes').
// Quiz v2 sessions live under /quiz-sessions/v2: legacy Quiz v1 still owns
// /quiz-sessions/{id}/state (numeric ids of both tables overlap). Authoring is
// /quizzes (legacy is /quizes).
export const DECK_ROUTES: Record<DeckProduct, { authoring: string; sessions: string }> = {
	quest: { authoring: "/quests/v2", sessions: "/quest-sessions/v2" },
	quiz: { authoring: "/quizzes", sessions: "/quiz-sessions/v2" },
};

/** Every product with v2 deck routes, in the order a product-agnostic join-code lookup tries them. */
export const DECK_PRODUCTS: readonly DeckProduct[] = ["quest", "quiz"];

export function authoringBase(product: DeckProduct): string {
	return DECK_ROUTES[product].authoring;
}

export function sessionsBase(product: DeckProduct): string {
	return DECK_ROUTES[product].sessions;
}

/** Realtime channel names (backend DeckChannels). */
export function publicChannelName(product: DeckProduct, publicChannelKey: string): string {
	return `session.${product}.${publicChannelKey}`;
}

/** Private host channel without the `private-` prefix (Echo adds it). */
export function hostChannelName(product: DeckProduct, sessionId: number | string): string {
	return `host.${product}.v2.${sessionId}`;
}

/** Longer timeouts for requests that do real work server-side. */
export const DECK_TIMEOUTS = {
	default: 15_000,
	/** Session start snapshots every slide. */
	sessionStart: 45_000,
	/** Bulk insert of up to 50 slides (AI generate). */
	bulk: 60_000,
	duplicate: 45_000,
	/** Participant answer: the phone may be on a weak network; retries are safe (one row per participant). */
	answer: 20_000,
	review: 30_000,
} as const;
