/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import ChoiceComponent from "./ChoiceComponent";
import ShortAnswerComponent from "./ShortAnswerComponent";
import QuickFormPreview from "./QuickFormPreview";
import Leaderboard from "@/components/Dashboard/Leaderboard";
import { useSearchParams, useRouter } from "next/navigation";
import { completeParticipantAttempt } from "@/features/live/services/participantApi";
import { getParticipantToken } from "@/features/live/services/liveStorage";
import type { LiveSessionStatus } from "@/features/live/types";
import {
	ParticipantShell,
	ParticipantStage,
	WaitingStage,
} from "./participant-ui";

export interface TaskItem {
	id: number;
	quest_id: number;
	title: string;
	description?: string | null;
	task_type?: string;
	question_type?: string;
	serial_number: number;
	is_required?: boolean;
	created_at?: string;
	updated_at?: string;
	questions?: any[];
}

const UnsupportedComponent: React.FC<{ task: TaskItem }> = ({ task }) => (
	<div className="max-w-xl mx-auto space-y-3">
		<h3 className="text-2xl font-semibold text-gray-900 text-center">
			Unsupported task type
		</h3>
		<p className="text-center text-sm text-gray-500">
			Type: {task.task_type}
		</p>
		<p className="text-center text-sm text-gray-500">ID: {task.id}</p>
		<p className="text-center text-base">{task.title}</p>
	</div>
);

const componentForTaskType = (
	t: string
): React.ElementType<{ task: TaskItem }> => {
	const key = (t || "").toLowerCase();

	if (
		key === "single_choice" ||
		key === "quiz_single_choice" ||
		key === "multiple_choice" ||
		key === "quiz_multiple_choice" ||
		key === "scales" ||
		key === "ranking" ||
		key === "fill_in_the_blanks_choice" ||
		key === "sorting" ||
		key === "truefalse" ||
		key === "true_false_choice"
	) {
		return ChoiceComponent;
	}

	if (key === "quick_form") return QuickFormPreview;
	if (
		key === "shortanswer" ||
		key === "longanswer" ||
		key === "wordcloud" ||
		key === "sort_answer_choice"
	) {
		return ShortAnswerComponent;
	}

	return UnsupportedComponent;
};

export interface NavigatorProps {
	tasks: TaskItem[];
	currentItemId?: number | null;
	sessionStatus?: LiveSessionStatus;
}

const QuizPlayComponent: React.FC<NavigatorProps> = ({
	tasks,
	currentItemId,
	sessionStatus,
}) => {
	const router = useRouter();
	const searchParams = useSearchParams();
	const attemptId = searchParams.get("aid");
	const sessionId = searchParams.get("sid");
	const quizId = searchParams.get("qid");
	const quizTitle = searchParams.get("title");
	const userName = searchParams.get("uname");
	const [leaderboardVisible, setLeaderboardVisible] = useState(false);
	const completionStartedRef = useRef(false);

	const ordered = useMemo(
		() =>
			[...tasks].sort(
				(a, b) => a.serial_number - b.serial_number || a.id - b.id
			),
		[tasks]
	);

	const currentTask = useMemo(() => {
		if (!currentItemId) return null;
		return (
			ordered.find((task) => Number(task.id) === Number(currentItemId)) ??
			null
		);
	}, [currentItemId, ordered]);

	useEffect(() => {
		if (sessionStatus !== "ended" || completionStartedRef.current) return;
		completionStartedRef.current = true;

		const completeAndRedirect = async () => {
			const participantToken = getParticipantToken("quiz", sessionId);

			try {
				if (participantToken && attemptId) {
					await completeParticipantAttempt(
						"quiz",
						attemptId,
						participantToken
					);
				}
			} catch (error) {
				// Ending the session already scores every attempt (and revokes the token), so a
				// refused call here is expected; only something else is worth reporting.
				const status = (error as { response?: { status?: number } })?.response?.status;
				if (status !== 400 && status !== 401) {
					console.error("Failed to complete quiz participant:", error);
				}
			} finally {
				setLeaderboardVisible(true);
				if (sessionId && quizId) {
					// The attempt marks this player's own place on the leaderboard.
					router.replace(
						`/quiz-result-view/${sessionId}?qid=${quizId}&aid=${attemptId ?? ""}&title=${encodeURIComponent(quizTitle ?? "")}&uname=${encodeURIComponent(userName ?? "")}`
					);
				}
			}
		};

		void completeAndRedirect();
	}, [attemptId, quizId, quizTitle, router, sessionId, sessionStatus, userName]);

	const Body: any = currentTask
		? componentForTaskType(
				String((currentTask.question_type || currentTask.task_type) ?? "")
			)
		: null;

	return (
		<ParticipantShell
			variant="quiz"
			title={quizTitle}
			participantName={userName}
			sessionStatus={leaderboardVisible ? "ended" : sessionStatus}
		>
			{leaderboardVisible ? (
				<ParticipantStage size="full" className="bg-white/95 p-4">
					<Leaderboard scope="entire" />
				</ParticipantStage>
			) : (
				<>
					{currentTask && Body ? (
						<Body task={currentTask as TaskItem} />
					) : (
						<WaitingStage
							mode="lobby"
							title="You're in the quiz lobby"
							message="Stay ready. The host will launch the first question soon."
							statusLabel="Connected to live quiz"
						/>
					)}
				</>
			)}
		</ParticipantShell>
	);
};

export default QuizPlayComponent;
