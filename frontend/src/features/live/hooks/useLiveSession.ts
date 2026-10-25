"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getEcho, bindEchoConnection } from "@/lib/echo";
import { getSessionState } from "@/features/live/services/liveSessionApi";
import { withDeadline } from "@/features/live/services/liveTimer";
import type {
	AnswerAggregatePayload,
	HostAnswerPayload,
	HostParticipantPayload,
	LiveChannelState,
	LiveModule,
	LiveParticipant,
	LiveSessionStatus,
	LiveSubscriptionStatus,
	SessionEventPayload,
	SessionSnapshot,
} from "@/features/live/types";

type LiveSessionRole = "participant" | "host";

type UseLiveSessionOptions = {
	module: LiveModule;
	sessionId: number | string | null | undefined;
	publicChannelKey?: string | null;
	participantToken?: string | null;
	role?: LiveSessionRole;
	onSnapshot?: (snapshot: SessionSnapshot) => void;
	onHostAnswer?: (payload: HostAnswerPayload) => void;
	onHostParticipantJoined?: (payload: HostParticipantPayload) => void;
	onHostParticipantCountUpdated?: (payload: HostParticipantPayload) => void;
};

const initialChannelState: LiveChannelState = {
	participantCount: 0,
	currentQuestionId: null,
	currentTaskId: null,
	timerState: null,
	sessionStatus: "pending",
	answerAggregate: null,
	leaderboard: null,
	connectionStatus: "unavailable",
	publicSubscriptionStatus: "unavailable",
	hostSubscriptionStatus: "unavailable",
	isConnected: false,
	lastEvent: null,
};

const sessionStatusFromSnapshot = (
	snapshot: SessionSnapshot
): LiveSessionStatus => {
	if (snapshot.running_status) return "started";
	if (snapshot.end_datetime) return "ended";
	return "pending";
};

const connectionStatusFromEcho = (): LiveSubscriptionStatus => {
	if (typeof window === "undefined") return "unavailable";

	try {
		const state = getEcho().connector.pusher.connection.state;
		if (state === "connected") return "subscribed";
		if (state === "connecting" || state === "initialized") return "connecting";
		if (state === "unavailable" || state === "failed") return "error";
		return "connecting";
	} catch {
		return "unavailable";
	}
};

const isConnectedStatus = (status: LiveSubscriptionStatus) =>
	status === "subscribed";

const participantKey = (participant: LiveParticipant) =>
	String(participant.participant_id);

const mergeParticipants = (
	previous: LiveParticipant[],
	nextParticipant?: LiveParticipant | HostParticipantPayload | null
) => {
	if (!nextParticipant?.participant_id) return previous;

	const normalized: LiveParticipant = {
		participant_id: Number(nextParticipant.participant_id),
		participant_name: nextParticipant.participant_name ?? null,
		participant_user_id: nextParticipant.participant_user_id ?? null,
		is_anonymous: nextParticipant.is_anonymous ?? null,
		status: nextParticipant.status ?? null,
		joined_at: nextParticipant.joined_at ?? null,
	};
	const nextKey = participantKey(normalized);
	const withoutExisting = previous.filter(
		(participant) => participantKey(participant) !== nextKey
	);

	return [...withoutExisting, normalized];
};

const snapshotToChannelState = (
	snapshot: SessionSnapshot
): Partial<LiveChannelState> => ({
	participantCount: snapshot.participant_count ?? 0,
	currentQuestionId: snapshot.current_question_id ?? null,
	currentTaskId: snapshot.current_task_id ?? null,
	timerState: snapshot.timer_state ?? null,
	sessionStatus: sessionStatusFromSnapshot(snapshot),
	answerAggregate: snapshot.current_aggregate ?? null,
});

