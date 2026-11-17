"use client";

import { useCallback, useEffect, useState } from "react";
import { libraryApi, parseLibraryError } from "../api/libraryApi";
import { onLibraryChange } from "../lib/events";
import type { StorageUsage } from "../types";

/** The signed-in user's storage usage; refreshes whenever the library changes. */
export function useStorageUsage(enabled = true) {
	const [usage, setUsage] = useState<StorageUsage | null>(null);
	const [loading, setLoading] = useState(enabled);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async (signal?: AbortSignal) => {
		try {
			setUsage(await libraryApi.usage(signal));
			setError(null);
		} catch (reason) {
			if (!signal?.aborted) setError(parseLibraryError(reason).message);
		} finally {
			if (!signal?.aborted) setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!enabled) return;
		const controller = new AbortController();
		refresh(controller.signal);
		const off = onLibraryChange((fresh) => (fresh ? setUsage(fresh) : refresh()));
		return () => {
			controller.abort();
			off();
		};
	}, [enabled, refresh]);

	return { usage, loading, error, refresh, setUsage };
}
