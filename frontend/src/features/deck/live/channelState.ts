import type {
	DeckHostEvent,
	DeckPublicEvent,
	DeckQaEventPayload,
	DeckSessionState,
	IsoDateTime,
	LeaderboardDeltaEntry,
	LeaderboardEntry,
	ParticipantRunView,
	PresenterRunView,
	QuizSpinResult,
	QuizStanding,
	QuizStatePayload,
	ResultsVisibility,
	RunState,
	SessionStatus,
	SlideAggregate,
	SlideRevealedEvent,
	SlimRunView,
} from "../types";
import { isHostSessionState, isQuizSlideTypeKey, isSlimRunView } from "../types";
import type { DeckApiError } from "../api/errors";

// Pure state for useDeckSessionChannel: how REST snapshots and channel events
// merge. Kept apart from the hook so the rules are easy to read and test.
//
// state_version is PER RUN (it restarts at 0 on every run), so staleness is
// judged against the current run only:
// - events for another run are ignored (the run we left closes before
//   slide.changed for the next one is sent);
// - an event with a lower version than the one held is dropped;
// - an equal version is merged (slide.changed is followed by a
//   slide.state.changed with the same version that adds the timer fields);
// - a jump of more than one version is applied and triggers a resync.
//
// Results visibility follows the backend rule (LiveAggregateService::
// resultsVisibility): public only for a live_aggregate type whose slide turned
// on show_results_to_participants. It is derived from the run on every
// slide.changed (the participant state is not re-read on each slide), and an
// aggregate arriving on the public channel proves it is public.
//
// Aggregates only move forward: within one run + state_version, a snapshot or
// event older than the held aggregate (server_time, else total_responses) is
// dropped, so a slow REST read can't make the chart jump back.
//
// Quiz sessions (`quiz` stays null for Quest, so nothing below runs there):
// - state `quiz` / `standing` and the quiz events fill ChannelState.quiz /
//   .standing; slide.changed starts a fresh quiz block for the new run;
// - slide.submitted_count.updated: the "N answered" count (only grows per run);
//   the participant state's quiz.participant_count seeds the room size after a reload;
// - slide.revealed: run → reveal, its aggregate (with `correct`) becomes the
//   held aggregate and results turn public; leaderboard_delta is kept and my
//   own row updates `standing`; refetch:true (no aggregate) asks for a resync;
// - spin.started: the wheel's target (+ voting timer when the state event was
//   missed); slide.revealed / state reveal marks it landed;
// - leaderboard.updated: the leaderboard slide's rows; refetch:true → resync.
// Event-driven resyncs go through resyncRequests, which the hook jitters for
// participants exactly like the slim slide.changed path.
//
// Scored quiz runs hide their options from participants while waiting /
// get_ready (run `options_hidden: true`, `options: []`). When such a run
// enters voting (or later) the phone has to read its own state for them
// (every phone has its own option order): optionsRequests is bumped, and the
// hook reads at once with only a short spread, since answering time counts.

export type DeckConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";

/** The current run's state machine position + timer, from state payloads and slide.* events. */
export interface RunStateInfo {
	slide_run_id: number;
	state: RunState;
	state_version: number;
	seconds_remaining: number | null;
	ends_at: IsoDateTime | null;
	duration_seconds: number | null;
	state_started_at: IsoDateTime | null;
	voting_started_at: IsoDateTime | null;
	closed_at: IsoDateTime | null;
	server_time: IsoDateTime | null;
}

export type DeckChannelEvent =
	| { channel: "public"; event: DeckPublicEvent }
	| { channel: "host"; event: DeckHostEvent };

export interface DeckQaEvent {
	/** Increases by one per Q&A event; process events with seq > the last one you handled. */
	seq: number;
	channel: "public" | "host";
	event: DeckQaEventPayload;
}

