/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import QuestPlayComponent from "@/features/live/components/Liveui/QuestPlayComponent";
import { normalizeTasks } from "@/utils/quickFormTransform";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { useSearchParams } from "next/navigation";
import {
	getParticipantToken,
	getStoredPublicChannelKey,
} from "@/features/live/services/liveStorage";
import { useLiveSession } from "@/features/live/hooks/useLiveSession";
import moment from "@/lib/dayjs";
import { useDispatch } from "react-redux";
import { setQuestData } from "@/features/quest/store/questQuestionTimeSlice";
import type { SessionSnapshot, TimerState } from "@/features/live/types";

function QuizAttempt() {
	const searchParams = useSearchParams();
	const dispatch = useDispatch();
	const quizId = searchParams.get("qid");
	const userId = searchParams.get("ujid");
	const quizTitle = searchParams.get("title");
	const userName = searchParams.get("uname");
	const joinid = searchParams.get("jid");
	const sessionId = searchParams.get("sid");
	const publicChannelKey =
		searchParams.get("pck") ?? getStoredPublicChannelKey("quest", sessionId);
	const participantToken = getParticipantToken("quest", sessionId);

	const [tasks, setTasks] = useState<any[]>([]);
	// The join link answers 400 once the quest has no running session. A player reloading after the
	// end used to land back in "You're in the quest lobby" (their token is revoked, so the live
	// state never arrives).
	const [linkEnded, setLinkEnded] = useState(false);
	const popListenerAdded = useRef(false);

	const dispatchLiveState = useCallback(
		(taskId: number | null | undefined, timerState: TimerState) => {
			if (!taskId) return;

			dispatch(
				setQuestData({
					questId: quizId,
					questionId: `${taskId}`,
					questiQsenStartTime:
						typeof timerState?.start_time === "string"
							? timerState.start_time
							: moment().format("MMMM Do YYYY, h:mm:ss"),
					questiQsenTime: `${
						timerState?.duration_seconds ??
						timerState?.remaining_seconds ??
						""
					}`,
					questiQsenLateStartTime: false,
					questiQsenDeadline: timerState?.deadline_ms ?? null,
				})
			);
		},
		[dispatch, quizId]
	);

	const handleSnapshot = useCallback(
		(snapshot: SessionSnapshot) => {
			dispatchLiveState(snapshot.current_task_id, snapshot.timer_state);
		},
		[dispatchLiveState]
	);

	const { channelState } = useLiveSession({
		module: "quest",
		sessionId,
		publicChannelKey,
		participantToken,
		onSnapshot: handleSnapshot,
	});

	useEffect(() => {
		dispatchLiveState(channelState.currentTaskId, channelState.timerState);
	}, [
		channelState.currentTaskId,
		channelState.timerState,
		dispatchLiveState,
	]);

	useEffect(() => {
		if (typeof window !== "undefined" && !navigator.onLine) {
			console.warn("Offline — skipping API call");
			return;
		}

		const dataFetch = async () => {
			try {
				const response = await axiosInstance.get(
					`/quest-attempts-url/show-by-link/${joinid}`
				);
				const normalized = normalizeTasks(
					response?.data?.data?.quest?.tasks
				);
				setTasks(normalized);
			} catch (error) {
				const axiosError = error as AxiosError<{ message?: string }>;
				if (axiosError.response?.status === 400) setLinkEnded(true);
				else console.error("Unexpected error:", axiosError.message);
			}
		};
		if (joinid) dataFetch();
	}, [joinid]);

	const handleLeaveQuiz = async () => {};

	useEffect(() => {
		if (popListenerAdded.current) return;
		popListenerAdded.current = true;
		history.pushState({ quizGuard: true }, "", location.href);

		const handlePopState = async () => {
			const confirmLeave = window.confirm(
				"Are you sure you want to leave the quest?"
			);
			if (confirmLeave) {
				window.removeEventListener("popstate", handlePopState);
				await handleLeaveQuiz();
				history.back();
			} else {
				history.pushState({ quizGuard: true }, "", location.href);
			}
		};

		window.addEventListener("popstate", handlePopState);

		return () => {
			window.removeEventListener("popstate", handlePopState);
			popListenerAdded.current = false;
		};
	}, [quizId, userId, quizTitle, userName]);

	// useEffect(() => {
	// 	const handleBeforeUnload = (event: BeforeUnloadEvent) => {
	// 		event.preventDefault();
	// 		event.returnValue = "";
	// 		emitLeaveQuiz({ quizId, userId, quizTitle, userName }).catch(
	// 			() => {}
	// 		);
	// 	};

	// 	window.addEventListener("beforeunload", handleBeforeUnload);
	// 	return () =>
	// 		window.removeEventListener("beforeunload", handleBeforeUnload);
	// }, [quizId, userId, quizTitle, userName]);

	return (
		<div>
			<QuestPlayComponent
				tasks={tasks}
				sessionStatus={linkEnded ? "ended" : channelState.sessionStatus}
				currentItemId={channelState.currentTaskId}
			/>
		</div>
	);
}

export default QuizAttempt;
