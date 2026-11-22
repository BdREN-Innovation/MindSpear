import axiosInstance from "@/utils/axiosInstance";

// Past results: the owner's quizzes and quests from the previous version of Mindspear
// (backend app/Deck/Legacy/LegacyResults.php, /api/v1/legacy-results). Read-only.

export type LegacySource = "quiz" | "quest";

export interface LegacyItem {
	source: LegacySource;
	id: number;
	title: string;
	/** The deck it was copied into, when it was converted. */
	deck_id: number | null;
	sessions: number;
	participants: number;
	created_at: string | null;
	last_played_at: string | null;
}

export interface LegacySessionSummary {
	/** A number, or "none" for participants the old app stored without a session. */
	id: string;
	title: string | null;
	join_code: string | null;
	started_at: string | null;
	ended_at: string | null;
	participants: number;
}

export interface LegacyDetail {
	source: LegacySource;
	id: number;
	title: string;
	deck_id: number | null;
	scored: boolean;
	sessions: LegacySessionSummary[];
}

export type LegacyQuestionSummary =
	| { kind: "choices"; choices: { label: string; count: number; correct?: boolean }[] }
	| { kind: "words"; words: { text: string; count: number }[] }
	| { kind: "ranking"; items: { label: string; average_position: number | null; first: number; ranked: number }[] }
	| {
			kind: "scale";
			min: number;
			max: number;
			min_label: string | null;
			max_label: string | null;
			statements: { label: string; average: number | null; answered: number; skipped: number; distribution: Record<string, number> }[];
	  }
	| { kind: "none" };

export interface LegacyQuestion {
	id: number;
	number: number;
	text: string | null;
	type: string | null;
	deleted: boolean;
	correct_answer: string | null;
	answered: number;
	/** null for quests (not scored). */
	correct: number | null;
	summary: LegacyQuestionSummary;
}

export interface LegacyParticipant {
	id: number;
	name: string;
	joined_at: string | null;
	answered: number;
	correct: number | null;
	/** By question id. */
	answers: Record<string, { text: string; correct: boolean | null }>;
}

export interface LegacySession {
	source: LegacySource;
	id: number;
	title: string;
	scored: boolean;
	session: { id: string; title: string | null; started_at: string | null; ended_at: string | null };
	questions: LegacyQuestion[];
	participants: LegacyParticipant[];
}

const data = <T>(response: { data: { data: T } }): T => response.data.data;

export const legacyResultsApi = {
	list: async () => data<{ items: LegacyItem[] }>(await axiosInstance.get("/legacy-results")).items,
	show: async (source: LegacySource, id: number) => data<LegacyDetail>(await axiosInstance.get(`/legacy-results/${source}/${id}`)),
	session: async (source: LegacySource, id: number, session: string) =>
		data<LegacySession>(await axiosInstance.get(`/legacy-results/${source}/${id}/sessions/${session}`, { timeout: 60_000 })),

	/** Through the API: the request needs the user's token, so a plain link wouldn't work. */
	async downloadCsv(source: LegacySource, id: number, session: string, fileName: string): Promise<void> {
		const res = await axiosInstance.get<Blob>(`/legacy-results/${source}/${id}/sessions/${session}/export`, {
			responseType: "blob",
			timeout: 60_000,
		});
		const url = URL.createObjectURL(res.data);
		const link = document.createElement("a");
		link.href = url;
		link.download = fileName;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	},
};

export function formatDate(value: string | null): string {
	if (!value) return "—";
	return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The editor of the deck an old quiz / quest was copied into. */
export function deckEditUrl(source: LegacySource, deckId: number): string {
	return `/${source === "quiz" ? "quizzes" : "quests"}/${deckId}/edit`;
}
