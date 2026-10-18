/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import QuizDateClose from "@/components/ErrorComponent/QuizDateClose";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import moment from "@/lib/dayjs";
import { useSearchParams, useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import {
	clearLegacyLiveStorage,
	storeParticipantTokenBundle,
} from "@/features/live/services/liveStorage";
import { toast } from "react-toastify";
import {
	JoinIntroCard,
	ParticipantShell,
	ParticipantStage,
	WaitingStage,
} from "./participant-ui";
interface QuizOption {
	color: string[];
	choices: (string | null)[];
	correct_answer: number;
}
interface Question {
	id: number;
	quiz_id: number;
	serial_number: number | null;
	question_text: string;
	question_type: string | null;
	time_limit_seconds: number | null;
	points: number | null;
	is_ai_generated: boolean;
	source_content_url: string | null;
	options: QuizOption | null;
	visibility: string;
	deleted_at: string | null;
	deleted_by: number | null;
	created_at: string;
	updated_at: string;
}
interface User {
	id: number;
	first_name: string;
	last_name: string;
	email: string;
	phone: string;
	email_verified_at: string;
	email_verification_token: string | null;
	is_verified: boolean;
	profile_picture: string;
	account_type: string;
	institution_id: number | null;
	institution_name: string;
	designation: string;
	department: string;
	provider: string | null;
	provider_id: string | null;
	created_at: string;
	updated_at: string;
	full_name: string;
	institution: string | null;
}
interface Quiz {
	id: number;
	title: string;
	description: string | null;
	category_id: number | null;
	is_published: boolean;
	open_datetime: string;
	close_datetime: string;
	quiztime_mode: boolean;
	duration: number;
	logged_in_users_only: boolean;
	safe_browser_mode: boolean;
	visibility: string;
	quiz_mode: string;
	timezone: string;
	join_link: string;
	join_code: string;
	deleted_at: string | null;
	user_id: number;
	deleted_by: number | null;
	created_at: string;
	updated_at: string;
	questions: Question[];
	user: User;
}
interface QuizResponse {
	quiz: Quiz;
}
function QuizAttemptForm() {
	const searchParams = useSearchParams();
	// const pathname = usePathname();
	// const isLivePagesStatus = pathname.includes("live");
	const router = useRouter();
	// const id = params?.id;
	const joinid = searchParams.get("jid");
	const [currentUserName, setCurrentUserName] = useState("");
	const [quizData, setQuizData] = useState<QuizResponse | null>(null);
	const [quizErrorMessage, setQuizErrorMessage] = useState<
		string | undefined
	>();
	const [quizErrorStatus, setQuizErrorStatus] = useState<boolean>(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	useEffect(() => {
		clearLegacyLiveStorage();
	}, [joinid]);
	useEffect(() => {
		const dataFetch = async () => {
			try {
				const response = await axiosInstance.get<{
					data: QuizResponse;
				}>(`/quiz-attempts-url/show/${joinid}`);
				setQuizData(response?.data.data);
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
	const userId = Math.floor(Math.random() * 10000).toString();
	const dataSubmit = async () => {
		if (!currentUserName.trim()) {
			toast.error("Please enter your name");
			return;
		}
		setIsSubmitting(true);
		try {
			const formattedDate = quizData?.quiz?.open_datetime
				? moment
						.utc(quizData?.quiz?.open_datetime)
						.format("YYYY-MM-DD HH:mm:ss")
				: null;
			const obj = {
				anonymous_name: `${currentUserName}`,
				start_time: `${formattedDate}`,
			};
			const response = await axiosInstance.post(
				`/quiz-attempts-url/join/${joinid}`,
				obj,
			);
			const responseData = response?.data?.data as any;
			const attemptId = responseData?.attempt?.id;
			const sessionId = responseData?.session?.id;
			const publicChannelKey = responseData?.public_channel_key;
			const participantToken = responseData?.participant_token;
			if (
				!attemptId ||
				!sessionId ||
				!publicChannelKey ||
				!participantToken
			) {
				toast.error(
					"Unable to join this live quiz. Missing session metadata.",
				);
				setIsSubmitting(false);
				return;
			}
			storeParticipantTokenBundle({
				module: "quiz",
				sessionId: Number(sessionId),
				attemptId: Number(attemptId),
				participantToken,
				publicChannelKey,
			});
			router.push(
				`/attempt/quize/play/${responseData?.session?.join_code}?jid=${responseData?.session?.join_link}&qid=${responseData?.quiz?.id}&aid=${attemptId}&sid=${sessionId}&pck=${publicChannelKey}&ujid=${userId}&title=${quizData?.quiz?.title}&uname=${currentUserName}`,
			);

			// console.log(response, "response?.data.dataresponse?.data.data");
			// 	const quizId = `${qid}`
			// 	const userId = Math.floor(Math.random() * 10000).toString();
			// 	const userName = `${currentUserName}`;
			// try {
			// 	await emitJoinQuiz({ quizId, userId, userName });
			// 	const joined = await waitForQuizJoinedOnce();
			// 	// const startedStatus = await waitForQuizStartedAll();
			// 	//console.log("✅ quizJoined:", joined);
			// 	// //console.log("✅ quizJoined:", startedStatus);

			// } catch (e) {
			// 	console.error("Failed to create quiz:", e);
			// }
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
	if (quizErrorStatus) {
		return (
			<ParticipantShell variant="quiz" sessionStatus="ended">
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
			<ParticipantShell variant="quiz" sessionStatus="pending">
				<WaitingStage
					mode="lobby"
					title="Loading live quiz"
					message="We are checking the session and getting your lobby ready."
					statusLabel="Connecting"
				/>
			</ParticipantShell>
		);
	}
	const qsenList = quizData.quiz.questions.filter(
		(question) => question.options !== null,
	);
	return (
		<ParticipantShell
			variant="quiz"
			title={quizData?.quiz?.title}
			participantName={currentUserName}
			sessionStatus="pending"
		>
			<JoinIntroCard
				module="quiz"
				title={quizData?.quiz?.title}
				name={currentUserName}
				onNameChange={setCurrentUserName}
				onSubmit={dataSubmit}
				countLabel={
					quizData?.quiz?.questions?.length
						? `${qsenList.length} question${qsenList.length === 1 ? "" : "s"}`
						: "Ready"
				}
				isSubmitting={isSubmitting}
			/>
		</ParticipantShell>
	);
}
export default QuizAttemptForm;
