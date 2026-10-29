import axiosInstance from "@/utils/axiosInstance";
import type {
	AdvanceInput,
	AggregateSnapshot,
	ApiEnvelope,
	DeckProduct,
	HostSessionState,
	LeaderboardResponse,
	QaFeed,
	QaFeedParams,
	QaHostItem,
	QaModerationFlags,
	SlideAggregate,
} from "../types";
import { deckRequest } from "./errors";
import { authoringBase, DECK_TIMEOUTS, sessionsBase } from "./routes";

// Host side of a live session (Sanctum via axiosInstance; the deck owner only,
// everyone else 404). Backend: routes/deck/sessions.php + qa.php +
// participants.php (aggregate). Responses are snake_case HOST STATE
// (SessionStatePresenter::host). A presenter must NOT send X-Participant-Token:
// on the dual routes (state, aggregate, Q&A feed, leaderboard) that header
// selects the participant view.
//
// Quiz (/quiz-sessions): HOST STATE gains `quiz` {submitted_count, spin,
// leaderboard}; advance takes `reveal`; getLeaderboard reads the ranking. No Q&A routes.

type Id = number | string;

export interface SessionApi {
	readonly product: DeckProduct;
	/**
	 * POST /quests/{deck}/sessions — 201 HOST STATE (snapshots every slide).
	 * 409 conflict with data.session_id when a live session already exists
	 * (resume it with getState), or when the deck has no slides; 422
	 * unsupported_type / slides.{pos}.media* (pin_on_image without an image).
	 */
	startSession(deckId: Id): Promise<HostSessionState>;
	/** GET {session}/state — the full resync snapshot (applies overdue timers first). */
	getState(sessionId: Id, signal?: AbortSignal): Promise<HostSessionState>;
	/**
	 * POST {session}/advance — 409 invalid_state {slide_run_id, state, state_version, requires_force?}
	 * on an illegal transition; resend previous_slide / backwards jump_to with force: true after confirming.
	 * Quiz: `reveal` ends answering (also close_voting); leaving an active quiz run reveals it.
	 */
	advance(sessionId: Id, input: AdvanceInput): Promise<HostSessionState>;
	/** POST {session}/end — closes the active run, revokes every participant token. 409 when already ended. */
	end(sessionId: Id): Promise<HostSessionState>;
	/** GET {session}/slide-runs/{run}/aggregate[?page=N] — always answered for the host. page: open_ended full-text pages (20 a page). */
	getAggregate<A = SlideAggregate>(
		sessionId: Id,
		runId: Id,
		options?: { page?: number; signal?: AbortSignal }
	): Promise<AggregateSnapshot<A>>;
	/** GET {session}/slide-runs/{run}/qa/questions — host feed: starred first, includes hidden. */
	getQaFeed(sessionId: Id, runId: Id, params?: QaFeedParams, signal?: AbortSignal): Promise<QaFeed<QaHostItem>>;
	/** PATCH {session}/qa/questions/{question} — hide / star / mark answered (real booleans). */
	moderateQuestion(sessionId: Id, questionId: Id, flags: QaModerationFlags): Promise<QaHostItem>;
	/**
	 * Quiz only: GET {session}/leaderboard?limit=1..100 (default 10) — top N by total points with
	 * points_delta from the last revealed slide; `me` is null for the host. 422 limit.
	 */
	getLeaderboard(sessionId: Id, options?: { limit?: number; signal?: AbortSignal }): Promise<LeaderboardResponse>;
}

export function createSessionApi(product: DeckProduct): SessionApi {
	const sessions = sessionsBase(product);
	const sessionUrl = (sessionId: Id) => `${sessions}/${sessionId}`;
	const timeout = DECK_TIMEOUTS.default;

	return {
		product,

		startSession: (deckId) =>
			deckRequest(async () => {
				const res = await axiosInstance.post<ApiEnvelope<HostSessionState>>(
					`${authoringBase(product)}/${deckId}/sessions`,
					undefined,
					{ timeout: DECK_TIMEOUTS.sessionStart }
				);
				return res.data.data;
			}),

		getState: (sessionId, signal) =>
			deckRequest(async () => {
				const res = await axiosInstance.get<ApiEnvelope<HostSessionState>>(`${sessionUrl(sessionId)}/state`, {
					signal,
					timeout,
				});
				return res.data.data;
			}),

		advance: (sessionId, input) =>
			deckRequest(async () => {
				const res = await axiosInstance.post<ApiEnvelope<HostSessionState>>(`${sessionUrl(sessionId)}/advance`, input, {
					timeout,
				});
				return res.data.data;
			}),

		end: (sessionId) =>
			deckRequest(async () => {
				const res = await axiosInstance.post<ApiEnvelope<HostSessionState>>(`${sessionUrl(sessionId)}/end`, undefined, {
					timeout,
				});
				return res.data.data;
			}),

		getAggregate: <A = SlideAggregate>(sessionId: Id, runId: Id, options: { page?: number; signal?: AbortSignal } = {}) =>
			deckRequest(async () => {
				const res = await axiosInstance.get<ApiEnvelope<AggregateSnapshot<A>>>(
					`${sessionUrl(sessionId)}/slide-runs/${runId}/aggregate`,
					{ params: options.page ? { page: options.page } : undefined, signal: options.signal, timeout }
				);
				return res.data.data;
			}),

		getQaFeed: (sessionId, runId, params = {}, signal) =>
			deckRequest(async () => {
				const res = await axiosInstance.get<ApiEnvelope<QaFeed<QaHostItem>>>(
					`${sessionUrl(sessionId)}/slide-runs/${runId}/qa/questions`,
					{ params: { sort: params.sort, limit: params.limit }, signal, timeout }
				);
				return res.data.data;
			}),

		moderateQuestion: (sessionId, questionId, flags) =>
			deckRequest(async () => {
				const res = await axiosInstance.patch<ApiEnvelope<{ question: QaHostItem }>>(
					`${sessionUrl(sessionId)}/qa/questions/${questionId}`,
					flags,
					{ timeout }
				);
				return res.data.data.question;
			}),

		getLeaderboard: (sessionId, options = {}) =>
			deckRequest(async () => {
				const res = await axiosInstance.get<ApiEnvelope<LeaderboardResponse>>(`${sessionUrl(sessionId)}/leaderboard`, {
					params: options.limit ? { limit: options.limit } : undefined,
					signal: options.signal,
					timeout,
				});
				return res.data.data;
			}),
	};
}

/** Quest host session API (/api/v1/quest-sessions; start under /api/v1/quests/{deck}/sessions). */
export const questSessionApi = createSessionApi("quest");

/** Quiz host session API (/api/v1/quiz-sessions; start under /api/v1/quizzes/{deck}/sessions). */
export const quizSessionApi = createSessionApi("quiz");

/** The host session API of a product (shared instances). */
export function sessionApiFor(product: DeckProduct): SessionApi {
	return product === "quiz" ? quizSessionApi : questSessionApi;
}
