import { formatDuration } from "@/features/deck-presenter/lib/format";
import type { SessionStatus } from "@/features/deck/types";

export const STATUS_LABEL: Record<SessionStatus, string> = {
	pending: "Not started",
	live: "Live now",
	ended: "Ended",
};

/** "23 Nov 2026, 10:42" — or "—". */
export function formatDateTime(iso: string | null | undefined): string {
	if (!iso) return "—";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Ended: "42 min"; live: "In progress"; never started: "—". */
export function sessionDuration(session: { status: SessionStatus; started_at: string | null; ended_at: string | null }): string {
	if (session.status === "live") return "In progress";
	return formatDuration(session.started_at, session.ended_at) ?? "—";
}

export function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`;
}

/** "My quiz!" → "my-quiz" for download names. */
export function fileSlug(text: string): string {
	return (
		text
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-+|-+$/g, "")
			.toLowerCase() || "results"
	);
}
