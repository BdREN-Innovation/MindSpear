/** "just now", "3 min ago", "2 h ago" — for the Q&A sheet. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
	if (!iso) return "";
	const at = Date.parse(iso);
	if (!Number.isFinite(at)) return "";
	const seconds = Math.max(0, Math.round((now - at) / 1000));
	if (seconds < 45) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	return new Date(at).toLocaleDateString();
}

/** 83 → "1:23" */
export function formatClock(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	const minutes = Math.floor(s / 60);
	const seconds = s % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Session length between two ISO stamps: "42 min", "1 h 5 min", "38 s". */
export function formatDuration(startIso: string | null | undefined, endIso: string | null | undefined): string | null {
	if (!startIso || !endIso) return null;
	const ms = Date.parse(endIso) - Date.parse(startIso);
	if (!Number.isFinite(ms) || ms < 0) return null;
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds} s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** total_entries of multi-entry aggregates (open_ended: one person can send several), else null. */
export function aggregateEntries(aggregate: unknown): number | null {
	if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) return null;
	const total = (aggregate as { total_entries?: unknown }).total_entries;
	return typeof total === "number" && Number.isFinite(total) ? total : null;
}

/** Best-effort total_responses of any aggregate shape (content / Q&A have none). */
export function aggregateResponses(aggregate: unknown): number | null {
	if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) return null;
	const total = (aggregate as { total_responses?: unknown }).total_responses;
	return typeof total === "number" && Number.isFinite(total) ? total : null;
}