const updateStateFromPayload = (
	previous: LiveChannelState,
	payload: SessionEventPayload
): LiveChannelState => {
	const next: LiveChannelState = {
		...previous,
		lastEvent: payload,
	};

	if (typeof payload.participant_count === "number") {
		next.participantCount = payload.participant_count;
	} else if (typeof payload.count === "number") {
		next.participantCount = payload.count;
	}

	if (payload.timer_state !== undefined || payload.timer !== undefined) {
		next.timerState = payload.timer_state ?? payload.timer ?? null;
	}

	if (
		payload.current_task_id !== undefined ||
		payload.task_id !== undefined
	) {
		next.currentTaskId =
			payload.current_task_id ?? payload.task_id ?? next.currentTaskId;
	}

	if (
		payload.current_question_id !== undefined ||
		payload.question_id !== undefined
	) {
		next.currentQuestionId =
			payload.current_question_id ??
			payload.question_id ??
			next.currentQuestionId;
	}

	if (payload.running_status === true) next.sessionStatus = "started";
	if (payload.running_status === false) next.sessionStatus = "ended";
	if (payload.event === "session.started") next.sessionStatus = "started";
	if (payload.event === "session.ended") next.sessionStatus = "ended";
	if (payload.event === "task.changed" || payload.event === "question.changed") {
		next.sessionStatus = "started";
		next.answerAggregate = null;
	}

	return next;
};

const updateSnapshotFromPayload = (
	previous: SessionSnapshot | null,
	module: LiveModule,
	channelKey: string | null,
	payload: SessionEventPayload
): SessionSnapshot | null => {
	if (!previous && !payload.session_id) return previous;

	const base: SessionSnapshot =
		previous ??
		({
			module,
			session_id: Number(payload.session_id),
			public_channel_key: channelKey ?? "",
			running_status: payload.running_status ?? true,
			current_question_id: null,
			current_task_id: null,
			timer_state: null,
			participant_count: 0,
		} satisfies SessionSnapshot);

	const isControlChange =
		payload.event === "task.changed" || payload.event === "question.changed";

	return {
		...base,
		running_status: payload.running_status ?? base.running_status,
		current_question_id:
			payload.current_question_id ??
			payload.question_id ??
			base.current_question_id,
		current_task_id:
			payload.current_task_id ?? payload.task_id ?? base.current_task_id,
		timer_state:
			payload.timer_state !== undefined || payload.timer !== undefined
				? payload.timer_state ?? payload.timer ?? null
				: base.timer_state,
		participant_count:
			payload.participant_count ?? payload.count ?? base.participant_count,
		current_aggregate: isControlChange ? null : base.current_aggregate,
		updated_at: payload.updated_at ?? payload.broadcasted_at ?? base.updated_at,
	};
};