/** spinner_wheel: where the wheel lands and how long it turns. */
export interface QuizSpinState extends QuizSpinResult {
	slide_run_id: number;
	/** spin.started (or the voting timer of a resync while spinning); null when unknown / already landed. */
	duration_seconds: number | null;
	ends_at: IsoDateTime | null;
	/** The run revealed: the wheel rests on option_id (no animation needed). */
	landed: boolean;
}

/** Quiz extras of the current run (null for Quest sessions). snake_case like the payloads it mirrors. */
export interface QuizLiveState {
	/** The run these values belong to (null before any run). */
	slide_run_id: number | null;
	/** Answers on the run (public count; the host aggregate has the details). */
	submitted_count: number;
	/** Participants in the room, as last reported (submitted-count events, host state, participant.count.updated). */
	participant_count: number | null;
	spin: QuizSpinState | null;
	/** Leaderboard slide rows (leaderboard.updated / state quiz.leaderboard); null on other runs. */
	leaderboard: LeaderboardEntry[] | null;
	/** Rows the leaderboard slide asked for (leaderboard.updated top_n); null when unknown. */
	leaderboard_top_n: number | null;
	/** slide.revealed movement of this run (best new_rank first, ≤ 10); null until revealed live. */
	leaderboard_delta: LeaderboardDeltaEntry[] | null;
	/** More participants scored than leaderboard_delta lists. */
	leaderboard_truncated: boolean;
}

export interface ChannelState<S extends DeckSessionState = DeckSessionState> {
	status: DeckConnectionStatus;
	sessionStatus: SessionStatus | null;
	/** The current run (participant view; a host's presenter view minus nothing — it may carry `aggregate`). */
	currentRun: ParticipantRunView | PresenterRunView | null;
	/** Set when slide.changed came slim (refetch: true) and the full run is being fetched. */
	slimRun: SlimRunView | null;
	runState: RunStateInfo | null;
	/** Latest aggregate of the current run (null when none / not visible to this viewer). */
	aggregate: SlideAggregate | null;
	/** Where `aggregate` came from, to keep newer results when an older copy arrives late. */
	aggregateMeta: AggregateMeta | null;
	resultsVisibility: ResultsVisibility | null;
	participantCount: number | null;
	totalSlides: number | null;
	/** Bounded log of Q&A events (last QA_EVENT_LIMIT). */
	qaEvents: DeckQaEvent[];
	qaSeq: number;
	lastEvent: DeckChannelEvent | null;
	/** Last full state from the state endpoint (host or participant shape). */
	latestState: S | null;
	/** Bumped on every slide.changed; a resync that started under an older epoch may be stale. */
	epoch: number;
	/** Bumped when the reducer wants a resync (gap, slim slide, unknown run). */
	resyncRequests: number;
	/** Bumped when a run whose options were hidden (options_hidden) opened for answers: read state now. */
	optionsRequests: number;
	isResyncing: boolean;
	error: DeckApiError | null;
	/** Date.now() of the last applied snapshot. */
	lastSyncedAt: number | null;
	/** Quiz sessions: the current run's quiz extras; null for Quest. */
	quiz: QuizLiveState | null;
	/** Quiz participant: my total points and rank (state `standing`, my row of slide.revealed, noteStanding). */
	standing: QuizStanding | null;
}

export const QA_EVENT_LIMIT = 200;

export interface AggregateMeta {
	runId: number;
	stateVersion: number;
	totalResponses: number | null;
	/** Epoch ms of the payload's server_time (null when unknown). */
	serverTime: number | null;
}

export type ChannelAction<S extends DeckSessionState> =
	| { type: "status"; status: DeckConnectionStatus }
	| { type: "resync_started" }
	| { type: "resync_failed"; error: DeckApiError }
	| { type: "snapshot"; snapshot: S; requestEpoch: number }
	| { type: "public_event"; event: DeckPublicEvent; resyncOnSlideChange: boolean }
	| { type: "host_event"; event: DeckHostEvent }
	/** A standing read elsewhere (my-answer total_points / rank, GET leaderboard `me`). */
	| { type: "standing"; standing: QuizStanding };

