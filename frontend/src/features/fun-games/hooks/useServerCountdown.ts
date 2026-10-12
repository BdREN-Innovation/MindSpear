"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { serverClock } from "../lib/serverClock";

/**
 * Milliseconds until a server timestamp, on the server's clock, re-rendering
 * the calling component every `tickMs`. Returns null without a target.
 * Use it in small leaf components so only they re-render each tick.
 */
export function useServerCountdown(target: string | null | undefined, tickMs = 250): number | null {
	// Re-render when the clock offset estimate changes.
	useSyncExternalStore(serverClock.subscribe, serverClock.getSnapshot, () => 0);
	const [, setTick] = useState(0);

	useEffect(() => {
		if (!target) return;
		const timer = setInterval(() => setTick((n) => n + 1), tickMs);
		return () => clearInterval(timer);
	}, [target, tickMs]);

	return serverClock.remainingMs(target);
}
