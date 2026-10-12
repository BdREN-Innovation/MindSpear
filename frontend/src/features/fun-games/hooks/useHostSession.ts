"use client";

import { useEffect, useMemo, useState } from "react";
import { getHostApi } from "../api";
import { funGamesConfig } from "../config";
import { serverClock } from "../lib/serverClock";
import { createQuizSocket, type ConnectionState, type QuizSocket, type SocketFailure } from "../realtime";
import type { HostParticipant, HostSessionDetail, Leaderboard } from "../types";
import { useAsyncResource, type AsyncResource } from "./useAsyncResource";
import { useConnectionStatus } from "./useConnectionStatus";

const AFTER_TIMESTAMP_MS = 700;

export interface HostSession extends AsyncResource<HostSessionDetail> {
	leaderboard: AsyncResource<Leaderboard>;
	participants: AsyncResource<HostParticipant[]>;
	socket: QuizSocket | null;
	connection: ConnectionState;
	failure: SocketFailure;
	/** Device time of the last live-ranking update. */
	rankingUpdatedAt: number | null;
}

/**
 * The host's control view of a session: REST detail kept current by the
 * owner-only channel `host.fungame.{id}`, with polling as a safety net (and as
 * the main source while realtime is down or not configured).
 */
export function useHostSession(sessionId: string): HostSession {
	const detail = useAsyncResource(async (signal) => (await getHostApi()).getSession(sessionId, { signal }), [sessionId]);
	const status = detail.data?.status;
	const leaderboard = useAsyncResource(
		async (signal) => (await getHostApi()).getSessionLeaderboard(sessionId, { signal }),
		[sessionId],
		{ enabled: !!status && status !== "waiting" },
	);
	const participants = useAsyncResource(
		async (signal) => (await getHostApi()).getSessionParticipants(sessionId, { signal }),
		[sessionId],
	);
	const [rankingUpdatedAt, setRankingUpdatedAt] = useState<number | null>(null);
	useEffect(() => {
		if (leaderboard.data) setRankingUpdatedAt(Date.now());
	}, [leaderboard.data]);

	const [socket, setSocket] = useState<QuizSocket | null>(null);
	const connection = useConnectionStatus(socket);
	const failure = socket?.getFailure() ?? null;

	useEffect(() => {
		let cancelled = false;
		let created: QuizSocket | null = null;
		createQuizSocket({ role: "host", sessionId }).then((s) => {
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
	}, [sessionId]);

	const { setData: setDetail, reload: reloadDetail } = detail;
	const { setData: setBoard, reload: reloadBoard } = leaderboard;
	const { setData: setParticipants, reload: reloadParticipants } = participants;

	useEffect(() => {
		if (!socket) return;
		const offs = [
			socket.on("session.state", (next) =>
				setDetail((prev) =>
					prev && Date.parse(next.serverTime) >= Date.parse(prev.serverTime) ? { ...prev, ...next } : prev,
				),
			),
			socket.on("session.finished", () => reloadDetail()),
			socket.on("admin.stats", (stats) => setDetail((prev) => prev && { ...prev, stats })),
			socket.on("leaderboard.updated", (board) => setBoard(board)),
			socket.on("leaderboard.published", (board) => setBoard(board)),
			socket.on("participant.joined", (p) =>
				setParticipants((prev) =>
					prev && !prev.some((x) => x.id === p.id)
						? [...prev, { ...p, lastSeenAt: p.joinedAt, finishedAt: null }]
						: prev,
				),
			),
			socket.onResync(() => {
				reloadDetail();
				reloadParticipants();
				reloadBoard();
			}),
		];
		return () => offs.forEach((off) => off());
	}, [socket, setDetail, setBoard, setParticipants, reloadDetail, reloadParticipants, reloadBoard]);

	// Polling: safety net while connected, main source while not.
	const finished = status === "finished";
	useEffect(() => {
		if (finished) return;
		const every = connection === "connected" ? funGamesConfig.pollConnectedMs : funGamesConfig.pollDisconnectedMs;
		const timer = setInterval(() => {
			if (document.visibilityState !== "visible") return;
			reloadDetail();
			// New players can join in the lobby and during the first minutes of play.
			if (status === "waiting" || status === "live") reloadParticipants();
			// Live rankings are pushed while connected; poll them only when not.
			if (status && status !== "waiting" && connection !== "connected") reloadBoard();
		}, every);
		return () => clearInterval(timer);
	}, [connection, finished, status, reloadDetail, reloadParticipants, reloadBoard]);

	// Final leaderboard once scoring is done.
	useEffect(() => {
		if (finished) reloadBoard();
	}, [finished, reloadBoard]);

	const nextTimestamp = useMemo(() => {
		const d = detail.data;
		if (!d) return null;
		if (d.status === "waiting") return d.startsAt ?? null;
		if (d.status === "live") {
			const joinOpen = d.joinClosesAt && (serverClock.remainingMs(d.joinClosesAt) ?? 0) > 0;
			return joinOpen ? d.joinClosesAt! : (d.endsAt ?? null);
		}
		return null;
	}, [detail.data]);
	useEffect(() => {
		const remaining = serverClock.remainingMs(nextTimestamp);
		if (remaining == null) return;
		const timer = setTimeout(reloadDetail, Math.max(0, remaining) + AFTER_TIMESTAMP_MS);
		return () => clearTimeout(timer);
	}, [nextTimestamp, reloadDetail]);

	return { ...detail, leaderboard, participants, socket, connection, failure, rankingUpdatedAt };
}
