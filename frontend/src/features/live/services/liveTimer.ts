import type { TimerState } from "@/features/live/types";

/**
 * Adds `deadline_ms` (by this device's clock) to a timer the server has stamped, from the
 * time it says is left at `measuredAt` (when the server worked it out, by this device's clock;
 * for a fetched state, the middle of the request — counting from the reply added the request's
 * travel time, which put players who joined late or reloaded 1–2 seconds behind). Every player's countdown then ends together, also after a reload,
 * a dropped connection or a late join; it used to restart from the full time limit (or from
 * whatever was left when the page was last open).
 */
export function withDeadline(timer: TimerState, measuredAt: number = Date.now()): TimerState {
	if (!timer || typeof timer.started_at !== "string") return timer;

	// Milliseconds when the server sends them (whole seconds put players up to a second behind).
	const remainingMs =
		typeof timer.remaining_ms === "number"
			? timer.remaining_ms
			: typeof timer.remaining_seconds === "number"
				? timer.remaining_seconds * 1000
				: null;
	if (remainingMs === null) return timer;

	return { ...timer, deadline_ms: measuredAt + remainingMs };
}

/** Seconds (with the fraction) left until a deadline from `withDeadline`, or null when there is none. */
export function secondsUntil(deadline: unknown): number | null {
	if (typeof deadline !== "number" || !Number.isFinite(deadline)) return null;

	return Math.max(0, (deadline - Date.now()) / 1000);
}

/** The deadline of a timer straight from the server (a change-question reply, say). */
export const deadlineOf = (timer: TimerState): number | null => withDeadline(timer)?.deadline_ms ?? null;
