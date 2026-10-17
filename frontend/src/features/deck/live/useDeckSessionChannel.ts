"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { bindEchoConnection, getEcho } from "@/lib/echo";
import { toDeckApiError } from "../api/errors";
import { hostChannelName, publicChannelName } from "../api/routes";
import type {
	DeckHostEvent,
	DeckProduct,
	DeckPublicEvent,
	DeckSessionState,
	ParticipantRunView,
	ResultsVisibility,
	SessionStatus,
	SlideAggregate,
	SlimRunView,
} from "../types";
import type { DeckApiError } from "../api/errors";
import {
	channelReducer,
	initialChannelState,
	type ChannelAction,
	type ChannelState,
	type DeckChannelEvent,
	type DeckConnectionStatus,
	type DeckQaEvent,
	type RunStateInfo,
} from "./channelState";
import { acquireChannel, type AcquiredChannel } from "./echoChannels";
import { msUntil, noteServerTime } from "./useServerClock";

// Live session state for the presenter and the participant play screen.
//
// Subscribes to the public channel `session.{product}.{publicChannelKey}` and
// keeps {current run, run state + timer, aggregate, participant count, Q&A
// events} up to date. The state endpoint is the source of truth: it is read
// on mount, on every (re)subscription, when slide.changed arrives slim
// (`refetch: true`), on a state_version gap, and shortly after a timed
// state's deadline (the server applies overdue timers on reads). Stale
// events (lower state_version for the current run) are ignored; see
// channelState.ts for the merge rules.
//
// A room of phones receives every broadcast at the same instant, so the
// participant view (no hostSessionId) spreads its event-driven reads: a
// random 0–2 s delay before a resync caused by a (re)subscription, a slim
// slide.changed, a revisited run or a version gap, and a jittered exponential
// backoff (honouring 429 retry_after) while polling with the socket down.
// The presenter reads at once.
//
// The caller passes the fetcher, so the same hook serves both views:
//   participant: fetchState: (signal) => questParticipantApi.getState(sessionId, token, signal)
//   host:        fetchState: (signal) => questSessionApi.getState(sessionId, signal), hostSessionId: sessionId
// With hostSessionId the hook also listens on the private host channel for
// host-only aggregates (results hidden from participants) and the full Q&A
// moderation payloads, merged into the same state.

const PUBLIC_EVENTS: DeckPublicEvent["event"][] = [
	"slide.changed",
	"slide.state.changed",
	"slide.aggregate.updated",
	"slide.closed",
	"participant.count.updated",
	"session.ended",
	"qa.question.submitted",
	"qa.question.upvoted",
	"qa.question.moderated",
];

const HOST_STATE_EVENTS: DeckHostEvent["event"][] = [
	"slide.aggregate.updated",
	"qa.question.submitted",
	"qa.question.upvoted",
	"qa.question.moderated",
];

/** After a deadline, wait this long for the server's own transition event before reading state. */
const EXPIRY_GRACE_MS = 1500;
/** Participants: spread event-driven resyncs over this window. */
const RESYNC_JITTER_MS = 2000;
/** Participants: disconnected polling backs off up to this interval (±20 % jitter). */
const POLL_MAX_MS = 60_000;

/** Delay before the next disconnected poll: jittered exponential backoff for participants, fixed for the host. */
export function nextPollDelay(baseMs: number, attempt: number, backoff: boolean, retryAfterSeconds?: number | null): number {
	let delay = backoff ? Math.min(POLL_MAX_MS, baseMs * 2 ** Math.min(attempt, 10)) : baseMs;
	// ±20 % jitter, so phones that lost the socket together never poll together.
	if (backoff) delay *= 0.8 + Math.random() * 0.4;
	if (retryAfterSeconds && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
		delay = Math.max(delay, retryAfterSeconds * 1000 + (backoff ? Math.random() * RESYNC_JITTER_MS : 0));
	}
	return Math.round(delay);
}

