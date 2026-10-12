// Every call the logged-in host's screens make. Screens depend on `HostApi`;
// `getHostApi()` picks HTTP or the mock.

import type {
	AdminSessionSummary,
	HostGameDetail,
	HostGameInput,
	HostGameSummary,
	HostImportDryRun,
	HostImportRequest,
	HostParticipant,
	HostQuestion,
	HostQuestionInput,
	HostSessionDetail,
	Id,
	ImportSummary,
	Leaderboard,
	LibraryPreview,
	LibraryQuiz,
	SessionStatus,
	TimerMode,
} from "../types";
import { funGamesRequest } from "./http";
import type { RequestOptions } from "./participantApi";

export interface HostApi {
	listGames(opts?: RequestOptions): Promise<HostGameSummary[]>;
	getGame(gameId: Id, opts?: RequestOptions): Promise<HostGameDetail>;
	createGame(input: HostGameInput): Promise<HostGameDetail>;
	updateGame(gameId: Id, input: HostGameInput): Promise<HostGameDetail>;
	deleteGame(gameId: Id): Promise<void>;
	duplicateGame(gameId: Id): Promise<HostGameDetail>;
	publishGame(gameId: Id): Promise<HostGameDetail>;

	createQuestion(gameId: Id, input: HostQuestionInput): Promise<HostQuestion>;
	updateQuestion(gameId: Id, questionId: Id, input: HostQuestionInput): Promise<HostQuestion>;
	deleteQuestion(gameId: Id, questionId: Id): Promise<void>;
	reorderQuestions(gameId: Id, questionIds: Id[]): Promise<void>;

	listLibraryQuizzes(opts?: RequestOptions): Promise<LibraryQuiz[]>;
	previewLibraryQuiz(quizId: Id, opts?: RequestOptions): Promise<LibraryPreview>;
	/** New draft game with its own copy of the quiz's playable questions. */
	createGameFromLibrary(quizId: Id, timerMode: TimerMode): Promise<{ game: HostGameDetail; import: ImportSummary }>;
	importDryRun(gameId: Id, request: HostImportRequest): Promise<HostImportDryRun>;
	importQuestions(gameId: Id, request: HostImportRequest): Promise<{ game: HostGameDetail; import: ImportSummary }>;
	undoImport(importId: Id): Promise<{ game: HostGameDetail; import: ImportSummary }>;

	/** Opens the lobby now, or schedules the start. */
	createSession(gameId: Id, input: { startsAt?: string | null }): Promise<HostSessionDetail>;
	listSessions(params: { status?: SessionStatus[] }, opts?: RequestOptions): Promise<AdminSessionSummary[]>;
	getSession(sessionId: Id, opts?: RequestOptions): Promise<HostSessionDetail>;
	startSession(sessionId: Id): Promise<HostSessionDetail>;
	endSession(sessionId: Id): Promise<HostSessionDetail>;
	getSessionLeaderboard(sessionId: Id, opts?: RequestOptions): Promise<Leaderboard>;
	getSessionParticipants(sessionId: Id, opts?: RequestOptions): Promise<HostParticipant[]>;
}

const seg = encodeURIComponent;

export function createHttpHostApi(): HostApi {
	const get = <T>(url: string, opts?: RequestOptions, params?: object) =>
		funGamesRequest<T>({ method: "GET", url: `/host${url}`, signal: opts?.signal, params });
	const send = <T>(method: "POST" | "PATCH" | "PUT" | "DELETE", url: string, data?: unknown) =>
		funGamesRequest<T>({ method, url: `/host${url}`, data });

	return {
		listGames: async (opts) => (await get<{ games: HostGameSummary[] }>("/games", opts)).games,
		getGame: async (id, opts) => (await get<{ game: HostGameDetail }>(`/games/${seg(id)}`, opts)).game,
		createGame: async (input) => (await send<{ game: HostGameDetail }>("POST", "/games", input)).game,
		updateGame: async (id, input) => (await send<{ game: HostGameDetail }>("PATCH", `/games/${seg(id)}`, input)).game,
		deleteGame: async (id) => {
			await send("DELETE", `/games/${seg(id)}`);
		},
		duplicateGame: async (id) => (await send<{ game: HostGameDetail }>("POST", `/games/${seg(id)}/duplicate`)).game,
		publishGame: async (id) => (await send<{ game: HostGameDetail }>("POST", `/games/${seg(id)}/publish`)).game,

		createQuestion: async (gameId, input) =>
			(await send<{ question: HostQuestion }>("POST", `/games/${seg(gameId)}/questions`, input)).question,
		updateQuestion: async (gameId, questionId, input) =>
			(await send<{ question: HostQuestion }>("PATCH", `/games/${seg(gameId)}/questions/${seg(questionId)}`, input))
				.question,
		deleteQuestion: async (gameId, questionId) => {
			await send("DELETE", `/games/${seg(gameId)}/questions/${seg(questionId)}`);
		},
		reorderQuestions: async (gameId, questionIds) => {
			await send("PUT", `/games/${seg(gameId)}/questions/order`, { questionIds });
		},

		listLibraryQuizzes: async (opts) => (await get<{ quizzes: LibraryQuiz[] }>("/library-quizzes", opts)).quizzes,
		previewLibraryQuiz: (quizId, opts) => get<LibraryPreview>(`/library-quizzes/${seg(quizId)}/preview`, opts),
		createGameFromLibrary: (quizId, timerMode) => send("POST", "/games/from-library", { quizId, timerMode }),
		importDryRun: (gameId, request) =>
			send("POST", `/games/${seg(gameId)}/import`, { ...request, dryRun: true }),
		importQuestions: (gameId, request) =>
			send("POST", `/games/${seg(gameId)}/import`, { ...request, dryRun: false }),
		undoImport: (importId) => send("POST", `/imports/${seg(importId)}/undo`),

		createSession: async (gameId, input) =>
			(await send<{ session: HostSessionDetail }>("POST", `/games/${seg(gameId)}/sessions`, input)).session,
		listSessions: async (params, opts) =>
			(
				await get<{ sessions: AdminSessionSummary[] }>("/sessions", opts, {
					status: params.status?.join(",") || undefined,
				})
			).sessions,
		getSession: async (id, opts) => (await get<{ session: HostSessionDetail }>(`/sessions/${seg(id)}`, opts)).session,
		startSession: async (id) => (await send<{ session: HostSessionDetail }>("POST", `/sessions/${seg(id)}/start`)).session,
		endSession: async (id) => (await send<{ session: HostSessionDetail }>("POST", `/sessions/${seg(id)}/end`)).session,
		getSessionLeaderboard: async (id, opts) =>
			(await get<{ leaderboard: Leaderboard }>(`/sessions/${seg(id)}/leaderboard`, opts)).leaderboard,
		getSessionParticipants: async (id, opts) =>
			(await get<{ participants: HostParticipant[] }>(`/sessions/${seg(id)}/participants`, opts)).participants,
	};
}
