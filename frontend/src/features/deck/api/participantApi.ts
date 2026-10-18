import axios, { type AxiosInstance } from "axios";
import { apiConfig } from "@/config/api";
import type {
	AggregateSnapshot,
	AnswerPayload,
	AnswerSlideTypeKey,
	ApiEnvelope,
	DeckProduct,
	JoinSessionInput,
	JoinSessionResult,
	LeaderboardResponse,
	MySubmission,
	ParticipantSessionState,
	QaFeed,
	QaFeedParams,
	QaParticipantItem,
	QaVoteResult,
	ResolvedSessionLookup,
	ReviewState,
	SessionLookup,
	SlideAggregate,
} from "../types";
import { deckRequest, toDeckApiError } from "./errors";
import { DECK_TIMEOUTS, sessionsBase } from "./routes";

// Participant side of a live session (anonymous). Uses its own axios instance:
// no Sanctum Bearer header, no redirect-to-login on 401 (axiosInstance does
// both), and the participant token goes in X-Participant-Token on every token
// route. Backend: routes/deck/{quest,quiz}_{sessions,participants,review}.php
// (+ quest_qa.php). Every function throws DeckApiError.
//
// Every route is product-scoped (a quiz session is 404 on the quest routes and
// vice versa): find the product with lookupSessionByCode(), then keep using
// participantApiFor(product) (store it with the participant session).
//
// Leaving: leave() on "Leave session" and leaveOnPageHide() (keepalive) when
// the page goes away; join() with the device's earlier token rejoins as the
// same participant.
//
// Quiz: answers are scored on submit (still 204, no correctness); my-answer
// adds {is_correct, points_awarded, correct_answer, total_points, rank} once
// the run is revealed; getAggregate is 403 results_hidden until the reveal;
// state adds `quiz` and `standing`; getLeaderboard gives the ranking + `me`.

export const PARTICIPANT_TOKEN_HEADER = "X-Participant-Token";

let client: AxiosInstance | null = null;

/** The shared participant axios instance (base NEXT_PUBLIC_API_BASE_URL, JSON, no auth interceptors). */
export function participantHttp(): AxiosInstance {
	if (!client) {
		client = axios.create({
			baseURL: apiConfig.baseURL,
			headers: { ...apiConfig.jsonHeaders, Accept: "application/json" },
			timeout: DECK_TIMEOUTS.default,
			// Participants are anonymous: never send the host's cookies.
			withCredentials: false,
		});
	}
	return client;
}

const tokenHeader = (token: string) => ({ [PARTICIPANT_TOKEN_HEADER]: token });

type Id = number | string;

