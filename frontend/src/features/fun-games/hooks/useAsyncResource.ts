"use client";

import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type DependencyList,
	type Dispatch,
	type SetStateAction,
} from "react";
import { FunGamesApiError, toFunGamesError } from "../api";

export interface AsyncResource<T> {
	data: T | undefined;
	error: FunGamesApiError | null;
	/** First load, nothing to show yet. */
	loading: boolean;
	/** Re-fetching while the previous data stays on screen. */
	refreshing: boolean;
	reload: () => void;
	setData: Dispatch<SetStateAction<T | undefined>>;
}

/**
 * Loads data with abort-on-unmount and `reload()`. Previous data stays visible
 * while a reload is in flight, and a failed reload keeps it (with `error` set).
 */
export function useAsyncResource<T>(
	load: (signal: AbortSignal) => Promise<T>,
	deps: DependencyList,
	{ enabled = true }: { enabled?: boolean } = {},
): AsyncResource<T> {
	const [data, setData] = useState<T | undefined>(undefined);
	const [error, setError] = useState<FunGamesApiError | null>(null);
	const [inFlight, setInFlight] = useState(enabled);
	const [reloadKey, setReloadKey] = useState(0);
	const loadRef = useRef(load);
	loadRef.current = load;

	useEffect(() => {
		if (!enabled) {
			setInFlight(false);
			return;
		}
		const controller = new AbortController();
		setInFlight(true);
		loadRef.current(controller.signal).then(
			(value) => {
				if (controller.signal.aborted) return;
				setData(value);
				setError(null);
				setInFlight(false);
			},
			(reason: unknown) => {
				if (controller.signal.aborted) return;
				const err = toFunGamesError(reason);
				if (err.code === "aborted") return;
				setError(err);
				setInFlight(false);
			},
		);
		return () => controller.abort();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [...deps, enabled, reloadKey]);

	const reload = useCallback(() => setReloadKey((key) => key + 1), []);

	return {
		data,
		error,
		loading: inFlight && data === undefined,
		refreshing: inFlight && data !== undefined,
		reload,
		setData,
	};
}
