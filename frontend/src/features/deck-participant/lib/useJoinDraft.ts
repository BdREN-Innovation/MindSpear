"use client";

import { useCallback, useEffect, useState } from "react";
import { lookupSessionByCode } from "@/features/deck/api/participantApi";
import { toDeckApiError } from "@/features/deck/api/errors";
import {
	findParticipantSessionByChannel,
	loadJoinDraft,
	loadJoinDraftAny,
	saveJoinDraft,
	type JoinDraft,
	type StoredParticipantSession,
} from "@/features/deck/live/participantSession";
import type { DeckProduct } from "@/features/deck/types";
import { friendlyError } from "./errors";
import { isCompleteJoinCode, sanitizeJoinCode } from "./joinCode";

// The join draft for /play/[code] and /play/[code]/avatar: the stored one
// from /play (or /join), or a fresh by-code lookup when the page was opened
// directly (QR code, shared link, refresh after the tab lost it).
//
// The route does not name the product: the stored draft says which one found
// the code, else the product-neutral lookup (GET /play/by-code/{code}) does.
// The draft keeps it, so the join and the stored session use that product's
// API (participantApiFor) and channel from here on.

export type JoinDraftStatus = "loading" | "ready" | "invalid" | "error";

/** A join draft whose product is known. */
export type ResolvedJoinDraft = JoinDraft & { product: DeckProduct };

export interface JoinDraftResult {
	status: JoinDraftStatus;
	code: string;
	draft: ResolvedJoinDraft | null;
	/** A session this tab already joined with the same channel (offer "continue"). */
	existing: StoredParticipantSession | null;
	error: string | null;
	/** The lookup said 404: the session is not live (ended / never started / wrong code). */
	notLive: boolean;
	retry: () => void;
	/** Merge fields into the stored draft. */
	update: (patch: Partial<JoinDraft>) => void;
}

export function useJoinDraft(rawCode: string): JoinDraftResult {
	const code = sanitizeJoinCode(rawCode).code;
	const valid = isCompleteJoinCode(rawCode);
	const [draft, setDraft] = useState<ResolvedJoinDraft | null>(null);
	const [existing, setExisting] = useState<StoredParticipantSession | null>(null);
	const [status, setStatus] = useState<JoinDraftStatus>(valid ? "loading" : "invalid");
	const [error, setError] = useState<string | null>(null);
	const [notLive, setNotLive] = useState(false);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		if (!valid) {
			setStatus("invalid");
			return;
		}
		const stored = attempt === 0 ? loadJoinDraftAny(code) : null;
		if (stored) {
			setDraft(stored);
			setExisting(findParticipantSessionByChannel(stored.product, stored.publicChannelKey));
			setStatus("ready");
			return;
		}

		const controller = new AbortController();
		setStatus("loading");
		setError(null);
		setNotLive(false);
		lookupSessionByCode(code, { signal: controller.signal })
			.then((session) => {
				const { product } = session;
				const previous = loadJoinDraft(product, code);
				const next: ResolvedJoinDraft = {
					...previous,
					product,
					sessionId: session.session_id,
					joinCode: session.join_code || code,
					deckTitle: session.deck_title,
					publicChannelKey: session.public_channel_key,
				};
				saveJoinDraft(product, next);
				setDraft(next);
				setExisting(findParticipantSessionByChannel(product, session.public_channel_key));
				setStatus("ready");
			})
			.catch((reason: unknown) => {
				const deckError = toDeckApiError(reason);
				if (deckError.code === "cancelled") return;
				setNotLive(deckError.status === 404);
				setError(friendlyError(deckError, "lookup"));
				setStatus("error");
			});
		return () => controller.abort();
	}, [code, valid, attempt]);

	const update = useCallback((patch: Partial<JoinDraft>) => {
		setDraft((current) => {
			if (!current) return current;
			// The product is the lookup's answer, never a patch.
			const next: ResolvedJoinDraft = { ...current, ...patch, product: current.product };
			saveJoinDraft(next.product, next);
			return next;
		});
	}, []);

	return {
		status,
		code,
		draft,
		existing,
		error,
		notLive,
		retry: () => setAttempt((n) => n + 1),
		update,
	};
}