export interface ParticipantApi {
	readonly product: DeckProduct;
	/** GET by-code/{code} — live sessions only; case-insensitive, spaces/dashes ignored. 404 otherwise. */
	lookupByCode(code: string, signal?: AbortSignal): Promise<SessionLookup>;
	/**
	 * POST {session}/participants/join — 201. 404 unknown session OR wrong code,
	 * 409 invalid_state {session_status: 'pending'}, 403 forbidden {session_status: 'ended'}, 422.
	 * Same-device rejoin: pass the token this device got for the SAME session earlier
	 * (loadDeviceParticipant); a valid, unrevoked one answers with that same participant
	 * (left_at cleared, points kept, token unchanged) instead of a new row. Any other token is ignored.
	 */
	join(sessionId: Id, input: JoinSessionInput, options?: { token?: string | null }): Promise<JoinSessionResult>;
	/**
	 * POST {session}/participants/leave with the token — the participant leaves the room (left_at):
	 * no longer counted in "x / y answered", auto-reveal or the leaderboard. Joining again from
	 * this device with the same token brings the same participant back.
	 */
	leave(sessionId: Id, token: string): Promise<void>;
	/**
	 * leave() for pagehide: navigator.sendBeacon with the token form-encoded in the body (a beacon
	 * can't set headers; the backend reads `participant_token` from the body), else a keepalive
	 * fetch with the header. Both outlive the page. Best effort, never throws; false when the
	 * browser refused to queue it.
	 */
	leaveOnPageHide(sessionId: Id, token: string): boolean;
	/** GET {session}/state with the token — PARTICIPANT STATE. 401 when the token is invalid/revoked (e.g. after the end). */
	getState(sessionId: Id, token: string, signal?: AbortSignal): Promise<ParticipantSessionState>;
	/**
	 * POST {session}/slide-runs/{run}/answers — 204. 409 invalid_state data.reason =
	 * no_answers | session_not_live | not_current_slide | not_voting | time_up |
	 * already_answered (quiz scored runs: answers are final, the first one and its points stand); 413; 422 answer_payload.*.
	 */
	submitAnswer<K extends AnswerSlideTypeKey = AnswerSlideTypeKey>(
		sessionId: Id,
		runId: Id,
		token: string,
		answerPayload: AnswerPayload<K>
	): Promise<void>;
	/** GET {session}/slide-runs/{run}/my-answer — null when not answered (404). Works with a token the end revoked. */
	getMyAnswer(sessionId: Id, runId: Id, token: string, signal?: AbortSignal): Promise<MySubmission | null>;
	/** GET {session}/slide-runs/{run}/aggregate[?page=N] — 403 results_hidden unless results are public and the host reached the run. */
	getAggregate<A = SlideAggregate>(
		sessionId: Id,
		runId: Id,
		token: string,
		options?: { page?: number; signal?: AbortSignal }
	): Promise<AggregateSnapshot<A>>;
	/** GET {session}/review — ended sessions only (409 reason session_not_ended). */
	getReview(sessionId: Id, token: string, signal?: AbortSignal): Promise<ReviewState>;
	/** GET {session}/slide-runs/{run}/qa/questions — participant feed (no hidden; own_only when the feed is hidden). */
	getQaFeed(
		sessionId: Id,
		runId: Id,
		token: string,
		params?: QaFeedParams,
		signal?: AbortSignal
	): Promise<QaFeed<QaParticipantItem>>;
	/**
	 * POST {session}/slide-runs/{run}/qa/questions {body} — 201. 409 reason not_qa_slide | session_not_live | not_open;
	 * 422 body; 429 too_many_requests (data.retry_after).
	 */
	submitQuestion(sessionId: Id, runId: Id, token: string, body: string): Promise<QaParticipantItem>;
	/** POST {session}/qa/questions/{q}/upvote — idempotent. 404 hidden; 409 not_open. */
	upvote(sessionId: Id, questionId: Id, token: string): Promise<QaVoteResult>;
	/** DELETE {session}/qa/questions/{q}/upvote — idempotent. */
	removeUpvote(sessionId: Id, questionId: Id, token: string): Promise<QaVoteResult>;
	/**
	 * Quiz only: GET {session}/leaderboard?limit=1..100 (default 10) with the token (also after the end) —
	 * top N + `me` (my total_points, rank, points_delta). 401 bad token, 422 limit.
	 */
	getLeaderboard(
		sessionId: Id,
		token: string,
		options?: { limit?: number; signal?: AbortSignal }
	): Promise<LeaderboardResponse>;
}

