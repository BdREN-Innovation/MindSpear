"use client";

import { useCallback, useEffect, useState } from "react";
import { questAuthoringApi } from "@/features/deck/api/authoringApi";
import { toDeckApiError, type DeckApiError } from "@/features/deck/api/errors";
import { questSessionApi } from "@/features/deck/api/sessionApi";
import type { Deck, HostSessionState } from "@/features/deck/types";

// Mount sequence (plan §6.1): POST /quests/v2/{deck}/sessions. One live
// session per deck: when one already exists the backend answers 409 conflict
// with data.session_id, and the presenter resumes it (GET state) instead of
// failing — so a reload, a second tab or a crashed laptop picks up where the
// room is. The deck itself is read alongside for its theme / QR setting.
// The session id is also remembered per deck in sessionStorage, so a reload
// resumes with one GET instead of a POST that is expected to fail.

export type PresenterSessionResult =
	| { status: "starting" }
	| { status: "ready"; state: HostSessionState; resumed: boolean }
	| { status: "error"; error: DeckApiError };

interface Outcome {
	result: Exclude<PresenterSessionResult, { status: "starting" }>;
	deck: Deck | null;
}

const storageKey = (deckId: number) => `deck-presenter:quest:${deckId}`;

function rememberedSessionId(deckId: number): number | null {
	try {
		const id = Number(window.sessionStorage.getItem(storageKey(deckId)));
		return Number.isInteger(id) && id > 0 ? id : null;
	} catch {
		return null;
	}
}

function rememberSession(deckId: number, sessionId: number | null): void {
	try {
		if (sessionId) window.sessionStorage.setItem(storageKey(deckId), String(sessionId));
		else window.sessionStorage.removeItem(storageKey(deckId));
	} catch {
		// Storage blocked: resuming falls back to the 409 path.
	}
}

/** The remembered session when it is still live (anything else: start normally). */
async function resumeRemembered(deckId: number): Promise<HostSessionState | null> {
	const id = rememberedSessionId(deckId);
	if (!id) return null;
	try {
		const state = await questSessionApi.getState(id);
		if (state.session.status === "live" && state.session.deck_id === deckId) return state;
	} catch {
		// Gone / not ours: forget it below.
	}
	rememberSession(deckId, null);
	return null;
}

async function startOrResume(deckId: number): Promise<Outcome> {
	// Theme and settings only: a failure here must not block presenting.
	const deckPromise = questAuthoringApi.getDeck(deckId).catch(() => null);

	try {
		let state = await resumeRemembered(deckId);
		let resumed = state !== null;
		if (!state) {
			try {
				state = await questSessionApi.startSession(deckId);
			} catch (reason) {
				const error = toDeckApiError(reason);
				const liveId = error.status === 409 ? Number(error.data.session_id) : NaN;
				if (!Number.isInteger(liveId) || liveId <= 0) throw error;
				state = await questSessionApi.getState(liveId);
				resumed = true;
			}
		}
		rememberSession(deckId, state.session_id);
		return { result: { status: "ready", state, resumed }, deck: await deckPromise };
	} catch (reason) {
		return { result: { status: "error", error: toDeckApiError(reason) }, deck: await deckPromise };
	}
}

// One start per deck while it is in flight, shared by every mount: StrictMode
// and the protected layout's auth/rehydrate pass mount the page twice in
// dev, and a second POST would 409 and resume at the cost of a round trip.
const inflightStarts = new Map<string, Promise<Outcome>>();

function startOnce(deckId: number, attempt: number): Promise<Outcome> {
	const key = `${deckId}:${attempt}`;
	let promise = inflightStarts.get(key);
	if (!promise) {
		promise = startOrResume(deckId).finally(() => inflightStarts.delete(key));
		inflightStarts.set(key, promise);
	}
	return promise;
}

export interface PresenterSession {
	result: PresenterSessionResult;
	deck: Deck | null;
	/** Try the start again (after a network error). */
	retry: () => void;
	/** Start a fresh session (after the last one ended). */
	restart: () => void;
}

export function usePresenterSession(deckId: number): PresenterSession {
	const [result, setResult] = useState<PresenterSessionResult>({ status: "starting" });
	const [deck, setDeck] = useState<Deck | null>(null);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		if (!Number.isInteger(deckId) || deckId <= 0) return;

		let cancelled = false;
		void startOnce(deckId, attempt).then((outcome) => {
			if (cancelled) return;
			setDeck((current) => outcome.deck ?? current);
			setResult(outcome.result);
		});
		return () => {
			cancelled = true;
		};
	}, [deckId, attempt]);

	const again = useCallback(() => {
		setResult({ status: "starting" });
		setAttempt((n) => n + 1);
	}, []);

	return { result, deck, retry: again, restart: again };
}
