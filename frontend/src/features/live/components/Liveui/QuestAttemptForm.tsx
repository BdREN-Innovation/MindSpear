/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import QuizDateClose from "@/components/ErrorComponent/QuizDateClose";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import moment from "@/lib/dayjs";
import { useSearchParams, useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import {
	clearLegacyLiveStorage,
	getLiveSeat,
	rememberLiveSeat,
	storeParticipantTokenBundle,
} from "@/features/live/services/liveStorage";
import {
	JoinIntroCard,
	ParticipantShell,
	ParticipantStage,
	WaitingStage,
} from "./participant-ui";
// import { useDispatch } from "react-redux";
// import { useSocketStatusComparison } from "@/utils/sockerReconnected";

interface QuizResponse {
	quest: any;
	questSession?: { id: number } | null;
}
function QuestAttemptForm() {
	const searchParams = useSearchParams();
	// const dispatch = useDispatch();
	// const { currentStatus, statusAfter2Sec, isStable } = useSocketStatusComparison();
	// console.log(currentStatus, statusAfter2Sec, isStable);
	const router = useRouter();
	const joinid = searchParams.get("jid");
	const [currentUserName, setCurrentUserName] = useState("");
	const [quizData, setQuizData] = useState<QuizResponse | null>(null);
	const [quizErrorMessage, setQuizErrorMessage] = useState<
		string | undefined
	>();
	const [quizErrorStatus, setQuizErrorStatus] = useState<boolean>(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	// This browser's earlier place in the same running session (see rememberLiveSeat).
	const seat = getLiveSeat("quest", joinid);
	const resumable = seat && quizData?.questSession?.id && Number(seat.sessionId) === Number(quizData.questSession.id) ? seat : null;
	const resume = () => {
		if (!resumable) return;
		storeParticipantTokenBundle({
			module: "quest",
			sessionId: resumable.sessionId,
			attemptId: resumable.attemptId,
			participantToken: resumable.participantToken,
			publicChannelKey: resumable.publicChannelKey,
		});
		router.push(resumable.playUrl);
	};
	useEffect(() => {
		if (typeof window !== "undefined" && !navigator.onLine) {
			console.warn("Offline — skipping API call");
			return;
		}
		const dataFetch = async () => {
			try {
				const response = await axiosInstance.get<{
					data: QuizResponse;
				}>(`/quest-attempts-url/show-by-link/${joinid}`);
				setQuizData(response?.data?.data);
			} catch (error) {
				const axiosError = error as AxiosError<{
					message?: string;
				}>;
				if (axiosError.response) {
					const msg =
						axiosError.response.data?.message ||
						"Verification failed.";
					console.error("Error verifying token:", msg);
					setQuizErrorMessage(msg);
					setQuizErrorStatus(true);
				} else {
					console.error("Unexpected error:", axiosError.message);
					setQuizErrorMessage(
						"Unexpected error occurred. Please try again.",
					);
					setQuizErrorStatus(true);
				}
			} finally {
			}
		};
		dataFetch();
	}, [joinid]);
	const clearQuestionDataFromStorage = () => {
		if (typeof window !== "undefined") {
			localStorage.removeItem("quiz_currentQuestion");
			localStorage.removeItem("quiz_questions");
			localStorage.removeItem("quiz_questionsId");
			const keys = Object.keys(localStorage);
			keys.forEach((key) => {
				if (key.startsWith("attempt-")) {
					localStorage.removeItem(key);
				}
			});
		}
	};
	useEffect(() => {
		clearQuestionDataFromStorage();
	}, []);

	// 	setInterval(() => {
	//     //console.log("⏰ 2-second tick:", currentSocket?.connected);
	//     //console.log("⏰ 2-second tick:", new Date().toLocaleTimeString());
	//     // Your function logic here
	// }, 3000);

	const userId = Math.floor(Math.random() * 10000).toString();
	const dataSubmit = async () => {
		if (!currentUserName.trim()) {
			toast.error("Please enter your name");
			return;
		}
		setIsSubmitting(true);
		// A new player: drop the previous one's per-question marks (cleared on page load before,
		// which also lost them for a player coming back to carry on).
		clearLegacyLiveStorage();
		try {
			const formattedDate = quizData?.quest?.start_datetime
				? moment
						.utc(quizData?.quest?.start_datetime)
						.format("YYYY-MM-DD HH:mm:ss")
				: null;
			const obj = {
				anonymous_name: `${currentUserName}`,
				start_time: `${formattedDate}`,
			};
			const response = await axiosInstance.post(
				`/quest-attempts-url/join-by-link/${joinid}`,
				obj,
			);
			const responseData = response?.data?.data as any;
			const attemptId = responseData?.attempt?.id;
			const sessionId = responseData?.attempt?.quest_session_id;
			const publicChannelKey = responseData?.public_channel_key;
			const participantToken = responseData?.participant_token;
			if (
				!attemptId ||
				!sessionId ||
				!publicChannelKey ||
				!participantToken
			) {
				toast.error(
					"Unable to join this live quest. Missing session metadata.",
				);
				setIsSubmitting(false);
				return;
			}
			storeParticipantTokenBundle({
				module: "quest",
				sessionId: Number(sessionId),
				attemptId: Number(attemptId),
				participantToken,
				publicChannelKey,
			});
			const playUrl = `/attempt/quest-live/play/${responseData?.quest?.join_code}?jid=${responseData?.quest?.join_link}&qid=${responseData?.quest?.id}&aid=${attemptId}&sid=${sessionId}&pck=${publicChannelKey}&ujid=${userId}&title=${encodeURIComponent(quizData?.quest?.title ?? "")}&uname=${encodeURIComponent(currentUserName)}`;
			if (joinid) {
				rememberLiveSeat("quest", joinid, {
					sessionId: Number(sessionId),
					attemptId: Number(attemptId),
					participantToken,
					publicChannelKey,
					name: currentUserName.trim(),
					playUrl,
				});
			}
			router.push(playUrl);
		} catch (error) {
			const axiosError = error as AxiosError<{
				message?: string;
			}>;
			setIsSubmitting(false);
			if (axiosError.response) {
				console.error(
					"Error verifying token:",
					axiosError.response.data,
				);
				toast.error(
					`Error: ${axiosError.response.data?.message || "Verification failed."}`,
				);
			} else {
				console.error("Unexpected error:", axiosError.message);
				toast.error("Unexpected error occurred. Please try again.");
			}
		} finally {
		}

		// currentUserName
	};

	// If the fetched quest has ended, show a clear message and prevent any actions
	if (quizData?.quest?.status === "Ended") {
		return (
			<ParticipantShell variant="quest" sessionStatus="ended">
				<ParticipantStage size="narrow" className="bg-white/95 p-5">
					<QuizDateClose
						errorTest={
							"This quest has ended. You cannot join or perform any actions."
						}
						errorStatus={true}
					/>
				</ParticipantStage>
			</ParticipantShell>
		);
	}
	if (quizErrorStatus) {
		return (
			<ParticipantShell variant="quest" sessionStatus="ended">
				<ParticipantStage size="narrow" className="bg-white/95 p-5">
					<QuizDateClose
						errorTest={quizErrorMessage}
						errorStatus={quizErrorStatus}
					/>
				</ParticipantStage>
			</ParticipantShell>
		);
	}
	if (quizData === null) {
		return (
			<ParticipantShell variant="quest" sessionStatus="pending">
				<WaitingStage
					mode="lobby"
					title="Loading live quest"
					message="We are checking the session and getting your lobby ready."
					statusLabel="Connecting"
				/>
			</ParticipantShell>
		);
	}
	return (
		<ParticipantShell
			variant="quest"
			title={quizData?.quest?.title}
			participantName={currentUserName}
			sessionStatus="pending"
		>
			<JoinIntroCard
				module="quest"
				title={quizData?.quest?.title}
				name={currentUserName}
				onNameChange={setCurrentUserName}
				onSubmit={dataSubmit}
				countLabel={
					quizData?.quest?.tasks?.length
						? `${quizData.quest.tasks.length} question${quizData.quest.tasks.length === 1 ? "" : "s"}`
						: "Ready"
				}
				isSubmitting={isSubmitting}
				resumeName={resumable?.name}
				onResume={resume}
			/>
		</ParticipantShell>
	);
}
export default QuestAttemptForm;
