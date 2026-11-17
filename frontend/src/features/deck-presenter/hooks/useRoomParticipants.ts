"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionApi } from "@/features/deck/api/sessionApi";
import type { ParticipantJoinedEvent, RoomParticipant } from "@/features/deck/types";

// Who is in the room, for the host: the list from GET {session}/participants,
// with names from participant.joined added at once. A leave only changes the
// count (no names on the wire), so a changed count reloads the list once
// things settle.

/** Wait for a burst of joins / leaves to settle before reloading. */
const RELOAD_DELAY_MS = 1500;

export interface RoomParticipantsState {
	/** Newest first. */
	participants: RoomParticipant[];
	/** Everyone in the room (the list holds at most 200). */
	total: number;
}

interface Options {
	api: SessionApi;
	sessionId: number;
	/** From the live channel (participant.count.updated). */
	participantCount: number | null;
	/** From the host channel, newest first. */
	recentJoins: ParticipantJoinedEvent[];
	enabled?: boolean;
}

interface Loaded {
	participants: RoomParticipant[];
	total: number;
	/** Joins already announced when the list was asked for: the list covers them. */
	before: ReadonlySet<number>;
}

export function useRoomParticipants({ api, sessionId, participantCount, recentJoins, enabled = true }: Options): RoomParticipantsState {
	const [loaded, setLoaded] = useState<Loaded | null>(null);
	const joinsRef = useRef(recentJoins);
	joinsRef.current = recentJoins;
	const hasLoaded = loaded !== null;

	useEffect(() => {
		if (!enabled) return;
		const controller = new AbortController();
		// The first load runs at once; later count changes wait for quiet.
		const timer = setTimeout(
			() => {
				const before = new Set(joinsRef.current.map((join) => join.participant_id));
				api
					.getParticipants(sessionId, controller.signal)
					.then((list) => setLoaded({ ...list, before }))
					.catch(() => undefined); // The count still shows; the next change retries.
			},
			hasLoaded ? RELOAD_DELAY_MS : 0
		);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
		// Reload when the count moves; whether a list exists only picks the delay.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [api, sessionId, participantCount, enabled]);

	return useMemo(() => {
		const list = loaded?.participants ?? [];
		const listed = new Set(list.map((p) => p.participant_id));
		const fresh: RoomParticipant[] = [];
		for (const join of recentJoins) {
			if (listed.has(join.participant_id) || loaded?.before.has(join.participant_id)) continue;
			listed.add(join.participant_id);
			fresh.push({
				participant_id: join.participant_id,
				display_name: join.display_name,
				emoji_avatar: join.emoji_avatar,
				joined_at: join.joined_at,
			});
		}
		return {
			participants: [...fresh, ...list],
			total: participantCount ?? (loaded?.total ?? 0) + fresh.length,
		};
	}, [loaded, recentJoins, participantCount]);
}