export interface UseDeckSessionChannelOptions<S extends DeckSessionState> {
	product: DeckProduct;
	/** null/undefined = not known yet (nothing subscribes or fetches). */
	publicChannelKey: string | null | undefined;
	/** Reads the full state (participant or host variant). Must throw DeckApiError on failure (the api functions do). */
	fetchState: (signal: AbortSignal) => Promise<S>;
	/** A state you already hold (e.g. the start-session response): rendered at once, still resynced on subscribe. */
	initialState?: S | null;
	/** Presenter: the session id, to also listen on `private-host.{product}.v2.{id}` for host-only aggregates and Q&A. */
	hostSessionId?: number | null;
	/**
	 * GET state after every slide.changed (e.g. a participant who needs has_answered for a
	 * revisited run). Off by default: slide.changed carries the full run.
	 */
	resyncOnSlideChange?: boolean;
	/**
	 * Poll the state endpoint while the socket is down (ms; 0 = off, the default).
	 * The participant view backs off from this up to 60 s; a 429 waits for retry_after.
	 */
	pollWhileDisconnectedMs?: number;
	/** Every channel event, after it was applied. */
	onEvent?: (event: DeckChannelEvent) => void;
	/** Every applied state snapshot. */
	onStateLoaded?: (state: S) => void;
	enabled?: boolean;
}

export interface DeckSessionChannel<S extends DeckSessionState> {
	/** Socket status: idle | connecting | connected | reconnecting | disconnected. */
	status: DeckConnectionStatus;
	/** pending | live | ended (null before the first state). */
	sessionStatus: SessionStatus | null;
	/** The current run (full participant view; host snapshots carry `aggregate` too). null while slim / unknown. */
	currentRun: ParticipantRunView | null;
	/** slide.changed came slim; the full run is being fetched. */
	slimRun: SlimRunView | null;
	/** State machine position + timer of the current run. */
	runState: RunStateInfo | null;
	/** The current run's state_version (per run). */
	stateVersion: number | null;
	/** Latest aggregate of the current run (null when none or hidden from this viewer). */
	aggregate: SlideAggregate | null;
	resultsVisibility: ResultsVisibility | null;
	/** Host snapshots and participant.count.updated events (participant state does not include it). */
	participantCount: number | null;
	totalSlides: number | null;
	/** Bounded Q&A event log; apply with features/deck/live/qaFeed.ts. */
	qaEvents: DeckQaEvent[];
	lastEvent: DeckChannelEvent | null;
	/** Last full state from fetchState (has_answered, my submission, runs, join info, ...). */
	latestState: S | null;
	isResyncing: boolean;
	/** Last resync failure (cleared by the next success). A participant 401 usually means the session ended. */
	error: DeckApiError | null;
	/** Read the state endpoint now (coalesced with one in flight). */
	resync: () => Promise<void>;
}

function connectionStatus(state: string, everConnected: boolean): DeckConnectionStatus {
	switch (state) {
		case "connected":
			return "connected";
		case "connecting":
		case "initialized":
			return everConnected ? "reconnecting" : "connecting";
		default:
			return "disconnected";
	}
}

