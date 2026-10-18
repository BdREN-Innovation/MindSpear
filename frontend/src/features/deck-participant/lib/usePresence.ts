"use client";

import { useEffect, useRef } from "react";
import { toDeckApiError } from "@/features/deck/api/errors";
import type { ParticipantApi } from "@/features/deck/api/participantApi";
import {
	loadParticipantSession,
	saveParticipantSession,
	setParticipantLeftPending,
	type StoredParticipantSession,
} from "@/features/deck/live/participantSession";
import type { DeckProduct } from "@/features/deck/types";

// Presence of a joined participant on the live screen (leave + same-device rejoin):
//
// - pagehide (reload, tab closed, navigating away): a best-effort leave that
//   outlives the page (sendBeacon / keepalive), so a phone that went away stops
//   counting in "x / y answered", no longer blocks the quiz's "everyone
//   answered" reveal and drops off the leaderboard. The stored session is
//   marked leftPending. Skipped while shouldStay() says the phone is mid-answer
//   on a quiz question: a reload there must not reveal the slide early for
//   everyone else (the timer still ends it if the phone never comes back).
// - the page comes back (a reload mounts again; a bfcache restore fires
//   pageshow with persisted) with leftPending: POST join with the stored token
//   brings back the SAME participant (left_at cleared, points kept). The
//   state is not re-read for it: nothing of this phone's view changed (the
//   room count arrives as participant.count.updated).
//
// "Leave session" itself calls api.leave() directly (PlayScreen).

interface Options {
	api: ParticipantApi;
	stored: StoredParticipantSession;
	/** false once the session ended / the token is gone: nothing to leave or rejoin. */
	enabled: boolean;
	/** true = don't send the pagehide leave right now (mid-answer on a quiz question). */
	shouldStay: () => boolean;
	/** The backend answered with a different participant (token not recognised): switch to it. */
	onReplaced: (next: StoredParticipantSession) => void;
}

type RejoinOutcome =
	| { kind: "none" }
	| { kind: "same" }
	| { kind: "replaced"; next: StoredParticipantSession }
	| { kind: "retry" };

const REJOIN_RETRY_MS = 3000;

/** One rejoin per session at a time (a remount, e.g. React's dev double effects, shares it). */
const inflightRejoins = new Map<string, Promise<RejoinOutcome>>();

function rejoinOnce(api: ParticipantApi, product: DeckProduct, sessionId: number): Promise<RejoinOutcome> {
	const key = `${product}:${sessionId}`;
	const running = inflightRejoins.get(key);
	if (running) return running;

	const run = (async (): Promise<RejoinOutcome> => {
		const current = loadParticipantSession(product, sessionId);
		if (!current?.leftPending) return { kind: "none" };
		if (!current.joinCode) {
			setParticipantLeftPending(product, sessionId, false);
			return { kind: "none" };
		}
		try {
			const result = await api.join(
				sessionId,
				{ join_code: current.joinCode, display_name: current.displayName, emoji_avatar: current.emojiAvatar },
				{ token: current.participantToken }
			);
			if (result.participant_token !== current.participantToken) {
				// Not the same participant (token unknown to the backend): carry on as the new one.
				return {
					kind: "replaced",
					next: saveParticipantSession(product, result, { joinCode: current.joinCode, deckTitle: current.deckTitle }),
				};
			}
			setParticipantLeftPending(product, sessionId, false);
			return { kind: "same" };
		} catch (reason) {
			const error = toDeckApiError(reason);
			if (error.code === "network" || error.code === "timeout" || error.status >= 500) return { kind: "retry" };
			// Ended / gone / refused: the state read decides where the screen goes.
			setParticipantLeftPending(product, sessionId, false);
			return { kind: "none" };
		}
	})().finally(() => inflightRejoins.delete(key));

	inflightRejoins.set(key, run);
	return run;
}

export function useParticipantPresence({ api, stored, enabled, shouldStay, onReplaced }: Options): void {
	const { product, sessionId } = stored;
	const enabledRef = useRef(enabled);
	enabledRef.current = enabled;
	const shouldStayRef = useRef(shouldStay);
	shouldStayRef.current = shouldStay;
	const onReplacedRef = useRef(onReplaced);
	onReplacedRef.current = onReplaced;

	useEffect(() => {
		let cancelled = false;
		let retryTimer: number | undefined;

		const rejoin = async (attempt: number) => {
			const outcome = await rejoinOnce(api, product, sessionId);
			if (cancelled) return;
			if (outcome.kind === "replaced") onReplacedRef.current(outcome.next);
			if (outcome.kind === "retry") {
				if (attempt < 2) retryTimer = window.setTimeout(() => void rejoin(attempt + 1), REJOIN_RETRY_MS * (attempt + 1));
				else setParticipantLeftPending(product, sessionId, false);
			}
		};

		// A reload (or a restore) of a page that said goodbye on its way out.
		void rejoin(0);

		const onPageHide = () => {
			if (!enabledRef.current || shouldStayRef.current()) return;
			const current = loadParticipantSession(product, sessionId);
			if (!current) return;
			if (api.leaveOnPageHide(sessionId, current.participantToken)) {
				setParticipantLeftPending(product, sessionId, true);
			}
		};
		const onPageShow = (event: PageTransitionEvent) => {
			if (event.persisted) void rejoin(0);
		};
		window.addEventListener("pagehide", onPageHide);
		window.addEventListener("pageshow", onPageShow);
		return () => {
			cancelled = true;
			window.clearTimeout(retryTimer);
			window.removeEventListener("pagehide", onPageHide);
			window.removeEventListener("pageshow", onPageShow);
		};
	}, [api, product, sessionId]);
}