export function initialChannelState<S extends DeckSessionState>(snapshot?: S | null): ChannelState<S> {
	const base: ChannelState<S> = {
		status: "idle",
		sessionStatus: null,
		currentRun: null,
		slimRun: null,
		runState: null,
		aggregate: null,
		aggregateMeta: null,
		resultsVisibility: null,
		participantCount: null,
		totalSlides: null,
		qaEvents: [],
		qaSeq: 0,
		lastEvent: null,
		latestState: null,
		epoch: 0,
		resyncRequests: 0,
		optionsRequests: 0,
		isResyncing: false,
		error: null,
		lastSyncedAt: null,
		quiz: null,
		standing: null,
	};
	return snapshot ? applySnapshot(base, snapshot, 0) : base;
}

/** A fresh quiz block for run `runId`. */
export function emptyQuizState(runId: number | null, participantCount: number | null = null): QuizLiveState {
	return {
		slide_run_id: runId,
		submitted_count: 0,
		participant_count: participantCount,
		spin: null,
		leaderboard: null,
		leaderboard_top_n: null,
		leaderboard_delta: null,
		leaderboard_truncated: false,
	};
}

/** The held quiz block when it is for `runId`, else a fresh one (carrying the last participant count). */
function quizFor<S extends DeckSessionState>(state: ChannelState<S>, runId: number): QuizLiveState {
	if (state.quiz && state.quiz.slide_run_id === runId) return state.quiz;
	return emptyQuizState(runId, state.quiz?.participant_count ?? state.participantCount);
}

/** My participant id: from my standing, else the participant state. null for the host. */
function myParticipantId<S extends DeckSessionState>(state: ChannelState<S>): number | null {
	if (state.standing) return state.standing.participant_id;
	const latest = state.latestState as { participant?: { id?: unknown } } | null;
	return typeof latest?.participant?.id === "number" ? latest.participant.id : null;
}

function runStateFromRun(
	run: ParticipantRunView | SlimRunView,
	timer?: Partial<RunStateInfo> | null,
	serverTime?: IsoDateTime | null
): RunStateInfo {
	const full = isSlimRunView(run) ? null : run;
	return {
		slide_run_id: run.id,
		state: run.state,
		state_version: run.state_version,
		seconds_remaining: timer?.seconds_remaining ?? null,
		ends_at: timer?.ends_at ?? null,
		duration_seconds: timer?.duration_seconds ?? null,
		state_started_at: full?.state_started_at ?? null,
		voting_started_at: full?.voting_started_at ?? null,
		closed_at: full?.closed_at ?? null,
		server_time: serverTime ?? null,
	};
}

function currentRunId(state: ChannelState<DeckSessionState>): number | null {
	return state.currentRun?.id ?? state.slimRun?.id ?? null;
}

/** States in which a participant view of a scored quiz run carries no options (backend OPTIONS_HIDDEN_STATES). */
function hidesOptions(runState: RunState): boolean {
	return runState === "waiting" || runState === "get_ready";
}

/** The held run still has its options hidden but has moved past get_ready: its options must be read. */
function needsOptions(run: ParticipantRunView | PresenterRunView | null, runState: RunState): boolean {
	return !!run && (run as { options_hidden?: unknown }).options_hidden === true && !hidesOptions(runState);
}

/**
 * Who may see a run's results, from the run itself (same rule as the backend).
 * null for a slim live_aggregate run: its config is unknown until the refetch.
 * A revealed (quiz / spinner) run is public.
 */
export function runResultsVisibility(run: ParticipantRunView | SlimRunView | null | undefined): ResultsVisibility | null {
	if (!run) return null;
	if (run.state === "reveal") return "public";
	if (run.reveal_model !== "live_aggregate") return "host";
	if (isSlimRunView(run)) return null;
	const config = run.config as { show_results_to_participants?: unknown } | null;
	return config?.show_results_to_participants === true ? "public" : "host";
}