export function useDeckSessionChannel<S extends DeckSessionState>(
	options: UseDeckSessionChannelOptions<S>
): DeckSessionChannel<S> {
	const {
		product,
		publicChannelKey,
		initialState = null,
		hostSessionId = null,
		resyncOnSlideChange = false,
		pollWhileDisconnectedMs = 0,
		enabled = true,
	} = options;

	const [state, dispatch] = useReducer(
		channelReducer as (state: ChannelState<S>, action: ChannelAction<S>) => ChannelState<S>,
		initialState,
		(snapshot) => initialChannelState<S>(snapshot)
	);

	const stateRef = useRef(state);
	stateRef.current = state;
	const fetchRef = useRef(options.fetchState);
	fetchRef.current = options.fetchState;
	const onEventRef = useRef(options.onEvent);
	onEventRef.current = options.onEvent;
	const onStateLoadedRef = useRef(options.onStateLoaded);
	onStateLoadedRef.current = options.onStateLoaded;
	const resyncOnSlideChangeRef = useRef(resyncOnSlideChange);
	resyncOnSlideChangeRef.current = resyncOnSlideChange;

	const inflightRef = useRef<Promise<DeckApiError | null> | null>(null);
	const pendingRef = useRef(false);
	const abortRef = useRef<AbortController | null>(null);
	const mountedRef = useRef(true);

	const active = enabled && !!publicChannelKey;
	// Only the participant view spreads its reads (see the header).
	const jitter = !hostSessionId;
	const jitterRef = useRef(jitter);
	jitterRef.current = jitter;

	/** Reads state; resolves with the failure (null on success / cancel). Coalesced with one in flight. */
	const read = useCallback((): Promise<DeckApiError | null> => {
		if (inflightRef.current) {
			// Coalesce: one more read after the current one, never a pile-up.
			pendingRef.current = true;
			return inflightRef.current;
		}

		const controller = new AbortController();
		abortRef.current = controller;
		const requestEpoch = stateRef.current.epoch;
		dispatch({ type: "resync_started" });

		const run = (async (): Promise<DeckApiError | null> => {
			try {
				const snapshot = await fetchRef.current(controller.signal);
				if (!mountedRef.current || controller.signal.aborted) return null;
				noteServerTime(snapshot.server_time);
				dispatch({ type: "snapshot", snapshot, requestEpoch });
				onStateLoadedRef.current?.(snapshot);
				return null;
			} catch (error) {
				const deckError = toDeckApiError(error);
				if (deckError.code === "cancelled" || !mountedRef.current) return null;
				dispatch({ type: "resync_failed", error: deckError });
				return deckError;
			}
		})().finally(() => {
			inflightRef.current = null;
			if (pendingRef.current && mountedRef.current) {
				pendingRef.current = false;
				void read();
			}
		});

		inflightRef.current = run;
		return run;
	}, []);

	const resync = useCallback((): Promise<void> => read().then(() => undefined), [read]);

	// Event-driven reads: at once for the host, after a random 0–2 s for participants.
	const jitterTimerRef = useRef<number | null>(null);
	const resyncSoon = useCallback(() => {
		if (!jitterRef.current) {
			void read();
			return;
		}
		if (jitterTimerRef.current !== null) return; // one delayed read covers every request in the window
		jitterTimerRef.current = window.setTimeout(() => {
			jitterTimerRef.current = null;
			if (mountedRef.current) void read();
		}, Math.random() * RESYNC_JITTER_MS);
	}, [read]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			abortRef.current?.abort();
			if (jitterTimerRef.current !== null) window.clearTimeout(jitterTimerRef.current);
			jitterTimerRef.current = null;
		};
	}, []);

	// A state handed in later (e.g. the start-session response once it arrives).
	const seededRef = useRef(!!initialState);
	useEffect(() => {
		if (!initialState || initialState === stateRef.current.latestState) return;
		seededRef.current = true;
		noteServerTime(initialState.server_time);
		dispatch({ type: "snapshot", snapshot: initialState, requestEpoch: stateRef.current.epoch });
	}, [initialState]);

	// Reducer-requested resyncs (gap, slim slide.changed, revisited run, unknown run).
	const resyncRequests = state.resyncRequests;
	useEffect(() => {
		if (active && resyncRequests > 0) resyncSoon();
	}, [active, resyncRequests, resyncSoon]);

	// Public channel + socket status.
	useEffect(() => {
		if (!active || !publicChannelKey) return;

		let acquired: AcquiredChannel | null = null;
		let everConnected = false;
		let firstSubscription = true;
		const unbinds: (() => void)[] = [];

		// Read state on mount unless one was handed in: the socket may be slow or blocked.
		if (!seededRef.current) void read();
		else if (stateRef.current.latestState) noteServerTime(stateRef.current.latestState.server_time);

		try {
			const echo = getEcho();
			const connection = echo.connector.pusher.connection;
			everConnected = connection.state === "connected";
			dispatch({ type: "status", status: connectionStatus(connection.state, everConnected) });

			unbinds.push(
				bindEchoConnection("state_change", (change) => {
					const current = (change as { current?: string } | undefined)?.current ?? connection.state;
					if (current === "connected") everConnected = true;
					dispatch({ type: "status", status: connectionStatus(current, everConnected) });
				})
			);

			acquired = acquireChannel("public", publicChannelName(product, publicChannelKey));
			const channel = acquired;

			// The first subscription right after the mount read adds nothing; every
			// later one follows a reconnect and may have missed events.
			const justRead = () =>
				inflightRef.current !== null ||
				(stateRef.current.lastSyncedAt !== null && Date.now() - stateRef.current.lastSyncedAt < 2000);
			channel.onSubscribed(() => {
				const fresh = firstSubscription && justRead();
				firstSubscription = false;
				// A reconnect: the whole room resubscribes at once (Reverb restart, Wi-Fi blip).
				if (!fresh) resyncSoon();
			});
			channel.onError((error) => {
				console.error(`Deck ${product} channel subscription failed`, { channel: publicChannelKey, error });
			});
			if (channel.isSubscribed()) {
				// Another holder already subscribed: no subscription event will come for us.
				firstSubscription = false;
				if (!justRead()) void read();
			}

			for (const name of PUBLIC_EVENTS) {
				channel.listen<DeckPublicEvent>(name, (payload) => {
					const event = { ...payload, event: payload.event ?? name } as DeckPublicEvent;
					if ("server_time" in event) noteServerTime(event.server_time);
					dispatch({ type: "public_event", event, resyncOnSlideChange: resyncOnSlideChangeRef.current });
					onEventRef.current?.({ channel: "public", event });
				});
			}
		} catch (error) {
			console.error(`Deck ${product} realtime unavailable`, error);
			dispatch({ type: "status", status: "disconnected" });
		}

		return () => {
			unbinds.forEach((unbind) => unbind());
			acquired?.release();
		};
	}, [active, product, publicChannelKey, read, resyncSoon]);

	// Private host channel (presenter): host-only aggregates and full Q&A payloads.
	useEffect(() => {
		if (!active || !hostSessionId) return;

		let acquired: AcquiredChannel | null = null;
		try {
			acquired = acquireChannel("private", hostChannelName(product, hostSessionId));
			const channel = acquired;
			channel.onError((error) => {
				console.error(`Deck ${product} host channel subscription failed`, { sessionId: hostSessionId, error });
			});
			for (const name of HOST_STATE_EVENTS) {
				channel.listen<DeckHostEvent>(name, (payload) => {
					const event = { ...payload, event: payload.event ?? name } as DeckHostEvent;
					if ("server_time" in event) noteServerTime(event.server_time);
					dispatch({ type: "host_event", event });
					onEventRef.current?.({ channel: "host", event });
				});
			}
		} catch (error) {
			console.error(`Deck ${product} host channel unavailable`, error);
		}

		return () => acquired?.release();
	}, [active, product, hostSessionId]);

	// Deadline passed without the server's transition event: read state (the
	// read applies the overdue transition). Participants add jitter so a room
	// does not hit the API in the same millisecond.
	const runId = state.runState?.slide_run_id ?? null;
	const runVersion = state.runState?.state_version ?? null;
	const endsAt = state.runState?.ends_at ?? null;
	useEffect(() => {
		if (!active || !endsAt || runId === null) return;
		const until = msUntil(endsAt);
		if (until === null) return;
		const jitter = hostSessionId ? 0 : Math.random() * 1000;
		const timer = window.setTimeout(
			() => {
				const current = stateRef.current.runState;
				if (current && current.slide_run_id === runId && current.state_version === runVersion) void read();
			},
			Math.max(0, until) + EXPIRY_GRACE_MS + jitter
		);
		return () => window.clearTimeout(timer);
	}, [active, endsAt, runId, runVersion, hostSessionId, read]);

	// Optional polling while the socket is down: backoff for participants
	// (5 s → 60 s, jittered), fixed for the host; a 429 waits for retry_after.
	const disconnected = state.status === "disconnected";
	useEffect(() => {
		if (!active || !disconnected || pollWhileDisconnectedMs <= 0) return;
		let cancelled = false;
		let timer: number | undefined;
		let attempt = 0;
		const schedule = (delay: number) => {
			timer = window.setTimeout(async () => {
				const failure = await read();
				if (cancelled) return;
				// The longer the socket stays down, the slower the room polls.
				attempt += 1;
				const retryAfter = failure?.code === "too_many_requests" ? Number(failure.data.retry_after) : null;
				schedule(nextPollDelay(pollWhileDisconnectedMs, attempt, jitterRef.current, retryAfter));
			}, delay);
		};
		schedule(nextPollDelay(pollWhileDisconnectedMs, 0, jitterRef.current));
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [active, disconnected, pollWhileDisconnectedMs, read]);

	return {
		status: active ? state.status : "idle",
		sessionStatus: state.sessionStatus,
		currentRun: state.currentRun,
		slimRun: state.slimRun,
		runState: state.runState,
		stateVersion: state.runState?.state_version ?? null,
		aggregate: state.aggregate,
		resultsVisibility: state.resultsVisibility,
		participantCount: state.participantCount,
		totalSlides: state.totalSlides,
		qaEvents: state.qaEvents,
		lastEvent: state.lastEvent,
		latestState: state.latestState,
		isResyncing: state.isResyncing,
		error: state.error,
		resync,
	};
}

export type { DeckChannelEvent, DeckConnectionStatus, DeckQaEvent, RunStateInfo } from "./channelState";
