"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toDeckApiError, type DeckApiError } from "../api/errors";
import { createParticipantApi } from "../api/participantApi";
import { createSessionApi } from "../api/sessionApi";
import type {
	DeckProduct,
	DeckQaEventPayload,
	QaFeedSort,
	QaHostItem,
	QaItemBase,
	QaModerationFlags,
	QaParticipantItem,
} from "../types";
import type { DeckQaEvent } from "./channelState";

// Q&A feed = REST read (GET .../qa/questions) + qa.question.* events merged
// by question_id. Items are snake_case on both paths, so events merge in
// without mapping. Rules (backend LiveQaService / "Decisions taken"):
// - participants never see hidden questions (the author neither);
// - `top` = upvote_count desc, then oldest first; `new` = newest first;
// - the host feed lists starred questions first and keeps hidden ones.

type MetaKey = "event" | "module" | "session_id" | "broadcasted_at";

/** The item fields of an event (broadcast meta keys removed). */
function eventFields<T extends object>(event: T): Omit<T, MetaKey> {
	const copy = { ...event } as Record<string, unknown>;
	delete copy.event;
	delete copy.module;
	delete copy.session_id;
	delete copy.broadcasted_at;
	return copy as Omit<T, MetaKey>;
}

export function sortQaItems<T extends QaItemBase>(items: T[], sort: QaFeedSort, starredFirst = false): T[] {
	return [...items].sort((a, b) => {
		if (starredFirst && a.is_starred !== b.is_starred) return a.is_starred ? -1 : 1;
		if (sort === "top" && a.upvote_count !== b.upvote_count) return b.upvote_count - a.upvote_count;
		return sort === "top" ? a.question_id - b.question_id : b.question_id - a.question_id;
	});
}

/** Apply one event to a participant feed. Unknown upvote targets are ignored (the next read heals). */
export function applyQaEventToParticipantFeed(
	items: QaParticipantItem[],
	event: DeckQaEventPayload,
	runId: number
): QaParticipantItem[] {
	if (event.slide_run_id !== runId) return items;
	const index = items.findIndex((item) => item.question_id === event.question_id);

	switch (event.event) {
		case "qa.question.submitted": {
			if (index >= 0) return items;
			const fields = eventFields(event);
			return [...items, { ...fields, is_hidden: false, has_upvoted: false, is_mine: false }];
		}
		case "qa.question.upvoted":
			if (index < 0) return items;
			return items.map((item, i) => (i === index ? { ...item, upvote_count: event.upvote_count } : item));
		case "qa.question.moderated": {
			if (event.is_hidden) return index < 0 ? items : items.filter((_, i) => i !== index);
			const fields = eventFields(event);
			const visible = fields as QaItemBase;
			if (index < 0) return [...items, { ...visible, is_hidden: false, has_upvoted: false, is_mine: false }];
			return items.map((item, i) => (i === index ? { ...item, ...visible, is_hidden: false } : item));
		}
		default:
			return items;
	}
}

/** Apply one event to the host feed (host + public copies both arrive; merging is idempotent). */
export function applyQaEventToHostFeed(items: QaHostItem[], event: DeckQaEventPayload, runId: number): QaHostItem[] {
	if (event.slide_run_id !== runId) return items;
	const index = items.findIndex((item) => item.question_id === event.question_id);

	switch (event.event) {
		case "qa.question.submitted": {
			if (index >= 0) return items;
			const fields = eventFields(event);
			return [...items, { ...fields, participant_id: null, is_hidden: false }];
		}
		case "qa.question.upvoted":
			if (index < 0) return items;
			return items.map((item, i) => (i === index ? { ...item, upvote_count: event.upvote_count } : item));
		case "qa.question.moderated": {
			const fields = eventFields(event);
			if (index < 0) {
				// A redacted public copy alone cannot create an item.
				if (!("body" in fields)) return items;
				const created = fields as Partial<QaHostItem> & QaItemBase;
				return [...items, { ...created, participant_id: created.participant_id ?? null, is_hidden: !!created.is_hidden }];
			}
			return items.map((item, i) => (i === index ? { ...item, ...(fields as Partial<QaHostItem>) } : item));
		}
		default:
			return items;
	}
}

