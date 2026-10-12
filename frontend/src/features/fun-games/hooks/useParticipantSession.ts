"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getParticipantApi, type ParticipantAuth } from "../api";
import { funGamesConfig } from "../config";
import { serverClock } from "../lib/serverClock";
import { createQuizSocket, type ConnectionState, type QuizSocket, type SocketFailure } from "../realtime";
import type { ParticipantCredentials, SessionState } from "../types";
import { useAsyncResource, type AsyncResource } from "./useAsyncResource";
import { useConnectionStatus } from "./useConnectionStatus";

const serverMs = (state: { serverTime?: string } | undefined) =>
	state?.serverTime ? Date.parse(state.serverTime) : 0;

/** Re-fetch this long after a server timestamp passes, to pick up the transition. */
const AFTER_TIMESTAMP_MS = 700;

export interface ParticipantSession extends AsyncResource<SessionState> {
	auth: ParticipantAuth;
	socket: QuizSocket | null;
	connection: ConnectionState;
	failure: SocketFailure;
}

/**
 * The joined player's view of a session: REST state kept current by the public
 * channel, with polling as a safety net (always) and as the main source while
 * realtime is down or not configured. State is also re-fetched right after
 * each server timestamp (start, join window closing, hard end) passes, so the screen
 * follows the server even with no realtime at all. Older snapshots never
 * overwrite newer ones.
 */
export function useParticipantSession(credentials: ParticipantCredentials): ParticipantSession {
	const auth = useMemo<ParticipantAuth>(
		() => ({ sessionId: credentials.sessionId, token: credentials.token }),
		[credentials.sessionId, credentials.token],
	);
	const resource = useAsyncResource(
		async (signal) => (await getParticipantApi()).getState(auth, { signal }),
		[auth],
	);
	const { data, setData, reload } = resource;
	const [socket, setSocket] = useState<QuizSocket | null>(null);
	const connection = useConnectionStatus(socket);
	const failure = socket?.getFailure() ?? null;

	const merge = useCallback(
		(next: Partial<SessionState> & { serverTime?: string }) =>
			setData((prev) => {
				if (!prev) return prev;
				if (next.serverTime && serverMs(next) < serverMs(prev)) return prev;
				// Broadcasts don't carry the player's own fields; keep them.
				return { ...prev, ...next };
			}),
		[setData],
	);

	useEffect(() => {
		let cancelled = false;
		let created: QuizSocket | null = null;
		createQuizSocket({
			role: "participant",
			sessionId: credentials.sessionId,
			publicChannelKey: credentials.publicChannelKey,
		}).then((s) => {
			if (cancelled) return;
			created = s;
			s.connect();
			setSocket(s);
		});
		return () => {
			cancelled = true;
			created?.close();
			setSocket(null);
		};
	}, [credentials.sessionId, credentials.publicChannelKey]);

	useEffect(() => {
		if (!socket) return;
		const offs = [
			socket.on("session.state", (next) => merge(next)),
			socket.on("session.finished", (event) =>
				setData((prev) => prev && { ...prev, status: "finished", finishedAt: event.finishedAt }),
			),
			socket.onResync(reload),
		];
		return () => offs.forEach((off) => off());
	}, [socket, merge, setData, reload]);

	// Polling: a slow safety net while realtime works, the main source while it doesn't.
	const finished = data?.status === "finished";
	useEffect(() => {
		if (finished) return;
		const every = connection === "connected" ? funGamesConfig.pollConnectedMs : funGamesConfig.pollDisconnectedMs;
		const timer = setInterval(() => {
			if (document.visibilityState === "visible") reload();
		}, every);
		return () => clearInterval(timer);
	}, [connection, finished, reload]);

	// Re-fetch just after the next server timestamp passes.
	const nextTimestamp = useMemo(() => {
		if (!data) return null;
		if (data.status === "waiting") return data.startsAt ?? null;
		if (data.status === "live") {
			// While live, the session moves on its own at the join-window close and the hard end.
			const joinCloses = data.joinClosesAt && (serverClock.remainingMs(data.joinClosesAt) ?? 0) > 0 ? data.joinClosesAt : null;
			return joinCloses ?? data.endsAt ?? null;
		}
		return null;
	}, [data]);
	useEffect(() => {
		const remaining = serverClock.remainingMs(nextTimestamp);
		if (remaining == null) return;
		const timer = setTimeout(reload, Math.max(0, remaining) + AFTER_TIMESTAMP_MS);
		return () => clearTimeout(timer);
	}, [nextTimestamp, reload]);

	// Coming back to the tab (phones sleep): catch up immediately.
	useEffect(() => {
		const onVisible = () => {
			if (document.visibilityState === "visible") reload();
		};
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("online", reload);
		return () => {
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("online", reload);
		};
	}, [reload]);

	return { ...resource, auth, socket, connection, failure };
}
