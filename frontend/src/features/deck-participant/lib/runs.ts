import type {
	AnswerPayloadMap,
	IsoDateTime,
	MySubmission,
	OpenEndedConfig,
	ParticipantRunView,
	StoredAnswer,
	WordCloudConfig,
} from "@/features/deck/types";

// Run helpers shared by the play and review screens.

/** Content slides (and unknown types) render read-only and never enter voting. */
export function isContentRun(run: Pick<ParticipantRunView, "category" | "type" | "accepts_answers">): boolean {
	if (run.type === "qa_audience") return false;
	return run.category === "content" || !run.accepts_answers;
}

/** Answer types: POST .../answers (qa_audience and content excluded). */
export function isAnswerRun(run: Pick<ParticipantRunView, "type" | "accepts_answers">): boolean {
	return run.type !== "qa_audience" && run.accepts_answers;
}

/**
 * The deck theme key for participants. The participant state / review do
 * not carry deck settings today; read a `theme` or `settings.theme` on the
 * session defensively so the screens pick it up as soon as the backend sends
 * one, else the default palette.
 */
export function deckThemeKeyFrom(state: unknown): string | null {
	const session = (state as { session?: Record<string, unknown> } | null | undefined)?.session;
	if (!session) return null;
	if (typeof session.theme === "string") return session.theme;
	const settings = session.settings as { theme?: unknown } | null | undefined;
	return typeof settings?.theme === "string" ? settings.theme : null;
}

/** answer_payload, or null for a missing / empty (`{}` / `[]`) one. */
export function storedPayload(submission: MySubmission | null | undefined): StoredAnswer | null {
	const payload = submission?.answer_payload as unknown;
	if (!payload || typeof payload !== "object") return null;
	if (Array.isArray(payload) ? payload.length === 0 : Object.keys(payload).length === 0) return null;
	return payload as StoredAnswer;
}

/**
 * What the server will store for a just-accepted POST (StoredAnswerMap
 * shape), shown until GET my-answer returns the authoritative copy. Mirrors
 * the merge rules: word_cloud appends with allow_multiple_submissions,
 * open_ended appends while max_submissions_per_participant > 1, pin_on_image
 * {x, y} shorthand becomes {pins: [...]}, everything else replaces.
 */
export function provisionalSubmission(
	run: ParticipantRunView,
	payload: unknown,
	previous: MySubmission | null | undefined,
	now: IsoDateTime = new Date().toISOString()
): MySubmission {
	const before = storedPayload(previous) as Record<string, unknown> | null;
	let stored: unknown = payload;

	switch (run.type) {
		case "word_cloud": {
			const config = run.config as Partial<WordCloudConfig>;
			const entries = (payload as AnswerPayloadMap["word_cloud"]).entries ?? [];
			const prevEntries = config.allow_multiple_submissions ? ((before?.entries as string[]) ?? []) : [];
			const prevTimes = config.allow_multiple_submissions
				? ((before?.entry_times as (string | null)[]) ?? prevEntries.map(() => null))
				: [];
			const seen = new Set(prevEntries.map((entry) => entry.toLowerCase()));
			const added = entries.filter((entry) => {
				const key = entry.trim().toLowerCase();
				if (!key || seen.has(key)) return false;
				seen.add(key);
				return true;
			});
			stored = { entries: [...prevEntries, ...added], entry_times: [...prevTimes, ...added.map(() => now)] };
			break;
		}
		case "open_ended": {
			const config = run.config as Partial<OpenEndedConfig>;
			const text = (payload as AnswerPayloadMap["open_ended"]).text ?? "";
			const keep = (config.max_submissions_per_participant ?? 1) > 1;
			const prevEntries = keep ? ((before?.entries as { body: string; submitted_at: string }[]) ?? []) : [];
			stored = { entries: [...prevEntries, { body: text, submitted_at: now }] };
			break;
		}
		case "pin_on_image": {
			const pin = payload as AnswerPayloadMap["pin_on_image"];
			stored = "pins" in pin ? pin : { pins: [pin] };
			break;
		}
		default:
			break;
	}

	return {
		slide_run_id: run.id,
		answer_payload: stored as StoredAnswer,
		time_to_answer_ms: previous?.time_to_answer_ms ?? null,
		submitted_at: now,
	};
}
