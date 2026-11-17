"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
	hapticsEnabled,
	hapticsSupported,
	pulse,
	setHapticsEnabled,
	subscribeHaptics,
	type HapticKind,
} from "@/features/deck/lib/haptics";

// The shell's view of the participant app's one haptics implementation
// (features/deck/lib/haptics.ts, shared with the slide components): same
// patterns, same per-device setting (localStorage mindspear:play:haptics),
// same reduced-motion / no-Vibration-API no-op. This file only adds the
// React hook the settings sheet uses.

export { hapticsEnabled, hapticsSupported, pulse, setHapticsEnabled };
export type { HapticKind };

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
	try {
		return typeof window !== "undefined" && !!window.matchMedia?.(REDUCED_MOTION_QUERY).matches;
	} catch {
		return false;
	}
}

function subscribeReducedMotion(listener: () => void): () => void {
	if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
	const query = window.matchMedia(REDUCED_MOTION_QUERY);
	query.addEventListener?.("change", listener);
	return () => query.removeEventListener?.("change", listener);
}

const noSubscription = () => () => undefined;

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
	const enabled = useSyncExternalStore(subscribeHaptics, hapticsEnabled, () => true);
	const supported = useSyncExternalStore(noSubscription, hapticsSupported, () => false);
	const reducedMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
	const fire = useCallback((kind: HapticKind = "tap") => pulse(kind), []);
	return { supported, reducedMotion, enabled, setEnabled: setHapticsEnabled, pulse: fire };
}
