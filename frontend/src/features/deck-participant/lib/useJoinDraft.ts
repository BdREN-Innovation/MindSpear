"use client";

import { useCallback, useEffect, useState } from "react";
import { questParticipantApi } from "@/features/deck/api/participantApi";
import { toDeckApiError } from "@/features/deck/api/errors";
import {
	findParticipantSessionByChannel,
	loadJoinDraft,
	saveJoinDraft,
	type JoinDraft,
	type StoredParticipantSession,
} from "@/features/deck/live/participantSession";
import { friendlyError } from "./errors";
import { isV2JoinCode, PARTICIPANT_PRODUCT, sanitizeJoinCode } from "./joinCode";

// The join draft for /play/[code] and /play/[code]/avatar: the stored one
// from /play, or a fresh by-code lookup when the page was opened directly
// (QR code, shared link, refresh after the tab lost it).

export type JoinDraftStatus = "loading" | "ready" | "invalid" | "error";

export interface JoinDraftResult {
	status: JoinDraftStatus;
	code: string;
	draft: JoinDraft | null;
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
	const valid = isV2JoinCode(rawCode);
	const [draft, setDraft] = useState<JoinDraft | null>(null);
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
		const stored = attempt === 0 ? loadJoinDraft(PARTICIPANT_PRODUCT, code) : null;
		if (stored) {
			setDraft(stored);
			setExisting(findParticipantSessionByChannel(PARTICIPANT_PRODUCT, stored.publicChannelKey));
			setStatus("ready");
			return;
		}

		const controller = new AbortController();
		setStatus("loading");
		setError(null);
		setNotLive(false);
		questParticipantApi
			.lookupByCode(code, controller.signal)
			.then((session) => {
				const previous = loadJoinDraft(PARTICIPANT_PRODUCT, code);
				const next: JoinDraft = {
					...previous,
					sessionId: session.session_id,
					joinCode: session.join_code || code,
					deckTitle: session.deck_title,
					publicChannelKey: session.public_channel_key,
				};
				saveJoinDraft(PARTICIPANT_PRODUCT, next);
				setDraft(next);
				setExisting(findParticipantSessionByChannel(PARTICIPANT_PRODUCT, session.public_channel_key));
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

	const update = useCallback(
		(patch: Partial<JoinDraft>) => {
			setDraft((current) => {
				if (!current) return current;
				const next = { ...current, ...patch };
				saveJoinDraft(PARTICIPANT_PRODUCT, next);
				return next;
			});
		},
		[]
	);

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
