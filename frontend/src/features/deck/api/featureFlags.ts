"use client";

import { useCallback, useEffect, useState } from "react";
import axiosInstance from "@/utils/axiosInstance";
import type { DeckProduct } from "../types";

// Rollout flags of the v2 deck products: GET /profile/show returns the
// effective values (users.quest_v2_enabled / quiz_v2_enabled or the
// QUEST_V2_DEFAULT_ENABLED / QUIZ_V2_DEFAULT_ENABLED config) as
// data.profile.quest_v2_enabled / quiz_v2_enabled. One read serves both,
// cached per sign-in token for a minute; any failure means "off" so the
// legacy flows keep working. Authoring / hosting calls can still answer 403
// feature_disabled (flag turned off meanwhile): clearDeckV2FlagsCache() then.
//
// (features/deck-editor/components/useQuestV2Enabled.ts is the older
// quest-only twin; it keeps its own cache.)

export type DeckV2Flags = Record<DeckProduct, boolean>;

const TTL_MS = 60_000;
const OFF: DeckV2Flags = { quest: false, quiz: false };

let cache: { token: string | null; value: DeckV2Flags; at: number } | null = null;
let inflight: { token: string | null; promise: Promise<DeckV2Flags> } | null = null;

function currentToken(): string | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage.getItem("auth_token");
	} catch {
		return null;
	}
}

function cachedFlags(): DeckV2Flags | null {
	const token = currentToken();
	return cache && cache.token === token && Date.now() - cache.at < TTL_MS ? cache.value : null;
}

/** Both flags (cached); resolves all-false when signed out or on any error. */
export function fetchDeckV2Flags(force = false): Promise<DeckV2Flags> {
	const token = currentToken();
	if (!token) return Promise.resolve(OFF);
	if (!force) {
		const cached = cachedFlags();
		if (cached) return Promise.resolve(cached);
	}
	if (inflight && inflight.token === token) return inflight.promise;

	const promise = axiosInstance
		.get<{ data?: { profile?: { quest_v2_enabled?: unknown; quiz_v2_enabled?: unknown } } }>("/profile/show")
		.then((res): DeckV2Flags => {
			const profile = res.data?.data?.profile;
			return { quest: profile?.quest_v2_enabled === true, quiz: profile?.quiz_v2_enabled === true };
		})
		.catch(() => OFF)
		.then((value) => {
			cache = { token, value, at: Date.now() };
			return value;
		})
		.finally(() => {
			if (inflight?.promise === promise) inflight = null;
		});
	inflight = { token, promise };
	return promise;
}

/** One product's flag (cached). */
export function fetchDeckV2Enabled(product: DeckProduct, force = false): Promise<boolean> {
	return fetchDeckV2Flags(force).then((flags) => flags[product]);
}

/** Forget the cached flags (e.g. after a feature_disabled answer). */
export function clearDeckV2FlagsCache(): void {
	cache = null;
}

/** `enabled` is null while loading. `resolve()` waits for the answer (use it in click handlers). */
export function useDeckV2Enabled(product: DeckProduct): { enabled: boolean | null; resolve: () => Promise<boolean> } {
	const [enabled, setEnabled] = useState<boolean | null>(() => cachedFlags()?.[product] ?? null);

	useEffect(() => {
		let active = true;
		void fetchDeckV2Flags().then((flags) => {
			if (active) setEnabled(flags[product]);
		});
		return () => {
			active = false;
		};
	}, [product]);

	const resolve = useCallback(async () => {
		const value = (await fetchDeckV2Flags())[product];
		setEnabled(value);
		return value;
	}, [product]);

	return { enabled, resolve };
}
