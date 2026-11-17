"use client";

import { useEffect, useRef, useState } from "react";
import { hostChannelName } from "../api/routes";
import type {
	AnswerSubmittedEvent,
	DeckHostEvent,
	DeckProduct,
	DeckQaEventPayload,
	ParticipantJoinedEvent,
	SlideAggregateUpdatedEvent,
} from "../types";
import { acquireChannel, type AcquiredChannel } from "./echoChannels";
import { noteServerTime } from "./useServerClock";

// Host-only events on the private channel `host.{product}.{sessionId}`
// (Echo auth with the host's Sanctum token via /broadcasting/auth):
//   answer.submitted         one participant's submission (ticker, "who answered")
//   participant.joined       lobby / recent-joins ticker
//   slide.aggregate.updated  results hidden from participants (also merged by
//                            useDeckSessionChannel when given hostSessionId)
//   qa.question.*            full moderation payloads (hidden questions included)
// The state that drives the slide (run, timer, aggregate) lives in
// useDeckSessionChannel; this hook is for the host extras.

const HOST_EVENTS: DeckHostEvent["event"][] = [
	"answer.submitted",
	"participant.joined",
	"slide.aggregate.updated",
	"qa.question.submitted",
	"qa.question.upvoted",
	"qa.question.moderated",
];

/** How many recent answers / joins the hook keeps. */
const RECENT_LIMIT = 50;

export interface DeckHostChannelHandlers {
	onAnswerSubmitted?: (event: AnswerSubmittedEvent) => void;
	onParticipantJoined?: (event: ParticipantJoinedEvent) => void;
	onAggregateUpdated?: (event: SlideAggregateUpdatedEvent) => void;
	onQaEvent?: (event: DeckQaEventPayload) => void;
	/** Every host event. */
	onEvent?: (event: DeckHostEvent) => void;
}

export interface UseDeckHostChannelOptions extends DeckHostChannelHandlers {
	product: DeckProduct;
	sessionId: number | null | undefined;
	enabled?: boolean;
}

export interface DeckHostChannel {
	/** The private channel subscription is confirmed. */
	subscribed: boolean;
	/** Subscription failed (usually auth: signed out, or not this session's host). */
	error: unknown;
	/** Newest first, at most 50. */
	recentAnswers: AnswerSubmittedEvent[];
	/** Newest first, at most 50. */
	recentJoins: ParticipantJoinedEvent[];
	/** total_responses per run from answer.submitted (live response counter). */
	responseCounts: Record<number, number>;
	lastEvent: DeckHostEvent | null;
}

export function useDeckHostChannel({ product, sessionId, enabled = true, ...handlers }: UseDeckHostChannelOptions): DeckHostChannel {
	const handlersRef = useRef<DeckHostChannelHandlers>(handlers);
	handlersRef.current = handlers;

	const [subscribed, setSubscribed] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const [recentAnswers, setRecentAnswers] = useState<AnswerSubmittedEvent[]>([]);
	const [recentJoins, setRecentJoins] = useState<ParticipantJoinedEvent[]>([]);
	const [responseCounts, setResponseCounts] = useState<Record<number, number>>({});
	const [lastEvent, setLastEvent] = useState<DeckHostEvent | null>(null);

	useEffect(() => {
		if (!enabled || !sessionId) return;

		let acquired: AcquiredChannel | null = null;
		setSubscribed(false);
		setError(null);

		try {
			acquired = acquireChannel("private", hostChannelName(product, sessionId));
			const channel = acquired;
			if (channel.isSubscribed()) setSubscribed(true);
			channel.onSubscribed(() => {
				setSubscribed(true);
				setError(null);
			});
			channel.onError((reason) => {
				setSubscribed(false);
				setError(reason);
				console.error(`Deck ${product} host channel subscription failed`, { sessionId, reason });
			});

			for (const name of HOST_EVENTS) {
				channel.listen<DeckHostEvent>(name, (payload) => {
					const event = { ...payload, event: payload.event ?? name } as DeckHostEvent;
					if ("server_time" in event) noteServerTime(event.server_time);
					setLastEvent(event);
					const h = handlersRef.current;

					switch (event.event) {
						case "answer.submitted": {
							const answer = event;
							setRecentAnswers((list) => [answer, ...list].slice(0, RECENT_LIMIT));
							if (answer.total_responses !== null) {
								setResponseCounts((counts) => ({ ...counts, [answer.slide_run_id]: answer.total_responses ?? 0 }));
							}
							h.onAnswerSubmitted?.(answer);
							break;
						}
						case "participant.joined": {
							const joined = event;
							setRecentJoins((list) => [joined, ...list].slice(0, RECENT_LIMIT));
							h.onParticipantJoined?.(joined);
							break;
						}
						case "slide.aggregate.updated":
							h.onAggregateUpdated?.(event);
							break;
						default:
							h.onQaEvent?.(event);
					}
					h.onEvent?.(event);
				});
			}
		} catch (reason) {
			setError(reason);
			console.error(`Deck ${product} host channel unavailable`, reason);
		}

		return () => acquired?.release();
	}, [enabled, product, sessionId]);

	return { subscribed, error, recentAnswers, recentJoins, responseCounts, lastEvent };
}
