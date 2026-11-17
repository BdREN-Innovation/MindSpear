"use client";

import { useEffect, useState } from "react";
import { DECK_PRODUCTS } from "../api/routes";
import type { DeckProduct, JoinSessionResult } from "../types";

// Participant identity + token for a joined session. sessionStorage (per tab,
// survives refresh, gone when the tab closes) keyed by product + session id,
// with an index by public channel key because the live route is
// /play/live/[publicChannelKey]. The token stays after the session ends: the
// review screen reads with the token the end revoked.
//
// Two small extras:
// - a join draft (name picked on /play/[code] before the emoji step), keyed by code;
// - a remembered identity in localStorage to prefill name + emoji next time;
// - the device's participant token per session in localStorage (same-device
//   rejoin): sent as X-Participant-Token on a later join of the SAME session
//   (another tab, after "Leave session", after the tab was closed), the backend
//   answers with the same participant (points kept) instead of a new one;
// - `leftPending` on the stored session: the page sent a best-effort leave on
//   pagehide (reload, tab closed); if the page comes back (reload / bfcache)
//   it rejoins with its token before reading state.
//
// Routes like /play/[code] and /play/live/[publicChannelKey] do not name the
// product: the *Any helpers (and useParticipantSession(null, ...)) search every
// product, and the stored session / draft says which API to use
// (participantApiFor(stored.product)).

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
	/** A leave was sent on pagehide: rejoin with the token when this page comes back (reload / bfcache). */
	leftPending?: boolean;
}

/** The device's participant for a session (localStorage), sent on a later join of the same session. */
export interface DeviceParticipant {
	participantId: number;
	participantToken: string;
	/** Epoch ms; entries older than DEVICE_PARTICIPANT_TTL_MS are dropped. */
	savedAt: number;
}

export interface JoinDraft {
	/** The product whose routes found the code (lookupSessionByCode); absent on old drafts (= quest). */
	product?: DeckProduct;
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
const devicePrefix = `${PREFIX}:device:`;
const deviceKey = (product: DeckProduct, sessionId: number | string) => `${devicePrefix}${product}:${sessionId}`;

/** Sessions run for hours, not days: older device tokens are dropped (the end revokes them anyway). */
const DEVICE_PARTICIPANT_TTL_MS = 24 * 60 * 60 * 1000;

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
	saveDeviceParticipant(product, join.session_id, join.participant_id, join.participant_token);
	return stored;
}

/** Set / clear the "left on pagehide" marker of a stored session (no-op when none is stored). */
export function setParticipantLeftPending(product: DeckProduct, sessionId: number | string, pending: boolean): void {
	const stored = loadParticipantSession(product, sessionId);
	if (!stored || !!stored.leftPending === pending) return;
	const next: StoredParticipantSession = { ...stored };
	if (pending) next.leftPending = true;
	else delete next.leftPending;
	writeJson(storage("session"), sessionKey(product, sessionId), next);
}

/** Remember this device's participant token for a session (same-device rejoin); prunes expired entries. */
export function saveDeviceParticipant(
	product: DeckProduct,
	sessionId: number | string,
	participantId: number,
	participantToken: string
): void {
	const store = storage("local");
	if (!store) return;
	const now = Date.now();
	try {
		for (let index = store.length - 1; index >= 0; index -= 1) {
			const key = store.key(index);
			if (!key?.startsWith(devicePrefix)) continue;
			const entry = readJson<DeviceParticipant>(store, key);
			if (!entry || typeof entry.savedAt !== "number" || now - entry.savedAt > DEVICE_PARTICIPANT_TTL_MS) {
				store.removeItem(key);
			}
		}
	} catch {
		// Pruning is housekeeping only.
	}
	writeJson(store, deviceKey(product, sessionId), { participantId, participantToken, savedAt: now } satisfies DeviceParticipant);
}

/** This device's participant token for a session, if it joined it before (and not too long ago). */
export function loadDeviceParticipant(product: DeckProduct, sessionId: number | string): DeviceParticipant | null {
	const entry = readJson<DeviceParticipant>(storage("local"), deviceKey(product, sessionId));
	if (!entry || typeof entry.participantToken !== "string" || typeof entry.savedAt !== "number") return null;
	return Date.now() - entry.savedAt > DEVICE_PARTICIPANT_TTL_MS ? null : entry;
}

/** Forget the device token (the backend no longer knows it: 401 / session gone). */
export function clearDeviceParticipant(product: DeckProduct, sessionId: number | string): void {
	storage("local")?.removeItem(deviceKey(product, sessionId));
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

/** findParticipantSessionByChannel across every product (quest first). */
export function findParticipantSessionByChannelAny(publicChannelKey: string): StoredParticipantSession | null {
	for (const product of DECK_PRODUCTS) {
		const stored = findParticipantSessionByChannel(product, publicChannelKey);
		if (stored) return stored;
	}
	return null;
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

/** loadJoinDraft across every product (quest first); the result's `product` says which. */
export function loadJoinDraftAny(code: string): (JoinDraft & { product: DeckProduct }) | null {
	for (const product of DECK_PRODUCTS) {
		const draft = loadJoinDraft(product, code);
		if (draft) return { ...draft, product: draft.product ?? product };
	}
	return null;
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
 * product null = any product (the stored session's `product` says which).
 */
export function useParticipantSession(
	product: DeckProduct | null,
	publicChannelKey: string | null | undefined
): StoredParticipantSession | null | undefined {
	const [stored, setStored] = useState<StoredParticipantSession | null | undefined>(undefined);

	useEffect(() => {
		if (!publicChannelKey) {
			setStored(null);
			return;
		}
		setStored(
			product
				? findParticipantSessionByChannel(product, publicChannelKey)
				: findParticipantSessionByChannelAny(publicChannelKey)
		);
	}, [product, publicChannelKey]);

	return stored;
}
