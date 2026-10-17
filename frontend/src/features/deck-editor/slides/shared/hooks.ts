"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { pulse, type HapticKind } from "@/features/deck/lib/haptics";

export type { HapticKind };

// Small hooks the shared slide widgets build on.

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(listener: () => void): () => void {
	if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
	const query = window.matchMedia(REDUCED_MOTION_QUERY);
	query.addEventListener("change", listener);
	return () => query.removeEventListener("change", listener);
}

/** True when the user asked the OS for less motion (also turns haptics off, plan §4.6). */
export function usePrefersReducedMotion(): boolean {
	return useSyncExternalStore(
		subscribeReducedMotion,
		() => typeof window !== "undefined" && !!window.matchMedia?.(REDUCED_MOTION_QUERY).matches,
		() => false
	);
}

/**
 * A haptic pulse through the participant app's one implementation
 * (features/deck/lib/haptics): honours the per-device haptics setting, is a
 * no-op where unsupported (iOS Safari) and when the user prefers reduced
 * motion. Kinds, not raw patterns, so every surface vibrates the same way.
 */
export function haptic(kind: HapticKind = "tap"): void {
	pulse(kind);
}

/**
 * Local copy of a controlled value with a debounced commit:
 * - typing updates `local` at once and calls `onChange` after `debounceMs`
 *   (immediately when debounceMs is 0/undefined);
 * - `flush()` (call on blur / Enter) commits a pending value now;
 * - a new outside `value` replaces `local` unless the user has uncommitted edits.
 */
export function useDebouncedValue<T>(
	value: T,
	onChange: (value: T) => void,
	debounceMs?: number
): {
	local: T;
	setLocal: (next: T) => void;
	flush: () => void;
	/** Show `next` without committing it (e.g. the clamped value after blur). */
	replace: (next: T) => void;
	pending: boolean;
} {
	const [local, setLocalState] = useState(value);
	const [pending, setPending] = useState(false);
	const timer = useRef<number | null>(null);
	const latest = useRef(value);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const pendingRef = useRef(false);

	useEffect(() => {
		if (!pendingRef.current) {
			setLocalState(value);
			latest.current = value;
		}
	}, [value]);

	const commit = useCallback(() => {
		if (timer.current !== null) {
			window.clearTimeout(timer.current);
			timer.current = null;
		}
		if (!pendingRef.current) return;
		pendingRef.current = false;
		setPending(false);
		onChangeRef.current(latest.current);
	}, []);

	const setLocal = useCallback(
		(next: T) => {
			setLocalState(next);
			latest.current = next;
			pendingRef.current = true;
			setPending(true);
			if (!debounceMs) {
				commit();
				return;
			}
			if (timer.current !== null) window.clearTimeout(timer.current);
			timer.current = window.setTimeout(commit, debounceMs);
		},
		[commit, debounceMs]
	);

	const replace = useCallback((next: T) => {
		if (timer.current !== null) {
			window.clearTimeout(timer.current);
			timer.current = null;
		}
		pendingRef.current = false;
		setPending(false);
		latest.current = next;
		setLocalState(next);
	}, []);

	// Commit what was typed if the field unmounts mid-debounce (e.g. switching slides).
	useEffect(() => () => commit(), [commit]);

	return { local, setLocal, flush: commit, replace, pending };
}
