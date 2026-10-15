"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

// Small browser hooks for the participant screens.

function subscribeOnline(listener: () => void): () => void {
	window.addEventListener("online", listener);
	window.addEventListener("offline", listener);
	return () => {
		window.removeEventListener("online", listener);
		window.removeEventListener("offline", listener);
	};
}

/** navigator.onLine, live. Assumes online during SSR. */
export function useOnlineStatus(): boolean {
	return useSyncExternalStore(
		subscribeOnline,
		() => navigator.onLine,
		() => true
	);
}

/**
 * Best-effort interception of the browser / Android hardware back button
 * (plan §4.3): pushes one guard history entry for the current URL; when
 * the user goes back, the guard is re-armed and `onBack` runs (e.g. open a
 * "Leave session?" sheet). Next's app router supports window.history
 * pushState (it copies its own state into the entry), so the restore it
 * performs on popstate lands on the same page.
 */
export function useBackGuard(enabled: boolean, onBack: () => void): void {
	const onBackRef = useRef(onBack);
	onBackRef.current = onBack;

	useEffect(() => {
		if (!enabled) return;
		const marker = { msPlayGuard: Date.now() };
		window.history.pushState(marker, "", window.location.href);
		const onPopState = () => {
			window.history.pushState({ msPlayGuard: Date.now() }, "", window.location.href);
			onBackRef.current();
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [enabled]);
}

/** The previous value of `value` (undefined on the first render). */
export function usePrevious<T>(value: T): T | undefined {
	const ref = useRef<T | undefined>(undefined);
	useEffect(() => {
		ref.current = value;
	}, [value]);
	return ref.current;
}
