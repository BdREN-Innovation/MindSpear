// Haptic pulses for the participant app (plan §4.4): short on option tap /
// select, medium on submit, double on success, triple-ish on error. One
// per-device setting (localStorage `mindspear:play:haptics`, default on) shared
// by the participant shell and the slide components. No-op where the
// Vibration API is missing (iOS Safari), during SSR, and whenever the user
// prefers reduced motion (§4.6).

export type HapticKind = "tap" | "select" | "submit" | "success" | "error";

const PATTERNS: Record<HapticKind, number | number[]> = {
	tap: 10,
	select: 10,
	submit: 20,
	success: [12, 60, 12],
	error: [30, 60, 30],
};

const STORAGE_KEY = "mindspear:play:haptics";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const listeners = new Set<() => void>();

/** The device can vibrate at all. */
export function hapticsSupported(): boolean {
	return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

function prefersReducedMotion(): boolean {
	try {
		return typeof window !== "undefined" && !!window.matchMedia?.(REDUCED_MOTION_QUERY).matches;
	} catch {
		return false;
	}
}

/** The stored preference (default on; only an explicit "off" disables it). */
export function hapticsEnabled(): boolean {
	if (typeof window === "undefined") return true;
	try {
		return window.localStorage.getItem(STORAGE_KEY) !== "off";
	} catch {
		return true;
	}
}

export function setHapticsEnabled(on: boolean): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
	} catch {
		// Storage disabled: the setting lasts for this page only.
	}
	listeners.forEach((listener) => listener());
}

/** Fire a pulse when supported, enabled and motion is welcome. Safe to call anywhere. */
export function pulse(kind: HapticKind): void {
	if (!hapticsSupported() || !hapticsEnabled() || prefersReducedMotion()) return;
	try {
		navigator.vibrate(PATTERNS[kind]);
	} catch {
		// Some browsers throw before the first user gesture.
	}
}

/**
 * Subscribe to setting changes (this tab via setHapticsEnabled, other tabs via
 * the storage event). For useSyncExternalStore in settings toggles.
 */
export function subscribeHaptics(listener: () => void): () => void {
	listeners.add(listener);
	if (typeof window === "undefined") return () => listeners.delete(listener);
	const onStorage = (event: StorageEvent) => {
		if (event.key === STORAGE_KEY) listener();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}
