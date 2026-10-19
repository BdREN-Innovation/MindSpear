/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import QuizPlayComponent from "@/features/live/components/Liveui/QuizPlayComponent";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { normalizeTasks } from "@/utils/quickFormTransform";
import moment from "@/lib/dayjs";

import { useDispatch } from "react-redux";
import { setQuestData } from "@/features/quest/store/questQuestionTimeSlice";
import {
	getParticipantToken,
	getStoredPublicChannelKey,
} from "@/features/live/services/liveStorage";
import { useLiveSession } from "@/features/live/hooks/useLiveSession";
import type { SessionSnapshot, TimerState } from "@/features/live/types";

function QuizAttempt() {
	const dispatch = useDispatch();
	const searchParams = useSearchParams();
	// const router = useRouter();
	const joinid = searchParams.get("jid");
	// const userId = searchParams.get("ujid");
	const quizId = searchParams.get("qid");
	const sessionId = searchParams.get("sid");
	const publicChannelKey =
		searchParams.get("pck") ?? getStoredPublicChannelKey("quiz", sessionId);
	const participantToken = getParticipantToken("quiz", sessionId);
	const [tasks, setTasks] = useState<any[]>([]);

	const dispatchLiveState = useCallback(
		(questionId: number | null | undefined, timerState: TimerState) => {
			if (!questionId) return;

			dispatch(
				setQuestData({
					questId: quizId,
					questionId: `${questionId}`,
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
			dispatchLiveState(snapshot.current_question_id, snapshot.timer_state);
		},
		[dispatchLiveState]
	);

	const { channelState } = useLiveSession({
		module: "quiz",
		sessionId,
		publicChannelKey,
		participantToken,
		onSnapshot: handleSnapshot,
	});

	useEffect(() => {
		dispatchLiveState(
			channelState.currentQuestionId,
			channelState.timerState
		);
	}, [
		channelState.currentQuestionId,
		channelState.timerState,
		dispatchLiveState,
	]);

	useEffect(() => {
		const dataFetch = async () => {
			try {
				const response = await axiosInstance.get(
					`/quiz-attempts-url/show/${joinid}`
				);
				const serial_numberfilterData =
					response?.data?.data?.quiz?.questions?.sort(
						(
							a: { serial_number: number },
							b: { serial_number: number }
						) => a.serial_number - b.serial_number
					);
				const normalized = normalizeTasks(serial_numberfilterData);
				setTasks(normalized);
			} catch (error) {
				const axiosError = error as AxiosError<{ message?: string }>;
				console.error("Unexpected error:", axiosError.message);
			}
		};
		if (joinid) dataFetch();
	}, [joinid]);

	return (
		<div>
			<QuizPlayComponent
				tasks={tasks}
				sessionStatus={channelState.sessionStatus}
				currentItemId={channelState.currentQuestionId}
			/>
		</div>
	);
}

export default QuizAttempt;