/** Feeds `qaEvents` (from useDeckSessionChannel) to `apply` once each, in order. */
function useQaEventStream(qaEvents: DeckQaEvent[], apply: (event: DeckQaEventPayload) => void, resetKey: unknown) {
	const lastSeq = useRef(0);
	const applyRef = useRef(apply);
	applyRef.current = apply;

	// A new run / reload: replay only events that arrive from now on.
	useEffect(() => {
		lastSeq.current = qaEvents.length ? qaEvents[qaEvents.length - 1].seq : 0;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [resetKey]);

	useEffect(() => {
		for (const entry of qaEvents) {
			if (entry.seq <= lastSeq.current) continue;
			lastSeq.current = entry.seq;
			applyRef.current(entry.event);
		}
	}, [qaEvents]);
}

interface FeedStatus {
	loading: boolean;
	error: DeckApiError | null;
	total: number;
	/** Participant feed hidden: only the participant's own questions. */
	ownOnly: boolean;
	showFeedToParticipants: boolean;
	sort: QaFeedSort;
	setSort: (sort: QaFeedSort) => void;
	refresh: () => Promise<void>;
}

export interface ParticipantQaFeed extends FeedStatus {
	questions: QaParticipantItem[];
	submit: (body: string) => Promise<QaParticipantItem>;
	upvote: (questionId: number) => Promise<void>;
	removeUpvote: (questionId: number) => Promise<void>;
	toggleUpvote: (questionId: number) => Promise<void>;
}

export interface UseParticipantQaFeedOptions {
	product: DeckProduct;
	sessionId: number | null | undefined;
	runId: number | null | undefined;
	token: string | null | undefined;
	qaEvents: DeckQaEvent[];
	/** Initial sort; defaults to the slide's (the feed answers with it). */
	sort?: QaFeedSort;
	enabled?: boolean;
}

/** Participant Q&A feed with submit / upvote actions (optimistic upvotes, absolute counts from the server). */
export function useParticipantQaFeed(options: UseParticipantQaFeedOptions): ParticipantQaFeed {
	const { product, sessionId, runId, token, qaEvents, enabled = true } = options;
	const api = useMemo(() => createParticipantApi(product), [product]);
	const [items, setItems] = useState<QaParticipantItem[]>([]);
	const [sort, setSort] = useState<QaFeedSort | undefined>(options.sort);
	const [meta, setMeta] = useState({ total: 0, ownOnly: false, showFeedToParticipants: true, sort: "top" as QaFeedSort });
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<DeckApiError | null>(null);
	const ready = enabled && !!sessionId && !!runId && !!token;

	const refresh = useCallback(async () => {
		if (!ready) return;
		setLoading(true);
		try {
			const feed = await api.getQaFeed(sessionId!, runId!, token!, { sort });
			setItems(feed.questions);
			setMeta({
				total: feed.total,
				ownOnly: feed.own_only,
				showFeedToParticipants: feed.show_feed_to_participants,
				sort: feed.sort,
			});
			setError(null);
		} catch (reason) {
			setError(toDeckApiError(reason));
		} finally {
			setLoading(false);
		}
	}, [api, ready, sessionId, runId, token, sort]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useQaEventStream(
		qaEvents,
		(event) => {
			if (!runId) return;
			// With the feed hidden, other people's questions must not appear.
			if (meta.ownOnly && event.event === "qa.question.submitted") return;
			setItems((list) => applyQaEventToParticipantFeed(list, event, runId));
		},
		`${runId}:${sort}`
	);

	const setVote = useCallback(
		async (questionId: number, up: boolean) => {
			if (!ready) return;
			setItems((list) =>
				list.map((item) =>
					item.question_id === questionId && item.has_upvoted !== up
						? { ...item, has_upvoted: up, upvote_count: Math.max(0, item.upvote_count + (up ? 1 : -1)) }
						: item
				)
			);
			try {
				const result = up
					? await api.upvote(sessionId!, questionId, token!)
					: await api.removeUpvote(sessionId!, questionId, token!);
				setItems((list) =>
					list.map((item) =>
						item.question_id === questionId
							? { ...item, has_upvoted: result.has_upvoted, upvote_count: result.upvote_count }
							: item
					)
				);
			} catch (reason) {
				const deckError = toDeckApiError(reason);
				// 404: hidden meanwhile; drop it. Otherwise roll back.
				setItems((list) =>
					deckError.status === 404
						? list.filter((item) => item.question_id !== questionId)
						: list.map((item) =>
								item.question_id === questionId && item.has_upvoted === up
									? { ...item, has_upvoted: !up, upvote_count: Math.max(0, item.upvote_count + (up ? -1 : 1)) }
									: item
							)
				);
				throw deckError;
			}
		},
		[api, ready, sessionId, token]
	);

	const submit = useCallback(
		async (body: string) => {
			if (!ready) throw toDeckApiError(new Error("Not joined."));
			const question = await api.submitQuestion(sessionId!, runId!, token!, body);
			setItems((list) =>
				list.some((item) => item.question_id === question.question_id)
					? list.map((item) => (item.question_id === question.question_id ? { ...item, ...question } : item))
					: [...list, question]
			);
			return question;
		},
		[api, ready, sessionId, runId, token]
	);

	const effectiveSort = sort ?? meta.sort;
	const questions = useMemo(() => sortQaItems(items, effectiveSort), [items, effectiveSort]);

	return {
		questions,
		loading,
		error,
		total: Math.max(meta.total, items.length),
		ownOnly: meta.ownOnly,
		showFeedToParticipants: meta.showFeedToParticipants,
		sort: effectiveSort,
		setSort,
		refresh,
		submit,
		upvote: (questionId) => setVote(questionId, true),
		removeUpvote: (questionId) => setVote(questionId, false),
		toggleUpvote: (questionId) => {
			const item = items.find((entry) => entry.question_id === questionId);
			return setVote(questionId, !item?.has_upvoted);
		},
	};
}

export interface HostQaFeed extends FeedStatus {
	/** Starred first, then the sort; hidden included. */
	questions: QaHostItem[];
	moderate: (questionId: number, flags: QaModerationFlags) => Promise<QaHostItem>;
}

export interface UseHostQaFeedOptions {
	product: DeckProduct;
	sessionId: number | null | undefined;
	runId: number | null | undefined;
	qaEvents: DeckQaEvent[];
	sort?: QaFeedSort;
	enabled?: boolean;
}

/** Host moderation feed (no participant token is ever sent). */
export function useHostQaFeed(options: UseHostQaFeedOptions): HostQaFeed {
	const { product, sessionId, runId, qaEvents, enabled = true } = options;
	const api = useMemo(() => createSessionApi(product), [product]);
	const [items, setItems] = useState<QaHostItem[]>([]);
	const [sort, setSort] = useState<QaFeedSort | undefined>(options.sort);
	const [meta, setMeta] = useState({ total: 0, showFeedToParticipants: true, sort: "top" as QaFeedSort });
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<DeckApiError | null>(null);
	const ready = enabled && !!sessionId && !!runId;

	const refresh = useCallback(async () => {
		if (!ready) return;
		setLoading(true);
		try {
			const feed = await api.getQaFeed(sessionId!, runId!, { sort, limit: 500 });
			setItems(feed.questions);
			setMeta({ total: feed.total, showFeedToParticipants: feed.show_feed_to_participants, sort: feed.sort });
			setError(null);
		} catch (reason) {
			setError(toDeckApiError(reason));
		} finally {
			setLoading(false);
		}
	}, [api, ready, sessionId, runId, sort]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useQaEventStream(
		qaEvents,
		(event) => {
			if (runId) setItems((list) => applyQaEventToHostFeed(list, event, runId));
		},
		`${runId}:${sort}`
	);

	const moderate = useCallback(
		async (questionId: number, flags: QaModerationFlags) => {
			const previous = items;
			setItems((list) => list.map((item) => (item.question_id === questionId ? { ...item, ...flags } : item)));
			try {
				const question = await api.moderateQuestion(sessionId!, questionId, flags);
				setItems((list) => list.map((item) => (item.question_id === questionId ? question : item)));
				return question;
			} catch (reason) {
				setItems(previous);
				throw toDeckApiError(reason);
			}
		},
		[api, items, sessionId]
	);

	const effectiveSort = sort ?? meta.sort;
	const questions = useMemo(() => sortQaItems(items, effectiveSort, true), [items, effectiveSort]);

	return {
		questions,
		loading,
		error,
		total: Math.max(meta.total, items.length),
		ownOnly: false,
		showFeedToParticipants: meta.showFeedToParticipants,
		sort: effectiveSort,
		setSort,
		refresh,
		moderate,
	};
}
