"use client";

import { useCallback, useEffect, useState } from "react";
import axiosInstance from "@/utils/axiosInstance";

// Rollout flag for Quest v2 (backend users.quest_v2_enabled or the config
// default): GET /profile/show returns the effective value as
// data.profile.quest_v2_enabled. The auth store does not carry it, so it is
// read once and cached per sign-in token for a minute; any failure means
// "off" so the legacy flows keep working.

const TTL_MS = 60_000;

let cache: { token: string | null; value: boolean; at: number } | null = null;
let inflight: { token: string | null; promise: Promise<boolean> } | null = null;

function currentToken(): string | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage.getItem("auth_token");
	} catch {
		return null;
	}
}

/** The effective flag (cached); resolves false when signed out or on any error. */
export function fetchQuestV2Enabled(force = false): Promise<boolean> {
	const token = currentToken();
	if (!token) return Promise.resolve(false);
	if (!force && cache && cache.token === token && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.value);
	if (inflight && inflight.token === token) return inflight.promise;

	const promise = axiosInstance
		.get<{ data?: { profile?: { quest_v2_enabled?: unknown } } }>("/profile/show")
		.then((res) => res.data?.data?.profile?.quest_v2_enabled === true)
		.catch(() => false)
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

/** Forget the cached flag (e.g. after a feature_disabled answer). */
export function clearQuestV2EnabledCache(): void {
	cache = null;
}

/** `enabled` is null while loading. `resolve()` waits for the answer (use it in click handlers). */
export function useQuestV2Enabled(): { enabled: boolean | null; resolve: () => Promise<boolean> } {
	const [enabled, setEnabled] = useState<boolean | null>(() => {
		const token = currentToken();
		return cache && cache.token === token && Date.now() - cache.at < TTL_MS ? cache.value : null;
	});

	useEffect(() => {
		let active = true;
		void fetchQuestV2Enabled().then((value) => {
			if (active) setEnabled(value);
		});
		return () => {
			active = false;
		};
	}, []);

	const resolve = useCallback(async () => {
		const value = await fetchQuestV2Enabled();
		setEnabled(value);
		return value;
	}, []);

	return { enabled, resolve };
}
