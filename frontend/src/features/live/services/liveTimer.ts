import type { TimerState } from "@/features/live/types";

/**
 * Adds `deadline_ms` (by this device's clock) to a timer the server has stamped, from the
 * seconds it says are left. Every player's countdown then ends together, also after a reload,
 * a dropped connection or a late join; it used to restart from the full time limit (or from
 * whatever was left when the page was last open).
 */
export function withDeadline(timer: TimerState): TimerState {
	if (!timer || typeof timer.started_at !== "string" || typeof timer.remaining_seconds !== "number") {
		return timer;
	}

	return { ...timer, deadline_ms: Date.now() + timer.remaining_seconds * 1000 };
}

/** Whole seconds left until a deadline from `withDeadline`, or null when there is none. */
export function secondsUntil(deadline: unknown): number | null {
	if (typeof deadline !== "number" || !Number.isFinite(deadline)) return null;

	return Math.max(0, Math.round((deadline - Date.now()) / 1000));
}