function parseTime(value: IsoDateTime | null | undefined): number | null {
	if (!value) return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function totalOf(aggregate: SlideAggregate | null | undefined): number | null {
	const total = (aggregate as { total_responses?: unknown } | null | undefined)?.total_responses;
	return typeof total === "number" ? total : null;
}

/** True when `incoming` may replace the held aggregate (newer, or nothing comparable is held). */
export function isNewerAggregate(held: AggregateMeta | null, incoming: AggregateMeta): boolean {
	if (!held || held.runId !== incoming.runId) return true;
	if (incoming.stateVersion !== held.stateVersion) return incoming.stateVersion > held.stateVersion;
	// Same run + version: server_time orders them (one server clock). Without it,
	// fall back to the response count, which only grows while a run is open.
	if (held.serverTime !== null && incoming.serverTime !== null) return incoming.serverTime >= held.serverTime;
	if (held.totalResponses !== null && incoming.totalResponses !== null) {
		return incoming.totalResponses >= held.totalResponses;
	}
	return true;
}

export function applySnapshot<S extends DeckSessionState>(
	state: ChannelState<S>,
	snapshot: S,
	requestEpoch: number
): ChannelState<S> {
	const run = snapshot.current_run;
	const heldId = currentRunId(state as ChannelState<DeckSessionState>);
	const heldVersion = state.runState?.state_version ?? -1;

	// A slide.changed landed while this request was in flight: the event is newer.
	if (requestEpoch !== state.epoch && run?.id !== heldId) {
		return { ...state, isResyncing: false };
	}
	// Same run but an older state than the events already applied.
	if (run && run.id === heldId && run.state_version < heldVersion) {
		return { ...state, isResyncing: false, latestState: snapshot, lastSyncedAt: Date.now() };
	}

	const host = isHostSessionState(snapshot);
	const incoming: SlideAggregate | null = host
		? ((snapshot.current_run as PresenterRunView | null)?.aggregate ?? null)
		: snapshot.aggregate;
	const incomingMeta: AggregateMeta | null =
		run && incoming
			? {
					runId: run.id,
					stateVersion: run.state_version,
					totalResponses: totalOf(incoming),
					serverTime: parseTime(snapshot.server_time),
				}
			: null;
	// A held aggregate of the same run that is newer than this read (an event
	// landed while the request was in flight) wins over the snapshot's copy.
	const keepHeld =
		!!incomingMeta && !!state.aggregate && !isNewerAggregate(state.aggregateMeta, incomingMeta);
	const aggregate = keepHeld ? state.aggregate : incoming;
	const aggregateMeta = keepHeld ? state.aggregateMeta : incomingMeta;

	// Quiz sessions only: Quest snapshots have no `quiz` key and leave it null.
	const quizPayload = (snapshot as { quiz?: QuizStatePayload }).quiz;
	const quiz = quizPayload
		? quizFromSnapshot(state, snapshot, quizPayload, host)
		: state.quiz;
	const standing = (snapshot as { standing?: QuizStanding }).standing ?? state.standing;

	return {
		...state,
		sessionStatus: snapshot.session.status,
		currentRun: run,
		slimRun: null,
		runState: run
			? {
					...runStateFromRun(run, snapshot, snapshot.server_time),
					seconds_remaining: snapshot.seconds_remaining,
					ends_at: snapshot.ends_at,
					duration_seconds: snapshot.duration_seconds,
				}
			: null,
		aggregate,
		aggregateMeta,
		resultsVisibility: snapshot.results_visibility ?? runResultsVisibility(run),
		participantCount: host ? snapshot.participant_count : (quizPayload?.participant_count ?? state.participantCount),
		totalSlides: snapshot.session.total_slides,
		latestState: snapshot,
		isResyncing: false,
		error: null,
		lastSyncedAt: Date.now(),
		quiz,
		standing,
	};
}

/**
 * The quiz block of a state snapshot. Within the same run the submitted count
 * only grows (an event may have landed while the read was in flight) and the
 * live reveal delta is kept (the state endpoint does not carry it).
 */
function quizFromSnapshot<S extends DeckSessionState>(
	state: ChannelState<S>,
	snapshot: S,
	payload: QuizStatePayload,
	host: boolean
): QuizLiveState {
	const run = snapshot.current_run;
	const runId = run?.id ?? null;
	const held = state.quiz && state.quiz.slide_run_id === runId ? state.quiz : null;
	const spinning = run?.state === "voting";
	// Host: the top-level count. Participant: quiz.participant_count (so a reloaded
	// phone shows "x / y answered" before the next submitted-count event).
	const participantCount = host
		? ((snapshot as { participant_count?: number }).participant_count ?? null)
		: (payload.participant_count ?? state.participantCount ?? state.quiz?.participant_count ?? null);

	return {
		slide_run_id: runId,
		submitted_count: Math.max(held?.submitted_count ?? 0, payload.submitted_count ?? 0),
		participant_count: participantCount,
		spin:
			payload.spin && runId !== null
				? {
						option_id: payload.spin.option_id,
						target_angle: payload.spin.target_angle,
						slide_run_id: runId,
						duration_seconds: spinning ? snapshot.duration_seconds : (held?.spin?.duration_seconds ?? null),
						ends_at: spinning ? snapshot.ends_at : (held?.spin?.ends_at ?? null),
						landed: run?.state === "reveal",
					}
				: null,
		leaderboard: payload.leaderboard ?? null,
		leaderboard_top_n: payload.leaderboard ? (held?.leaderboard_top_n ?? null) : null,
		leaderboard_delta: held?.leaderboard_delta ?? null,
		leaderboard_truncated: held?.leaderboard_truncated ?? false,
	};
}

function pushQa<S extends DeckSessionState>(
	state: ChannelState<S>,
	channel: "public" | "host",
	event: DeckQaEventPayload
): ChannelState<S> {
	const seq = state.qaSeq + 1;
	const qaEvents = [...state.qaEvents, { seq, channel, event }];
	return {
		...state,
		qaSeq: seq,
		qaEvents: qaEvents.length > QA_EVENT_LIMIT ? qaEvents.slice(-QA_EVENT_LIMIT) : qaEvents,
	};
}

/**
 * slide.aggregate.updated (either channel) or the final aggregate of slide.closed.
 * `visibility` is what the channel proves: an aggregate on the public channel
 * is public; host-channel copies leave the visibility alone.
 */
function applyAggregate<S extends DeckSessionState>(
	state: ChannelState<S>,
	event: {
		slide_run_id: number;
		state_version: number;
		total_responses: number | null;
		aggregate: SlideAggregate;
		server_time?: IsoDateTime | null;
	},
	visibility: ResultsVisibility | null
): ChannelState<S> {
	const runId = event.slide_run_id;
	const version = event.state_version;
	if (runId !== currentRunId(state as ChannelState<DeckSessionState>)) return state;
	const held = state.runState?.state_version ?? -1;
	if (version < held) return state;
	const meta: AggregateMeta = {
		runId,
		stateVersion: version,
		totalResponses: event.total_responses ?? totalOf(event.aggregate),
		serverTime: parseTime(event.server_time),
	};
	const resyncRequests = version > held + 1 ? state.resyncRequests + 1 : state.resyncRequests;
	if (state.aggregate && !isNewerAggregate(state.aggregateMeta, meta)) {
		return { ...state, resultsVisibility: visibility ?? state.resultsVisibility, resyncRequests };
	}
	return {
		...state,
		aggregate: event.aggregate,
		aggregateMeta: meta,
		resultsVisibility: visibility ?? state.resultsVisibility,
		resyncRequests,
	};
}

/**
 * slide.revealed: the run reached `reveal` (slide.state.changed → reveal normally
 * came first with the same version). The aggregate (with `correct`) is public
 * from here on; a slim event (refetch, aggregate null) asks for a resync.
 */
function applyRevealed<S extends DeckSessionState>(
	next: ChannelState<S>,
	state: ChannelState<S>,
	event: SlideRevealedEvent
): ChannelState<S> {
	const heldId = currentRunId(next as ChannelState<DeckSessionState>);
	if (heldId === null) return { ...next, resyncRequests: state.resyncRequests + 1 };
	if (event.slide_run_id !== heldId) return next;
	const held = state.runState?.state_version ?? -1;
	if (event.state_version < held) return next;

	const base = state.runState ?? runStateFromRun(state.currentRun ?? state.slimRun!);
	const runState: RunStateInfo = {
		...base,
		slide_run_id: event.slide_run_id,
		state: "reveal",
		state_version: event.state_version,
		seconds_remaining: null,
		ends_at: null,
		duration_seconds: null,
		closed_at: event.closed_at,
		server_time: event.server_time,
	};
	const currentRun = state.currentRun
		? ({
				...state.currentRun,
				state: "reveal",
				state_version: event.state_version,
				closed_at: event.closed_at,
			} as ParticipantRunView)
		: null;

	const quiz = quizFor(state, event.slide_run_id);
	const heldSpin = quiz.spin && quiz.spin.slide_run_id === event.slide_run_id ? quiz.spin : null;
	const spin = event.spin
		? {
				slide_run_id: event.slide_run_id,
				option_id: event.spin.option_id,
				target_angle: event.spin.target_angle,
				duration_seconds: heldSpin?.duration_seconds ?? null,
				ends_at: heldSpin?.ends_at ?? null,
				landed: true,
			}
		: heldSpin
			? { ...heldSpin, landed: true }
			: null;
	const delta = Array.isArray(event.leaderboard_delta) ? event.leaderboard_delta : [];
	const me = myParticipantId(state);
	const mine = me === null ? undefined : delta.find((row) => row.participant_id === me);

	const moved: ChannelState<S> = {
		...next,
		currentRun,
		runState,
		resultsVisibility: "public",
		// A gap, or the voting transition was missed and the run still has no options to show.
		resyncRequests:
			event.state_version > held + 1 || needsOptions(state.currentRun, "reveal")
				? state.resyncRequests + 1
				: state.resyncRequests,
		quiz: {
			...quiz,
			spin,
			leaderboard_delta: delta,
			leaderboard_truncated: !!event.leaderboard_truncated,
		},
		standing:
			mine && me !== null
				? { participant_id: me, total_points: mine.new_total, rank: mine.new_rank, points_delta: mine.points_delta }
				: state.standing,
	};

	if (!event.aggregate || event.refetch) {
		return { ...moved, resyncRequests: moved.resyncRequests + 1 };
	}
	return applyAggregate(
		moved,
		{
			slide_run_id: event.slide_run_id,
			state_version: event.state_version,
			total_responses: totalOf(event.aggregate),
			aggregate: event.aggregate,
			server_time: event.server_time,
		},
		"public"
	);
}

export function channelReducer<S extends DeckSessionState>(
	state: ChannelState<S>,
	action: ChannelAction<S>
): ChannelState<S> {
	switch (action.type) {
		case "status":
			return state.status === action.status ? state : { ...state, status: action.status };

		case "resync_started":
			return state.isResyncing ? state : { ...state, isResyncing: true };

		case "resync_failed":
			return { ...state, isResyncing: false, error: action.error };

		case "snapshot":
			return applySnapshot(state, action.snapshot, action.requestEpoch);

		case "standing":
			return { ...state, standing: action.standing };

		case "host_event": {
			const event = action.event;
			const next = { ...state, lastEvent: { channel: "host" as const, event } };
			if (event.event === "slide.aggregate.updated") {
				return applyAggregate(next, event, null);
			}
			if (event.event.startsWith("qa.question.")) {
				return pushQa(next, "host", event as DeckQaEventPayload);
			}
			return next;
		}

		case "public_event": {
			const event = action.event;
			const next: ChannelState<S> = { ...state, lastEvent: { channel: "public", event } };

			switch (event.event) {
				case "slide.changed": {
					const slide = event.slide;
					const slim = isSlimRunView(slide);
					// A run that arrives past `waiting` was visited before (the host went
					// back): read state once for its results and my earlier answer.
					const revisited = slide.state !== "waiting";
					return {
						...next,
						epoch: state.epoch + 1,
						sessionStatus: state.sessionStatus === "ended" ? "ended" : "live",
						currentRun: slim ? null : slide,
						slimRun: slim ? slide : null,
						runState: runStateFromRun(slide, null, event.server_time),
						aggregate: null,
						aggregateMeta: null,
						resultsVisibility: runResultsVisibility(slide),
						totalSlides: event.total_slides ?? state.totalSlides,
						resyncRequests:
							slim || revisited || action.resyncOnSlideChange
								? state.resyncRequests + 1
								: state.resyncRequests,
						// Quiz sessions: a fresh block for the new run (a revisited run's
						// count / spin / rows come with the resync above).
						quiz:
							state.quiz || isQuizSlideTypeKey(slide.type)
								? emptyQuizState(slide.id, state.quiz?.participant_count ?? state.participantCount)
								: null,
					};
				}

				case "slide.state.changed":
				case "slide.closed": {
					const heldId = currentRunId(next as ChannelState<DeckSessionState>);
					if (heldId === null) return { ...next, resyncRequests: state.resyncRequests + 1 };
					if (event.slide_run_id !== heldId) return next;

					const held = state.runState?.state_version ?? -1;
					if (event.state_version < held) return next;

					const closed = event.event === "slide.closed";
					const runState: RunStateInfo = closed
						? {
								...(state.runState ?? runStateFromRun(state.currentRun ?? state.slimRun!)),
								state: "closed",
								state_version: event.state_version,
								seconds_remaining: null,
								ends_at: null,
								duration_seconds: null,
								closed_at: event.closed_at,
								server_time: event.server_time,
							}
						: {
								slide_run_id: event.slide_run_id,
								state: event.state,
								state_version: event.state_version,
								seconds_remaining: event.seconds_remaining,
								ends_at: event.ends_at,
								duration_seconds: event.duration_seconds,
								state_started_at: event.state_started_at,
								voting_started_at: event.voting_started_at,
								closed_at: event.closed_at,
								server_time: event.server_time,
							};

					const currentRun = state.currentRun
						? ({
								...state.currentRun,
								state: runState.state,
								state_version: runState.state_version,
								state_started_at: runState.state_started_at,
								voting_started_at: runState.voting_started_at,
								closed_at: runState.closed_at,
							} as ParticipantRunView)
						: null;

					const moved: ChannelState<S> = {
						...next,
						currentRun,
						runState,
						resyncRequests: event.state_version > held + 1 ? state.resyncRequests + 1 : state.resyncRequests,
						// Answering opened on a quiz run whose options were hidden: read them now.
						optionsRequests:
							!closed && needsOptions(state.currentRun, runState.state) ? state.optionsRequests + 1 : state.optionsRequests,
						// A spinner that reached reveal rests on its option (slide.revealed follows).
						quiz:
							runState.state === "reveal" && state.quiz?.spin && state.quiz.spin.slide_run_id === event.slide_run_id
								? { ...state.quiz, spin: { ...state.quiz.spin, landed: true } }
								: state.quiz,
					};
					if (!closed) return moved;
					// slide.closed carries the final aggregate only when participants may
					// see it; null means the results stay on the host's screen.
					if (event.aggregate) {
						return applyAggregate(
							moved,
							{
								slide_run_id: event.slide_run_id,
								state_version: event.state_version,
								total_responses: event.total_responses,
								aggregate: event.aggregate,
								server_time: event.server_time,
							},
							"public"
						);
					}
					return { ...moved, resultsVisibility: "host" };
				}

				case "slide.aggregate.updated":
					return applyAggregate(next, event, "public");

				case "participant.count.updated":
					return {
						...next,
						participantCount: event.participant_count,
						quiz: state.quiz ? { ...state.quiz, participant_count: event.participant_count } : null,
					};

				case "slide.submitted_count.updated": {
					if (event.slide_run_id !== currentRunId(next as ChannelState<DeckSessionState>)) return next;
					const quiz = quizFor(state, event.slide_run_id);
					return {
						...next,
						participantCount: event.participant_count,
						quiz: {
							...quiz,
							// Answers are never withdrawn: a late (debounced) copy can't lower the count.
							submitted_count: Math.max(quiz.submitted_count, event.submitted_count),
							participant_count: event.participant_count,
						},
					};
				}

				case "slide.revealed":
					return applyRevealed(next, state, event);

				case "spin.started": {
					const heldId = currentRunId(next as ChannelState<DeckSessionState>);
					if (heldId === null) return { ...next, resyncRequests: state.resyncRequests + 1 };
					if (event.slide_run_id !== heldId) return next;
					const held = state.runState?.state_version ?? -1;
					if (event.state_version < held) return next;

					// Normally slide.state.changed → voting (same version) came first; if it
					// was missed, the spin event carries enough to run the timer.
					const base = state.runState ?? runStateFromRun(state.currentRun ?? state.slimRun!);
					const runState: RunStateInfo =
						event.state_version > held
							? {
									...base,
									slide_run_id: event.slide_run_id,
									state: "voting",
									state_version: event.state_version,
									seconds_remaining: null,
									ends_at: event.ends_at,
									duration_seconds: event.duration_seconds,
									server_time: event.server_time,
								}
							: base;
					const currentRun =
						state.currentRun && event.state_version > held
							? ({ ...state.currentRun, state: "voting", state_version: event.state_version } as ParticipantRunView)
							: state.currentRun;
					return {
						...next,
						currentRun,
						runState,
						resyncRequests: event.state_version > held + 1 ? state.resyncRequests + 1 : state.resyncRequests,
						quiz: {
							...quizFor(state, event.slide_run_id),
							spin: {
								slide_run_id: event.slide_run_id,
								option_id: event.option_id,
								target_angle: event.target_angle,
								duration_seconds: event.duration_seconds,
								ends_at: event.ends_at,
								landed: false,
							},
						},
					};
				}

				case "leaderboard.updated": {
					const heldId = currentRunId(next as ChannelState<DeckSessionState>);
					if (heldId === null) return { ...next, resyncRequests: state.resyncRequests + 1 };
					if (event.slide_run_id !== heldId) return next;
					const quiz = quizFor(state, event.slide_run_id);
					return {
						...next,
						quiz: {
							...quiz,
							leaderboard: event.leaderboard ?? quiz.leaderboard,
							leaderboard_top_n: event.top_n,
						},
						// Too large for one publish: the state read brings quiz.leaderboard.
						resyncRequests: event.refetch || !event.leaderboard ? state.resyncRequests + 1 : state.resyncRequests,
					};
				}

				case "session.ended":
					return {
						...next,
						sessionStatus: "ended",
						runState: state.runState
							? { ...state.runState, seconds_remaining: null, ends_at: null, duration_seconds: null }
							: null,
					};

				case "qa.question.submitted":
				case "qa.question.upvoted":
				case "qa.question.moderated":
					return pushQa(next, "public", event);

				default:
					return next;
			}
		}

		default:
			return state;
	}
}
