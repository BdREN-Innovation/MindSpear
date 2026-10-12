import { FunGamesApiError, statusToCode } from "../api/http";
import type { HostApi } from "../api/hostApi";
import type { ParticipantApi, RequestOptions } from "../api/participantApi";
import { serverClock } from "../lib/serverClock";
import { installMockControls } from "./controls";
import { MockHttpError, getMockServer } from "./server";

const wait = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (signal?.aborted) return reject(new FunGamesApiError("aborted"));
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(new FunGamesApiError("aborted"));
		});
	});

/** Simulates a round trip: half the latency out, run on the "server", half back. */
async function call<T>(handler: () => T, opts?: RequestOptions): Promise<T> {
	const server = getMockServer();
	const sentAt = Date.now();
	const latency = 120 + Math.random() * 280;
	await wait(latency / 2, opts?.signal);
	if (server.networkDown) throw new FunGamesApiError("network");

	let result: T;
	try {
		result = structuredClone(handler());
	} catch (error) {
		if (error instanceof MockHttpError) {
			const firstField = error.fields ? Object.values(error.fields)[0]?.[0] : undefined;
			throw new FunGamesApiError(
				statusToCode(error.status),
				firstField ?? error.message,
				error.status,
				error.fields,
				error.details,
			);
		}
		throw error;
	}
	const serverTime = server.iso(server.now())!;
	await wait(latency / 2, opts?.signal);
	serverClock.sampleRequest(serverTime, sentAt, Date.now());
	return result;
}

function announce() {
	installMockControls(getMockServer());
	console.info(
		"[fun-games] Using the mock backend (NEXT_PUBLIC_FUN_GAMES_MOCK=1). Join codes: GNETWK6 (per-question, speed points), " +
			"GSCHED7 (total timer, marks), GAGLE25 (lobby, starts in 1 min). Try window.__quizMock.help().",
	);
}

export function createMockParticipantApi(): ParticipantApi {
	const server = getMockServer();
	announce();
	return {
		lookup: (joinCode, opts) => call(() => server.lookup(joinCode), opts),
		join: (joinCode, input) => call(() => server.join(joinCode, input)),
		getState: (auth, opts) => call(() => server.state(auth.sessionId, auth.token), opts),
		getCurrent: (auth, opts) => call(() => server.current(auth.sessionId, auth.token), opts),
		submitAnswer: (auth, submission) => call(() => server.submit(auth.sessionId, auth.token, submission)),
		getMyResult: (auth, opts) => call(() => server.myResult(auth.sessionId, auth.token), opts),
		getLeaderboard: (auth, opts) =>
			call(() => {
				const { p } = server.resolve(auth.sessionId, auth.token);
				return server.leaderboard(auth.sessionId, false, p.id);
			}, opts),
	};
}

export function createMockHostApi(): HostApi {
	const server = getMockServer();
	announce();
	return {
		listGames: (opts) => call(() => server.hostGames(), opts),
		getGame: (id, opts) => call(() => server.hostGame(id), opts),
		createGame: (input) => call(() => server.hostCreateGame(input)),
		updateGame: (id, input) => call(() => server.hostUpdateGame(id, input)),
		deleteGame: (id) => call(() => server.hostDeleteGame(id)),
		duplicateGame: (id) => call(() => server.hostDuplicate(id)),
		publishGame: (id) => call(() => server.hostPublish(id)),

		createQuestion: (gameId, input) => call(() => server.hostCreateQuestion(gameId, input)),
		updateQuestion: (gameId, questionId, input) => call(() => server.hostUpdateQuestion(gameId, questionId, input)),
		deleteQuestion: (gameId, questionId) => call(() => server.hostDeleteQuestion(gameId, questionId)),
		reorderQuestions: (gameId, ids) => call(() => server.hostReorder(gameId, ids)),

		listLibraryQuizzes: (opts) => call(() => server.libraryQuizzes(), opts),
		previewLibraryQuiz: (quizId, opts) => call(() => server.libraryPreview(quizId), opts),
		createGameFromLibrary: (quizId, timerMode) => call(() => server.createFromLibrary(quizId, timerMode)),
		importDryRun: (gameId, request) => call(() => server.hostImportDryRun(gameId, request)),
		importQuestions: (gameId, request) => call(() => server.hostImport(gameId, request)),
		undoImport: (importId) => call(() => server.hostUndoImport(importId)),

		createSession: (gameId, input) => call(() => server.hostCreateSession(gameId, input.startsAt)),
		listSessions: (params, opts) => call(() => server.hostListSessions(params.status), opts),
		getSession: (id, opts) => call(() => server.hostSession(id), opts),
		startSession: (id) => call(() => server.hostStart(id)),
		endSession: (id) => call(() => server.hostEnd(id)),
		getSessionLeaderboard: (id, opts) => call(() => server.leaderboard(id, true), opts),
		getSessionParticipants: (id, opts) => call(() => server.hostParticipants(id), opts),
	};
}