export function createParticipantApi(product: DeckProduct): ParticipantApi {
	const sessions = sessionsBase(product);
	const sessionUrl = (sessionId: Id) => `${sessions}/${sessionId}`;

	return {
		product,

		lookupByCode: (code, signal) =>
			deckRequest(async () => {
				const res = await participantHttp().get<ApiEnvelope<SessionLookup>>(
					`${sessions}/by-code/${encodeURIComponent(code.trim())}`,
					{ signal }
				);
				return res.data.data;
			}),

		join: (sessionId, input, options = {}) =>
			deckRequest(async () => {
				const res = await participantHttp().post<ApiEnvelope<JoinSessionResult>>(
					`${sessionUrl(sessionId)}/participants/join`,
					input,
					options.token ? { headers: tokenHeader(options.token) } : undefined
				);
				return res.data.data;
			}),

		leave: (sessionId, token) =>
			deckRequest(async () => {
				await participantHttp().post(`${sessionUrl(sessionId)}/participants/leave`, undefined, {
					headers: tokenHeader(token),
				});
			}),

		leaveOnPageHide: (sessionId, token) => {
			const base = (participantHttp().defaults.baseURL ?? "").replace(/\/$/, "");
			const url = `${base}${sessionUrl(sessionId)}/participants/leave`;
			try {
				// A form-encoded beacon is a CORS "simple" request: no preflight to outlive.
				if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
					if (navigator.sendBeacon(url, new URLSearchParams({ participant_token: token }))) return true;
				}
				if (typeof fetch !== "function") return false;
				void fetch(url, {
					method: "POST",
					keepalive: true,
					credentials: "omit",
					headers: { Accept: "application/json", ...tokenHeader(token) },
				}).catch(() => undefined);
				return true;
			} catch {
				return false;
			}
		},

		getState: (sessionId, token, signal) =>
			deckRequest(async () => {
				const res = await participantHttp().get<ApiEnvelope<ParticipantSessionState>>(`${sessionUrl(sessionId)}/state`, {
					headers: tokenHeader(token),
					signal,
				});
				return res.data.data;
			}),

		submitAnswer: (sessionId, runId, token, answerPayload) =>
			deckRequest(async () => {
				await participantHttp().post(
					`${sessionUrl(sessionId)}/slide-runs/${runId}/answers`,
					{ answer_payload: answerPayload },
					{ headers: tokenHeader(token), timeout: DECK_TIMEOUTS.answer }
				);
			}),

		getMyAnswer: async (sessionId, runId, token, signal) => {
			try {
				const res = await participantHttp().get<ApiEnvelope<MySubmission>>(
					`${sessionUrl(sessionId)}/slide-runs/${runId}/my-answer`,
					{ headers: tokenHeader(token), signal }
				);
				return res.data.data;
			} catch (error) {
				const deckError = toDeckApiError(error);
				if (deckError.status === 404) return null;
				throw deckError;
			}
		},

		getAggregate: <A = SlideAggregate>(
			sessionId: Id,
			runId: Id,
			token: string,
			options: { page?: number; signal?: AbortSignal } = {}
		) =>
			deckRequest(async () => {
				const res = await participantHttp().get<ApiEnvelope<AggregateSnapshot<A>>>(
					`${sessionUrl(sessionId)}/slide-runs/${runId}/aggregate`,
					{
						headers: tokenHeader(token),
						params: options.page ? { page: options.page } : undefined,
						signal: options.signal,
					}
				);
				return res.data.data;
			}),

		getReview: (sessionId, token, signal) =>
			deckRequest(async () => {
				const res = await participantHttp().get<ApiEnvelope<ReviewState>>(`${sessionUrl(sessionId)}/review`, {
					headers: tokenHeader(token),
					signal,
					timeout: DECK_TIMEOUTS.review,
				});
				return res.data.data;
			}),

		getQaFeed: (sessionId, runId, token, params = {}, signal) =>
			deckRequest(async () => {
				const res = await participantHttp().get<ApiEnvelope<QaFeed<QaParticipantItem>>>(
					`${sessionUrl(sessionId)}/slide-runs/${runId}/qa/questions`,
					{ headers: tokenHeader(token), params: { sort: params.sort, limit: params.limit }, signal }
				);
				return res.data.data;
			}),

		submitQuestion: (sessionId, runId, token, body) =>
			deckRequest(async () => {
				const res = await participantHttp().post<ApiEnvelope<{ question: QaParticipantItem }>>(
					`${sessionUrl(sessionId)}/slide-runs/${runId}/qa/questions`,
					{ body },
					{ headers: tokenHeader(token) }
				);
				return res.data.data.question;
			}),

		upvote: (sessionId, questionId, token) =>
			deckRequest(async () => {
				const res = await participantHttp().post<ApiEnvelope<QaVoteResult>>(
					`${sessionUrl(sessionId)}/qa/questions/${questionId}/upvote`,
					undefined,
					{ headers: tokenHeader(token) }
				);
				return res.data.data;
			}),

		removeUpvote: (sessionId, questionId, token) =>
			deckRequest(async () => {
				const res = await participantHttp().delete<ApiEnvelope<QaVoteResult>>(
					`${sessionUrl(sessionId)}/qa/questions/${questionId}/upvote`,
					{ headers: tokenHeader(token) }
				);
				return res.data.data;
			}),

		getLeaderboard: (sessionId, token, options = {}) =>
			deckRequest(async () => {
				const res = await participantHttp().get<ApiEnvelope<LeaderboardResponse>>(`${sessionUrl(sessionId)}/leaderboard`, {
					headers: tokenHeader(token),
					params: options.limit ? { limit: options.limit } : undefined,
					signal: options.signal,
				});
				return res.data.data;
			}),
	};
}

/** Quest v2 participant API. */
export const questParticipantApi = createParticipantApi("quest");

/** Quiz v2 participant API (/api/v1/quiz-sessions/v2). */
export const quizParticipantApi = createParticipantApi("quiz");

/** The participant API of a product (shared instances). */
export function participantApiFor(product: DeckProduct): ParticipantApi {
	return product === "quiz" ? quizParticipantApi : questParticipantApi;
}

/**
 * Join-code lookup across products: one request to the product-neutral
 * GET /play/by-code/{code}, which finds a live Quest or Quiz session (join codes
 * are unique across products) and says which product it is. One lookup per join,
 * so quiz joins no longer spend a quest miss against the per-IP 404 limiter.
 * `prefer` is the fallback product if an older backend omits `product`.
 */
export async function lookupSessionByCode(
	code: string,
	options: { signal?: AbortSignal; prefer?: DeckProduct } = {}
): Promise<ResolvedSessionLookup> {
	return deckRequest(async () => {
		const res = await participantHttp().get<ApiEnvelope<SessionLookup>>(
			`/play/by-code/${encodeURIComponent(code.trim())}`,
			{ signal: options.signal }
		);
		const session = res.data.data;
		return { ...session, product: session.product ?? options.prefer ?? "quest" };
	});
}
