"use client";

import { useEffect, useState } from "react";
import type { ApiEnvelope, EmojiAvatarMeta } from "../types";
import { DeckApiError, deckRequest, toDeckApiError } from "./errors";
import { participantHttp } from "./participantApi";

// GET /api/v1/meta/emoji-avatars: the curated join avatars. The list only
// changes with a deploy, so it is cached for the page's lifetime in memory
// and indefinitely in localStorage (the network copy refreshes it in the
// background on the next cold start).

const STORAGE_KEY = "mindspear:deck:emoji-avatars:v1";

let memory: EmojiAvatarMeta | null = null;
let inflight: Promise<EmojiAvatarMeta> | null = null;
let refreshedThisLoad = false;

function isMeta(value: unknown): value is EmojiAvatarMeta {
	const meta = value as EmojiAvatarMeta | null;
	return (
		!!meta &&
		Array.isArray(meta.emojis) &&
		meta.emojis.every((emoji) => typeof emoji === "string") &&
		typeof meta.labels === "object" &&
		meta.labels !== null
	);
}

function readStored(): EmojiAvatarMeta | null {
	if (typeof window === "undefined") return null;
	try {
		const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
		return isMeta(parsed) && parsed.emojis.length > 0 ? parsed : null;
	} catch {
		return null;
	}
}

function writeStored(meta: EmojiAvatarMeta): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
	} catch {
		// Private mode / quota: memory cache still works.
	}
}

function fetchEmojiAvatars(): Promise<EmojiAvatarMeta> {
	inflight ??= deckRequest(async () => {
		const res = await participantHttp().get<ApiEnvelope<EmojiAvatarMeta>>("/meta/emoji-avatars");
		const meta: EmojiAvatarMeta = {
			emojis: res.data.data.emojis ?? [],
			// An empty PHP array would arrive as [].
			labels: Array.isArray(res.data.data.labels) ? {} : (res.data.data.labels ?? {}),
		};
		memory = meta;
		writeStored(meta);
		return meta;
	}).finally(() => {
		inflight = null;
	});
	return inflight;
}

/** Synchronous cached copy (memory, then localStorage), or null before the first load. */
export function getCachedEmojiAvatars(): EmojiAvatarMeta | null {
	memory ??= readStored();
	return memory;
}

/** The emoji list: cached copy when present (refreshed once per page load in the background), else the network. */
export async function getEmojiAvatars(): Promise<EmojiAvatarMeta> {
	const cached = getCachedEmojiAvatars();
	if (cached) {
		if (!inflight && !refreshedThisLoad) {
			refreshedThisLoad = true;
			fetchEmojiAvatars().catch(() => undefined);
		}
		return cached;
	}
	return fetchEmojiAvatars();
}

/** Screen-reader label for an emoji (falls back to the emoji itself). */
export function emojiLabel(meta: EmojiAvatarMeta | null, emoji: string): string {
	return meta?.labels[emoji] ?? emoji;
}

export interface UseEmojiAvatarsResult {
	meta: EmojiAvatarMeta | null;
	loading: boolean;
	error: DeckApiError | null;
	reload: () => void;
}

/** React hook around getEmojiAvatars(); renders the cached list immediately when present. */
export function useEmojiAvatars(): UseEmojiAvatarsResult {
	const [meta, setMeta] = useState<EmojiAvatarMeta | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<DeckApiError | null>(null);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		let active = true;
		setLoading(true);
		// Read the cache after mount so server and client markup agree.
		const cached = getCachedEmojiAvatars();
		if (cached) {
			setMeta(cached);
			setLoading(false);
		}
		getEmojiAvatars()
			.then((next) => {
				if (!active) return;
				setMeta(next);
				setError(null);
			})
			.catch((reason: unknown) => {
				if (active) setError(toDeckApiError(reason));
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [attempt]);

	return { meta, loading, error, reload: () => setAttempt((n) => n + 1) };
}
