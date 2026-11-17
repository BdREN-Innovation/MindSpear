"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "react-toastify";
import { toDeckApiError } from "@/features/deck/api/errors";
import { questSessionApi, type SessionApi } from "@/features/deck/api/sessionApi";
import type { AdvanceAction, AdvanceInput, HostSessionState } from "@/features/deck/types";

// Host transitions (POST advance / end). Rules that keep the room safe:
// - one request at a time: a second click, a held arrow key or a clicker
//   double-press while one is in flight is dropped, never queued;
// - never retried: a timeout may have succeeded server-side, so the state
//   endpoint (resync) decides what happened instead of a second advance;
// - 409 invalid_state means the run moved under us (timer, another tab):
//   resync and let the host decide again.

export type PendingAction = AdvanceAction | "end";

export type AdvanceOutcome = "ok" | "requires_force" | "failed" | "busy";

export interface HostControls {
	pending: PendingAction | null;
	advance: (input: AdvanceInput) => Promise<AdvanceOutcome>;
	end: () => Promise<boolean>;
}

interface Options {
	sessionId: number;
	/** The product's host API (sessionApiFor(product)); default Quest. */
	api?: SessionApi;
	/** Apply a fresh HOST STATE (the action's response). */
	onState: (state: HostSessionState) => void;
	resync: () => Promise<void>;
}

const TOAST_ID = "deck-presenter-action";

function notify(kind: "info" | "error", message: string) {
	if (toast.isActive(TOAST_ID)) toast.update(TOAST_ID, { render: message, type: kind });
	else toast[kind](message, { toastId: TOAST_ID });
}

export function useHostControls({ sessionId, api = questSessionApi, onState, resync }: Options): HostControls {
	const [pending, setPending] = useState<PendingAction | null>(null);
	// The ref guards synchronously (two key events can land before a re-render).
	const pendingRef = useRef<PendingAction | null>(null);
	const onStateRef = useRef(onState);
	onStateRef.current = onState;
	const resyncRef = useRef(resync);
	resyncRef.current = resync;

	const begin = (action: PendingAction): boolean => {
		if (pendingRef.current) return false;
		pendingRef.current = action;
		setPending(action);
		return true;
	};
	const finish = () => {
		pendingRef.current = null;
		setPending(null);
	};

	const advance = useCallback(
		async (input: AdvanceInput): Promise<AdvanceOutcome> => {
			if (!begin(input.action)) return "busy";
			try {
				onStateRef.current(await api.advance(sessionId, input));
				return "ok";
			} catch (reason) {
				const error = toDeckApiError(reason);
				if (error.data.requires_force && !input.force) return "requires_force";

				if (error.code === "invalid_state" || error.status === 409) {
					notify("info", "The slide changed in the meantime. Showing the latest state.");
				} else if (error.code === "network" || error.code === "timeout") {
					notify("error", "Couldn't reach the server. Checking where the session is…");
				} else {
					notify("error", error.message);
				}
				void resyncRef.current();
				return "failed";
			} finally {
				finish();
			}
		},
		[api, sessionId]
	);

	const end = useCallback(async (): Promise<boolean> => {
		if (!begin("end")) return false;
		try {
			onStateRef.current(await api.end(sessionId));
			return true;
		} catch (reason) {
			const error = toDeckApiError(reason);
			// 409: already ended (another tab) — the resync shows the summary.
			if (error.status !== 409) notify("error", error.message);
			void resyncRef.current();
			return false;
		} finally {
			finish();
		}
	}, [api, sessionId]);

	return { pending, advance, end };
}
