// Every call the public (no login) Fun Games screens make. Screens depend on the
// `ParticipantApi` interface; `getParticipantApi()` picks HTTP or the mock.

import type {
	AnswerSubmission,
	Id,
	JoinInput,
	JoinLookup,
	JoinResult,
	Leaderboard,
	PersonalResult,
	PlayerProgress,
	SessionState,
	SubmitResult,
} from "../types";
import { funGamesRequest } from "./http";

export interface RequestOptions {
	signal?: AbortSignal;
}

/** Calls made after joining carry the participant's token. */
export interface ParticipantAuth {
	sessionId: Id;
	token: string;
}

export interface ParticipantApi {
	/** Game details and session status for a join code (from the QR). */
	lookup(joinCode: string, opts?: RequestOptions): Promise<JoinLookup>;
	/** Same email again resumes the same player with a fresh token. */
	join(joinCode: string, input: JoinInput): Promise<JoinResult>;
	getState(auth: ParticipantAuth, opts?: RequestOptions): Promise<SessionState>;
	/** The question on the player's screen now (the server opens it on first request), or that they're done. */
	getCurrent(auth: ParticipantAuth, opts?: RequestOptions): Promise<PlayerProgress>;
	/** Answer, or skip with `optionId: null`; returns the next question straight away. */
	submitAnswer(auth: ParticipantAuth, submission: AnswerSubmission): Promise<SubmitResult>;
	getMyResult(auth: ParticipantAuth, opts?: RequestOptions): Promise<PersonalResult>;
	getLeaderboard(auth: ParticipantAuth, opts?: RequestOptions): Promise<Leaderboard>;
}

const seg = encodeURIComponent;

export function createHttpParticipantApi(): ParticipantApi {
	const asParticipant = <T>(
		auth: ParticipantAuth,
		method: "GET" | "POST",
		path: string,
		opts?: RequestOptions & { data?: unknown },
	) =>
		funGamesRequest<T>({
			method,
			url: `/sessions/${seg(auth.sessionId)}${path}`,
			data: opts?.data,
			signal: opts?.signal,
			participantToken: auth.token,
		});

	return {
		lookup: (joinCode, opts) =>
			funGamesRequest<JoinLookup>({ method: "GET", url: `/join/${seg(joinCode)}`, signal: opts?.signal }),
		join: (joinCode, input) =>
			funGamesRequest<JoinResult>({ method: "POST", url: `/join/${seg(joinCode)}`, data: input }),
		getState: async (auth, opts) =>
			(await asParticipant<{ session: SessionState }>(auth, "GET", "/state", opts)).session,
		getCurrent: async (auth, opts) =>
			(await asParticipant<{ progress: PlayerProgress }>(auth, "GET", "/current", opts)).progress,
		submitAnswer: (auth, submission) =>
			asParticipant<SubmitResult>(auth, "POST", "/answers", { data: submission }),
		getMyResult: async (auth, opts) =>
			(await asParticipant<{ result: PersonalResult }>(auth, "GET", "/results/me", opts)).result,
		getLeaderboard: async (auth, opts) =>
			(await asParticipant<{ leaderboard: Leaderboard }>(auth, "GET", "/leaderboard", opts)).leaderboard,
	};
}
