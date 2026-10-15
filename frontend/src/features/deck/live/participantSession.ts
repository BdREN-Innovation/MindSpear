"use client";

import { useEffect, useState } from "react";
import type { DeckProduct, JoinSessionResult } from "../types";

// Participant identity + token for a joined session. sessionStorage (per tab,
// survives refresh, gone when the tab closes) keyed by product + session id,
// with an index by public channel key because the live route is
// /play/live/[publicChannelKey]. The token stays after the session ends: the
// review screen reads with the token the end revoked.
//
// Two small extras:
// - a join draft (name picked on /play/[code] before the emoji step), keyed by code;
// - a remembered identity in localStorage to prefill name + emoji next time.

const PREFIX = "mindspear:deck";

export interface StoredParticipantSession {
	product: DeckProduct;
	sessionId: number;
	participantId: number;
	participantToken: string;
	publicChannelKey: string;
	joinCode: string | null;
	displayName: string;
	emojiAvatar: string;
	deckTitle: string | null;
	/** ISO time the participant joined (client clock). */
	joinedAt: string;
}

export interface JoinDraft {
	sessionId: number;
	joinCode: string;
	deckTitle: string | null;
	publicChannelKey: string;
	displayName?: string;
	emojiAvatar?: string;
}

export interface RememberedIdentity {
	displayName: string;
	emojiAvatar: string | null;
}

const sessionKey = (product: DeckProduct, sessionId: number | string) => `${PREFIX}:${product}:session:${sessionId}`;
const channelKey = (product: DeckProduct, publicChannelKey: string) => `${PREFIX}:${product}:channel:${publicChannelKey}`;
const draftKey = (product: DeckProduct, code: string) => `${PREFIX}:${product}:join-draft:${normaliseJoinCode(code)}`;
const identityKey = `${PREFIX}:identity`;

/** Upper case, spaces and dashes removed (the backend's by-code normalisation). */
export function normaliseJoinCode(code: string): string {
	return code.replace(/[\s-]+/g, "").toUpperCase();
}

function storage(kind: "session" | "local"): Storage | null {
	if (typeof window === "undefined") return null;
	try {
		return kind === "session" ? window.sessionStorage : window.localStorage;
	} catch {
		return null;
	}
}

function readJson<T>(store: Storage | null, key: string): T | null {
	if (!store) return null;
	try {
		const raw = store.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

function writeJson(store: Storage | null, key: string, value: unknown): void {
	if (!store) return;
	try {
		store.setItem(key, JSON.stringify(value));
	} catch {
		// Storage full / disabled: the session still works until refresh.
	}
}

/** Store the join response (call right after POST .../participants/join). */
export function saveParticipantSession(
	product: DeckProduct,
	join: JoinSessionResult,
	extra: { joinCode?: string | null; deckTitle?: string | null } = {}
): StoredParticipantSession {
	const stored: StoredParticipantSession = {
		product,
		sessionId: join.session_id,
		participantId: join.participant_id,
		participantToken: join.participant_token,
		publicChannelKey: join.public_channel_key,
		joinCode: extra.joinCode ? normaliseJoinCode(extra.joinCode) : null,
		displayName: join.display_name,
		emojiAvatar: join.emoji_avatar,
		deckTitle: extra.deckTitle ?? null,
		joinedAt: new Date().toISOString(),
	};
	const store = storage("session");
	writeJson(store, sessionKey(product, join.session_id), stored);
	store?.setItem(channelKey(product, join.public_channel_key), String(join.session_id));
	return stored;
}

export function loadParticipantSession(
	product: DeckProduct,
	sessionId: number | string
): StoredParticipantSession | null {
	const stored = readJson<StoredParticipantSession>(storage("session"), sessionKey(product, sessionId));
	return stored && typeof stored.participantToken === "string" ? stored : null;
}

/** Look up the stored session for a /play/live/[publicChannelKey] route. */
export function findParticipantSessionByChannel(
	product: DeckProduct,
	publicChannelKey: string
): StoredParticipantSession | null {
	const store = storage("session");
	const sessionId = store?.getItem(channelKey(product, publicChannelKey));
	return sessionId ? loadParticipantSession(product, sessionId) : null;
}

export function clearParticipantSession(product: DeckProduct, sessionId: number | string): void {
	const store = storage("session");
	const stored = loadParticipantSession(product, sessionId);
	store?.removeItem(sessionKey(product, sessionId));
	if (stored) store?.removeItem(channelKey(product, stored.publicChannelKey));
}

export function saveJoinDraft(product: DeckProduct, draft: JoinDraft): void {
	writeJson(storage("session"), draftKey(product, draft.joinCode), { ...draft, joinCode: normaliseJoinCode(draft.joinCode) });
}

export function loadJoinDraft(product: DeckProduct, code: string): JoinDraft | null {
	return readJson<JoinDraft>(storage("session"), draftKey(product, code));
}

export function clearJoinDraft(product: DeckProduct, code: string): void {
	storage("session")?.removeItem(draftKey(product, code));
}

export function loadRememberedIdentity(): RememberedIdentity | null {
	return readJson<RememberedIdentity>(storage("local"), identityKey);
}

export function saveRememberedIdentity(identity: RememberedIdentity): void {
	writeJson(storage("local"), identityKey, identity);
}

/**
 * The stored session for a live route, read after mount (storage is browser
 * only, so the first render is `undefined` = "not read yet"; null = none).
 */
export function useParticipantSession(
	product: DeckProduct,
	publicChannelKey: string | null | undefined
): StoredParticipantSession | null | undefined {
	const [stored, setStored] = useState<StoredParticipantSession | null | undefined>(undefined);

	useEffect(() => {
		setStored(publicChannelKey ? findParticipantSessionByChannel(product, publicChannelKey) : null);
	}, [product, publicChannelKey]);

	return stored;
}