export function useLiveSession({
	module,
	sessionId,
	publicChannelKey,
	participantToken,
	role = "participant",
	onSnapshot,
	onHostAnswer,
	onHostParticipantJoined,
	onHostParticipantCountUpdated,
}: UseLiveSessionOptions) {
	const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
	const [participants, setParticipants] = useState<LiveParticipant[]>([]);
	const [channelState, setChannelState] =
		useState<LiveChannelState>(initialChannelState);
	const [isSyncing, setIsSyncing] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const inFlightRef = useRef(false);
	const onSnapshotRef = useRef(onSnapshot);
	const onHostAnswerRef = useRef(onHostAnswer);
	const onHostParticipantJoinedRef = useRef(onHostParticipantJoined);
	const onHostParticipantCountUpdatedRef = useRef(
		onHostParticipantCountUpdated
	);

	onSnapshotRef.current = onSnapshot;
	onHostAnswerRef.current = onHostAnswer;
	onHostParticipantJoinedRef.current = onHostParticipantJoined;
	onHostParticipantCountUpdatedRef.current = onHostParticipantCountUpdated;

	const effectivePublicChannelKey =
		publicChannelKey ?? snapshot?.public_channel_key ?? null;

	const applySnapshot = useCallback((received: SessionSnapshot, measuredAt?: number) => {
		// Also the host's own change-question replies, so both sides count to the same deadline.
		const nextSnapshot = { ...received, timer_state: withDeadline(received.timer_state, measuredAt) };
		setSnapshot(nextSnapshot);
		setChannelState((previous) => ({
			...previous,
			...snapshotToChannelState(nextSnapshot),
		}));
		setParticipants(nextSnapshot.active_participants ?? []);
		onSnapshotRef.current?.(nextSnapshot);
	}, []);

	const refetch = useCallback(async () => {
		if (!sessionId || inFlightRef.current) return null;

		inFlightRef.current = true;
		setIsSyncing(true);

		try {
			const sentAt = Date.now();
			const nextSnapshot = await getSessionState(
				module,
				sessionId,
				participantToken
			);
			applySnapshot(nextSnapshot, Math.round((sentAt + Date.now()) / 2));
			setError(null);

			return nextSnapshot;
		} catch (nextError) {
			setError(nextError);
			return null;
		} finally {
			inFlightRef.current = false;
			setIsSyncing(false);
		}
	}, [applySnapshot, module, participantToken, sessionId]);

	useEffect(() => {
		setSnapshot(null);
		setParticipants([]);
		setChannelState(initialChannelState);
		setError(null);
	}, [module, sessionId]);

	useEffect(() => {
		void refetch();
	}, [refetch]);

	useEffect(() => {
		if (!sessionId) return;

		const refreshConnectionState = () => {
			const status = connectionStatusFromEcho();
			setChannelState((previous) => ({
				...previous,
				connectionStatus: status,
				isConnected: isConnectedStatus(status),
			}));
		};

		const handleReconnect = () => {
			refreshConnectionState();
			void refetch();
		};

		const unbindConnected = bindEchoConnection("connected", handleReconnect);
		const unbindDisconnected = bindEchoConnection(
			"disconnected",
			refreshConnectionState
		);
		const unbindUnavailable = bindEchoConnection(
			"unavailable",
			refreshConnectionState
		);
		const unbindFailed = bindEchoConnection("failed", refreshConnectionState);

		refreshConnectionState();

		return () => {
			unbindConnected();
			unbindDisconnected();
			unbindUnavailable();
			unbindFailed();
		};
	}, [refetch, sessionId]);

	useEffect(() => {
		if (!effectivePublicChannelKey) return;

		let echo;
		try {
			echo = getEcho();
		} catch (subscriptionError) {
			setError(subscriptionError);
			setChannelState((previous) => ({
				...previous,
				publicSubscriptionStatus: "unavailable",
				connectionStatus: "unavailable",
				isConnected: false,
			}));
			return;
		}

		const channelName = `session.${module}.${effectivePublicChannelKey}`;
		const channel = echo.channel(channelName);
		const setSubscriptionStatus = (status: LiveSubscriptionStatus) => {
			setChannelState((previous) => ({
				...previous,
				publicSubscriptionStatus: status,
				connectionStatus:
					status === "subscribed" ? "subscribed" : previous.connectionStatus,
				isConnected:
					status === "subscribed" || isConnectedStatus(previous.connectionStatus),
			}));
		};
		const rememberPayload = (received: SessionEventPayload) => {
			const payload: SessionEventPayload = received.timer_state
				? { ...received, timer_state: withDeadline(received.timer_state) }
				: received;
			setSnapshot((previous) =>
				updateSnapshotFromPayload(
					previous,
					module,
					effectivePublicChannelKey,
					payload
				)
			);
			setChannelState((previous) => updateStateFromPayload(previous, payload));
		};

		setSubscriptionStatus("connecting");

		channel
			.subscribed(() => {
				setSubscriptionStatus("subscribed");
				void refetch();
			})
			.error((subscriptionError: unknown) => {
				setError(subscriptionError);
				setSubscriptionStatus("error");
				console.error(`Live ${module} public channel subscription failed:`, {
					channel: channelName,
					error: subscriptionError,
				});
			})
			.listen(".session.started", rememberPayload)
			.listen(".session.ended", rememberPayload)
			.listen(".task.changed", rememberPayload)
			.listen(".question.changed", rememberPayload)
			.listen(".participant.joined", rememberPayload)
			.listen(".participant.count.updated", rememberPayload)
			.listen(".participant.completed", rememberPayload)
			.listen(".leaderboard.updated", (payload: SessionEventPayload) => {
				rememberPayload(payload);
				setChannelState((previous) => ({ ...previous, leaderboard: payload }));
			})
			.listen(".answer.aggregate.updated", (payload: AnswerAggregatePayload) => {
				rememberPayload(payload);
				setChannelState((previous) => ({
					...previous,
					answerAggregate: payload,
				}));
				setSnapshot((previous) =>
					previous
						? {
								...previous,
								current_aggregate: payload,
							}
						: previous
				);
			});

		return () => {
			echo.leave(channelName);
		};
	}, [effectivePublicChannelKey, module, refetch]);

	useEffect(() => {
		if (role !== "host" || !sessionId) return;

		let echo;
		try {
			echo = getEcho();
		} catch (subscriptionError) {
			setError(subscriptionError);
			setChannelState((previous) => ({
				...previous,
				hostSubscriptionStatus: "unavailable",
			}));
			return;
		}

		const channelName = `host.${module}.${sessionId}`;
		const channel = echo.private(channelName);
		const setHostSubscriptionStatus = (status: LiveSubscriptionStatus) => {
			setChannelState((previous) => ({
				...previous,
				hostSubscriptionStatus: status,
			}));
		};

		setHostSubscriptionStatus("connecting");

		channel
			.subscribed(() => {
				setHostSubscriptionStatus("subscribed");
				void refetch();
			})
			.error((subscriptionError: unknown) => {
				setError(subscriptionError);
				setHostSubscriptionStatus("error");
				console.error(`Live ${module} host channel subscription failed:`, {
					channel: channelName,
					error: subscriptionError,
				});
			})
			.listen(".answer.submitted", (payload: HostAnswerPayload) => {
				setChannelState((previous) => ({
					...previous,
					lastEvent: payload,
				}));
				onHostAnswerRef.current?.(payload);
			})
			.listen(".participant.joined", (payload: HostParticipantPayload) => {
				setParticipants((previous) => mergeParticipants(previous, payload));
				setChannelState((previous) =>
					updateStateFromPayload(previous, payload)
				);
				onHostParticipantJoinedRef.current?.(payload);
			})
			.listen(
				".participant.count.updated",
				(payload: HostParticipantPayload) => {
					setChannelState((previous) =>
						updateStateFromPayload(previous, payload)
					);
					onHostParticipantCountUpdatedRef.current?.(payload);
				}
			)
			.listen(".session.started", (payload: SessionEventPayload) => {
				setChannelState((previous) =>
					updateStateFromPayload(previous, payload)
				);
			})
			.listen(".session.ended", (payload: SessionEventPayload) => {
				setChannelState((previous) =>
					updateStateFromPayload(previous, payload)
				);
			});

		return () => {
			echo.leave(channelName);
		};
	}, [module, refetch, role, sessionId]);

	return useMemo(
		() => ({
			snapshot,
			participants,
			channelState,
			connectionStatus: channelState.connectionStatus,
			publicSubscriptionStatus: channelState.publicSubscriptionStatus,
			hostSubscriptionStatus: channelState.hostSubscriptionStatus,
			isConnected: channelState.isConnected,
			isSyncing,
			error,
			refetch,
			applySnapshot,
		}),
		[
			applySnapshot,
			channelState,
			error,
			isSyncing,
			participants,
			refetch,
			snapshot,
		]
	);
}
