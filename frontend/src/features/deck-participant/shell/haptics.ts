"use client";

import { useCallback, useSyncExternalStore } from "react";

// Haptic pulses (plan §4.4): short on option tap, medium on submit, double on
// success. A per-device setting, on by default. No-op where the Vibration API
// is missing (iOS Safari) and whenever the user prefers reduced motion (§4.6).

export type HapticKind = "tap" | "submit" | "success" | "warning";

const PATTERNS: Record<HapticKind, number | number[]> = {
	tap: 10,
	submit: 20,
	success: [12, 60, 12],
	warning: [30, 60, 30],
};

const STORAGE_KEY = "mindspear:play:haptics";
const listeners = new Set<() => void>();

export function hapticsSupported(): boolean {
	return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

function prefersReducedMotion(): boolean {
	try {
		return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	} catch {
		return false;
	}
}

/** The stored preference (default on). */
export function getHapticsPreference(): boolean {
	if (typeof window === "undefined") return true;
	try {
		return window.localStorage.getItem(STORAGE_KEY) !== "off";
	} catch {
		return true;
	}
}

export function setHapticsPreference(enabled: boolean): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
	} catch {
		// Storage disabled: the setting lasts for this page only.
	}
	listeners.forEach((listener) => listener());
}

/** Fire a pulse when supported, enabled and motion is welcome. Safe to call anywhere. */
export function pulse(kind: HapticKind = "tap"): void {
	if (!hapticsSupported() || !getHapticsPreference() || prefersReducedMotion()) return;
	try {
		navigator.vibrate(PATTERNS[kind]);
	} catch {
		// Some browsers throw before the first user gesture.
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	const onStorage = (event: StorageEvent) => {
		if (event.key === STORAGE_KEY) listener();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}

export interface HapticsControls {
	/** The device can vibrate at all. */
	supported: boolean;
	/** Reduced motion is on: pulses are suppressed whatever the setting. */
	reducedMotion: boolean;
	/** The user's setting. */
	enabled: boolean;
	setEnabled: (enabled: boolean) => void;
	pulse: (kind?: HapticKind) => void;
}

export function useHaptics(): HapticsControls {
	const enabled = useSyncExternalStore(subscribe, getHapticsPreference, () => true);
	const supported = useSyncExternalStore(subscribe, hapticsSupported, () => false);
	const reducedMotion = useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
	const fire = useCallback((kind: HapticKind = "tap") => pulse(kind), []);
	return { supported, reducedMotion, enabled, setEnabled: setHapticsPreference, pulse: fire };
}
