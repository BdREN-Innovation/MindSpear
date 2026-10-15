import type {
	DeckHostEvent,
	DeckPublicEvent,
	DeckQaEventPayload,
	DeckSessionState,
	IsoDateTime,
	ParticipantRunView,
	PresenterRunView,
	ResultsVisibility,
	RunState,
	SessionStatus,
	SlideAggregate,
	SlimRunView,
} from "../types";
import { isHostSessionState, isSlimRunView } from "../types";
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
	isResyncing: boolean;
	error: DeckApiError | null;
	/** Date.now() of the last applied snapshot. */
	lastSyncedAt: number | null;
}

export const QA_EVENT_LIMIT = 200;

export type ChannelAction<S extends DeckSessionState> =
	| { type: "status"; status: DeckConnectionStatus }
	| { type: "resync_started" }
	| { type: "resync_failed"; error: DeckApiError }
	| { type: "snapshot"; snapshot: S; requestEpoch: number }
	| { type: "public_event"; event: DeckPublicEvent; resyncOnSlideChange: boolean }
	| { type: "host_event"; event: DeckHostEvent };

export function initialChannelState<S extends DeckSessionState>(snapshot?: S | null): ChannelState<S> {
	const base: ChannelState<S> = {
		status: "idle",
		sessionStatus: null,
		currentRun: null,
		slimRun: null,
		runState: null,
		aggregate: null,
		resultsVisibility: null,
		participantCount: null,
		totalSlides: null,
		qaEvents: [],
		qaSeq: 0,
		lastEvent: null,
		latestState: null,
		epoch: 0,
		resyncRequests: 0,
		isResyncing: false,
		error: null,
		lastSyncedAt: null,
	};
	return snapshot ? applySnapshot(base, snapshot, 0) : base;
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
	const aggregate: SlideAggregate | null = host
		? ((snapshot.current_run as PresenterRunView | null)?.aggregate ?? null)
		: snapshot.aggregate;

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
		resultsVisibility: snapshot.results_visibility,
		participantCount: host ? snapshot.participant_count : state.participantCount,
		totalSlides: snapshot.session.total_slides,
		latestState: snapshot,
		isResyncing: false,
		error: null,
		lastSyncedAt: Date.now(),
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

/** slide.aggregate.updated on either channel. */
function applyAggregate<S extends DeckSessionState>(
	state: ChannelState<S>,
	runId: number,
	version: number,
	aggregate: SlideAggregate
): ChannelState<S> {
	if (runId !== currentRunId(state as ChannelState<DeckSessionState>)) return state;
	const held = state.runState?.state_version ?? -1;
	if (version < held) return state;
	return {
		...state,
		aggregate,
		resyncRequests: version > held + 1 ? state.resyncRequests + 1 : state.resyncRequests,
	};
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

		case "host_event": {
			const event = action.event;
			const next = { ...state, lastEvent: { channel: "host" as const, event } };
			if (event.event === "slide.aggregate.updated") {
				return applyAggregate(next, event.slide_run_id, event.state_version, event.aggregate);
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
					return {
						...next,
						epoch: state.epoch + 1,
						sessionStatus: state.sessionStatus === "ended" ? "ended" : "live",
						currentRun: slim ? null : slide,
						slimRun: slim ? slide : null,
						runState: runStateFromRun(slide, null, event.server_time),
						aggregate: null,
						totalSlides: event.total_slides ?? state.totalSlides,
						resyncRequests:
							slim || action.resyncOnSlideChange ? state.resyncRequests + 1 : state.resyncRequests,
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

					return {
						...next,
						currentRun,
						runState,
						// slide.closed carries the final aggregate only when participants may see it.
						aggregate: closed && event.aggregate ? event.aggregate : state.aggregate,
						resyncRequests: event.state_version > held + 1 ? state.resyncRequests + 1 : state.resyncRequests,
					};
				}

				case "slide.aggregate.updated":
					return applyAggregate(next, event.slide_run_id, event.state_version, event.aggregate);

				case "participant.count.updated":
					return { ...next, participantCount: event.participant_count };

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
