import axiosInstance from "@/utils/axiosInstance";
import { deckRequest } from "@/features/deck/api/errors";
import { authoringBase, DECK_TIMEOUTS, sessionsBase } from "@/features/deck/api/routes";
import type {
	ApiEnvelope,
	DeckProduct,
	DeckSummary,
	IsoDateTime,
	PresenterRunView,
	SessionStatus,
} from "@/features/deck/types";
import type { LegacySessionSummary, LegacySource } from "@/features/legacy-results/api";

// My Library > a quiz / quest > its sessions and their results (deck owner who
// hosted them; everyone else 404). Backend: routes/deck/results.php,
// App\Deck\Results\SessionResultsService. Every function throws DeckApiError.

type Id = number | string;

export interface DeckSessionSummary {
	id: number;
	status: SessionStatus;
	join_code: string;
	created_at: IsoDateTime | null;
	started_at: IsoDateTime | null;
	ended_at: IsoDateTime | null;
	participant_count: number;
	answer_count: number;
}

/** Old-version sessions of the quiz / quest this deck was converted from (opened through /past-results). */
export interface LegacySessionGroup {
	source: LegacySource;
	id: number;
	title: string;
	sessions: LegacySessionSummary[];
}

export interface DeckSessions {
	deck: DeckSummary;
	/** Newest first. */
	sessions: DeckSessionSummary[];
	legacy: LegacySessionGroup[];
}

export interface SessionResultsInfo {
	id: number;
	deck_id: number;
	product: DeckProduct | null;
	deck_title: string | null;
	/** Deck colour preset (settings.theme); "default" when unset. */
	theme: string;
	status: SessionStatus;
	join_code: string;
	started_at: IsoDateTime | null;
	ended_at: IsoDateTime | null;
}

export interface SessionResultParticipant {
	/** Ties on points share a rank (1, 2, 2, 4). */
	rank: number;
	participant_id: number;
	display_name: string | null;
	emoji_avatar: string | null;
	total_points: number;
	answered: number;
	correct: number;
	joined_at: IsoDateTime | null;
	/** Closed their tab before the end; still ranked. */
	left: boolean;
}

export interface SessionResults {
	session: SessionResultsInfo;
	/** Quiz sessions: points and correct answers count. */
	scored: boolean;
	/** Runs that take answers and were reached, in slide order, with their final aggregate. */
	runs: PresenterRunView[];
	/** Best first. */
	participants: SessionResultParticipant[];
	server_time: IsoDateTime;
}

export interface SessionResultsApi {
	readonly product: DeckProduct;
	/** GET /{quizzes|quests}/{deck}/sessions */
	listSessions(deckId: Id, signal?: AbortSignal): Promise<DeckSessions>;
	/** GET /{quiz|quest}-sessions/{session}/results */
	getResults(sessionId: Id, signal?: AbortSignal): Promise<SessionResults>;
	/** GET .../results/export — through axios: the request needs the user's token, so a plain link wouldn't work. */
	downloadCsv(sessionId: Id, fileName: string): Promise<void>;
}

export function createSessionResultsApi(product: DeckProduct): SessionResultsApi {
	const timeout = DECK_TIMEOUTS.default;
	const resultsUrl = (sessionId: Id) => `${sessionsBase(product)}/${sessionId}/results`;

	return {
		product,

		listSessions: (deckId, signal) =>
			deckRequest(async () => {
				const res = await axiosInstance.get<ApiEnvelope<DeckSessions>>(`${authoringBase(product)}/${deckId}/sessions`, {
					signal,
					timeout,
				});
				return res.data.data;
			}),

		getResults: (sessionId, signal) =>
			deckRequest(async () => {
				const res = await axiosInstance.get<ApiEnvelope<SessionResults>>(resultsUrl(sessionId), {
					signal,
					timeout: DECK_TIMEOUTS.review,
				});
				return res.data.data;
			}),

		downloadCsv: (sessionId, fileName) =>
			deckRequest(async () => {
				const res = await axiosInstance.get<Blob>(`${resultsUrl(sessionId)}/export`, {
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
			}),
	};
}

const questResultsApi = createSessionResultsApi("quest");
const quizResultsApi = createSessionResultsApi("quiz");

export function sessionResultsApiFor(product: DeckProduct): SessionResultsApi {
	return product === "quiz" ? quizResultsApi : questResultsApi;
}
