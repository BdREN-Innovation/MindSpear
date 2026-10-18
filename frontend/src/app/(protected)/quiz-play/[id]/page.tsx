/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { Quiz } from "@/types/types";
import React, { useCallback, useEffect, useState } from "react";

import Summary from "@/features/quiz/components/QuizReports/Summary";
import moment from "@/lib/dayjs";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { setQuiz } from "@/features/quiz/store/quizInformationSlice";
import { useDispatch, useSelector } from "react-redux";
import {
	setQuestData,
	// clearQuestData,
} from "@/features/quest/store/questQuestionTimeSlice";
import {
	changeQuizQuestion,
	getHostLiveSession,
} from "@/features/live/services/liveSessionApi";
import { useLiveSession } from "@/features/live/hooks/useLiveSession";
import { CirclePlay, Users } from "lucide-react";
import {
	setScope,
	userQuizCompletedLastSlider,
} from "@/features/live/store/leaderboardSlice";
import { setQuestSession } from "@/features/quest/store/questSessionSlice";
import { toast } from "react-toastify";
import type {
	HostLiveSessionBootstrap,
	HostParticipantPayload,
	LiveParticipant,
	SessionSnapshot,
	TimerState,
} from "@/features/live/types";

interface QuizResponse {
	quiz: Quiz;
}

interface ActiveUser {
	userName: string;
	userId: string;
}

const participantToActiveUser = (
	participant: LiveParticipant | HostParticipantPayload
): ActiveUser | null => {
	const participantId = participant.participant_id;
	if (!participantId) return null;

	return {
		userId: `${participantId}`,
		userName:
			participant.participant_name?.trim() ||
			`Participant ${participantId}`,
	};
};

const mergeActiveUser = (
	previous: ActiveUser[],
	nextUser: ActiveUser | null
): ActiveUser[] => {
	if (!nextUser) return previous;
	if (previous.some((item) => item.userId === nextUser.userId)) return previous;

	return [...previous, nextUser];
};

function QuizReport() {
	const params = useParams();
	const router = useRouter();
	const searchParams = useSearchParams();
	const dispatch = useDispatch();
	const [response, setresponse] = useState<QuizResponse | any>(null);
	const [sessionResponse, setSessionResponse] = useState<QuizResponse | any>(
		null
	);
	const [bootstrapSession, setBootstrapSession] =
		useState<HostLiveSessionBootstrap | null>(null);
	const [bootstrapStatus, setBootstrapStatus] = useState<
		"checking" | "ready" | "missing" | "error"
	>("checking");
	const [bootstrapError, setBootstrapError] = useState<string | null>(null);
	const quizSession = useSelector(
		(state: any) => state.questSession.questSession
	);
	const sessionIdFromUrl = searchParams.get("sid");
	const { scope } = useSelector((state: any) => state.leaderboard);
	const publicChannelKeyFromUrl = searchParams.get("pck");
	const hasCurrentQuizSession =
		Boolean(quizSession?.id) &&
		Number(quizSession?.quiz_id) === Number(params?.id) &&
		quizSession?.running_status !== false;
	const activeSessionId =
		sessionIdFromUrl ??
		bootstrapSession?.id ??
		(hasCurrentQuizSession ? quizSession?.id : null);
	const activePublicChannelKey =
		publicChannelKeyFromUrl ??
		bootstrapSession?.public_channel_key ??
		(hasCurrentQuizSession ? quizSession?.public_channel_key ?? null : null);

	const [isQuizMode, setIsQuizMode] = useState(true);

	const [participantsActiveNumber, setparticipantsActiveNumber] =
		useState<number>(0);

	const [activeUsersData, setActiveUsersData] = useState<ActiveUser[]>([]);

	const [quizCreated, setQuizCreated] = useState(false);
	const [titleInput, setTitleInput] = useState("");

	const quizId = `${params?.id}`;

	const handleQuizCompletion = useCallback(() => {
		dispatch(userQuizCompletedLastSlider());
	}, [dispatch]);

	useEffect(() => {
		handleQuizCompletion();
		setQuizCreated(true);
	}, [handleQuizCompletion, response?.quiz.title, params?.id]);

	const syncParticipantsFromSnapshot = useCallback((snapshot: SessionSnapshot) => {
		setparticipantsActiveNumber(snapshot.participant_count ?? 0);
		setActiveUsersData(
			(snapshot.active_participants ?? [])
				.map(participantToActiveUser)
				.filter((participant): participant is ActiveUser => Boolean(participant))
		);
	}, []);

	useEffect(() => {
		if (hasCurrentQuizSession) {
			setBootstrapStatus("ready");
			return;
		}

		let cancelled = false;

		const loadHostSession = async () => {
			try {
				setBootstrapStatus("checking");
				const session = await getHostLiveSession("quiz", quizId);
				if (cancelled) return;

				setBootstrapSession(session);
				setBootstrapError(null);
				setBootstrapStatus("ready");
				setparticipantsActiveNumber(session.participant_count ?? 0);
				setActiveUsersData(
					(session.active_participants ?? [])
						.map(participantToActiveUser)
						.filter(
							(participant): participant is ActiveUser =>
								Boolean(participant)
						)
				);
				dispatch(setQuestSession(session));
			} catch (error) {
				if (cancelled) return;

				const axiosError = error as AxiosError<{ message?: string }>;
				if (axiosError.response?.status === 404) {
					setBootstrapSession(null);
					setBootstrapError(null);
					setBootstrapStatus("missing");
					return;
				}

				setBootstrapSession(null);
				setBootstrapStatus("error");
				setBootstrapError(
					axiosError.response?.data?.message ??
						axiosError.message ??
						"Unable to load the active live session."
				);
			}
		};

		void loadHostSession();

		return () => {
			cancelled = true;
		};
	}, [dispatch, hasCurrentQuizSession, quizId]);

	const {
		channelState,
		hostSubscriptionStatus,
		publicSubscriptionStatus,
		error: liveConnectionError,
	} = useLiveSession({
		module: "quiz",
		sessionId: activeSessionId,
		publicChannelKey: activePublicChannelKey,
		role: "host",
		onSnapshot: syncParticipantsFromSnapshot,
		onHostParticipantJoined: (payload) => {
			setparticipantsActiveNumber(payload?.participant_count ?? 0);
			setActiveUsersData((previous) =>
				mergeActiveUser(previous, participantToActiveUser(payload))
			);
		},
		onHostParticipantCountUpdated: (payload) => {
			setparticipantsActiveNumber(payload?.participant_count ?? 0);
		},
	});

	const connected =
		hostSubscriptionStatus === "subscribed" &&
		publicSubscriptionStatus === "subscribed";
	const hasActiveSession = Boolean(activeSessionId);
	const connectionFailed =
		hasActiveSession &&
		(hostSubscriptionStatus === "error" ||
			publicSubscriptionStatus === "error" ||
			Boolean(liveConnectionError));
	const connectionLabel =
		bootstrapStatus === "checking"
			? "Loading live session"
			: bootstrapStatus === "missing"
				? "No active live session"
				: bootstrapStatus === "error"
					? "Live session lookup failed"
					: connectionFailed
						? "Live connection error"
						: connected
							? "Live - Ready to start"
							: hasActiveSession
								? "Connecting to live session"
								: "No active live session";

	useEffect(() => {
		setparticipantsActiveNumber(channelState.participantCount);
	}, [channelState.participantCount]);

	const start = moment.utc(response?.quiz?.open_datetime).startOf("day");
	const end = moment.utc(response?.quiz?.close_datetime).startOf("day");
	const daysLeft = end.diff(start, "days");

	useEffect(() => {
		const dataFetch = async () => {
			const responseData = await axiosInstance.get(
				`/quizes/show/${params?.id}`
			);
			if (activeSessionId) {
				const responseQuizSessionData = await axiosInstance.get(
					`/quizes/show-with-sessions/${activeSessionId}`
				);
				setSessionResponse(responseQuizSessionData?.data.data);
				if (responseQuizSessionData?.data?.data?.session) {
					dispatch(setQuestSession(responseQuizSessionData.data.data.session));
				}
			}
			setresponse(responseData?.data?.data);
			dispatch(setQuiz(responseData?.data?.data));
		};
		dataFetch();
	}, [params?.id, activeSessionId, dispatch]);

	// One choice (two switches could disagree: turning "Quiz Mode" off showed Games mode but kept quiz ranking).
	const chooseMode = (quizMode: boolean) => {
		setIsQuizMode(quizMode);
		dispatch(setScope(quizMode ? "entire" : "slide"));
	};

	// quizeStart
	const quizeStartFunction = async () => {
		if (!hasActiveSession) {
			toast.error("No active live quiz session was found.");
			return;
		}

		try {
			await updateHostLiveSession();
			await handleChangeQuestion();
		} catch (e) {
			console.error("Failed to create quiz:", e);
			toast.error("Quiz start failed");
		}
	};
	useEffect(() => {
		if (quizSession?.title) {
			setTitleInput(quizSession.title);
		}
	}, [quizSession?.title]);

	const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setTitleInput(e.target.value);
	};

	const updateHostLiveSession = async () => {
		if (!activeSessionId) {
			throw new Error("No live quiz session was found.");
		}

		try {
			const payload = {
				title: titleInput,
				quiz_mode: scope === "slide" ? "game" : "quiz",
			};
			const response = await axiosInstance.post(
				`/quizes/update-host-live/${activeSessionId}`,
				payload
			);
			return response.data;
		} catch (error) {
			console.error("Update failed:", error);
			throw error;
		}
	};

	const handleChangeQuestion = async () => {
		if (!activeSessionId) {
			toast.error("No live quiz session was found.");
			return;
		}
		const liveJoinLink =
			sessionResponse?.session?.join_link ?? quizSession?.join_link;
		if (!liveJoinLink) {
			toast.error("No live quiz join link was found.");
			return;
		}

		const question = response?.quiz?.questions.find(
			(item: { serial_number: number }) =>
				Number(item.serial_number) === 1
		);

		const questionId = question?.id || "20";
		const quizQsenStartTime = moment().format("MMMM Do YYYY, h:mm:ss");
		const timeLimit = Number(
			question?.task_data?.time_limit ??
				question?.time_limit_seconds ??
				question?.time_limit ??
				0
		);
		const timerState: TimerState = {
			status: "running",
			start_time: quizQsenStartTime,
			duration_seconds: Number.isFinite(timeLimit) ? timeLimit : 0,
			remaining_seconds: Number.isFinite(timeLimit) ? timeLimit : 0,
		};

		const liveState = await changeQuizQuestion(
			activeSessionId,
			questionId,
			timerState
		);

		dispatch(
			setQuestData({
				questId: quizId,
				questionId: `${liveState.current_question_id ?? questionId}`,
				questiQsenStartTime: quizQsenStartTime,
				questiQsenTime: `${timeLimit || ""}`,
				questiQsenLateStartTime: false,
			})
		);

		router.push(
			`/create-live/quize?jid=${liveJoinLink}&qid=${quizId}&sid=${activeSessionId}&pck=${liveState.public_channel_key}`
		);
	};

	return (
		<div className="h-screen overflow-auto scrollbar-hidden">
			<div className="grid grid-cols-1 md:grid-cols-12 gap-5 ">
				<div className="md:col-span-7 p-6 bg-white rounded-lg border">
					<div className="flex flex-col justify-between h-full">
						<div className="flex items-center justify-between mb-4 p-3 bg-gray-50 rounded-lg">
							<div className="flex items-center gap-2">
								<div
									className={`w-4 h-4 rounded-full ${
										connected
											? "bg-green-500 animate-pulse"
											: "bg-red-500"
									}`}
								/>
								<span className="text-sm font-medium text-gray-700">
									{connectionLabel}
								</span>
							</div>

							<span className="text-sm text-gray-600">
								{participantsActiveNumber}{" "}
								joined
							</span>
						</div>

						<h3 className="text-xl font-bold">
							{" "}
							{response?.quiz.title}{" "}
						</h3>
						<div className="  w-full rounded-[10px] mt-4 ">
							<div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Ranking">
								{[
									{ quiz: true, title: "Quiz mode", text: "Players are ranked by points." },
									{ quiz: false, title: "Game mode", text: "Ranked by points; ties go to the faster player." },
								].map((option) => {
									const active = isQuizMode === option.quiz;
									return (
										<button
											key={option.title}
											type="button"
											role="radio"
											aria-checked={active}
											onClick={() => chooseMode(option.quiz)}
											className={`rounded-lg border-2 p-3 text-left transition ${
												active ? "border-primary bg-[#fff6ee]" : "border-[#e5e5e5] hover:border-primary/50"
											}`}
										>
											<span className="flex items-center gap-2 text-sm font-bold text-[#222]">
												<span
													className={`h-4 w-4 rounded-full border-2 ${
														active ? "border-primary bg-primary shadow-[inset_0_0_0_2px_#fff]" : "border-[#ccc]"
													}`}
												/>
												{option.title}
											</span>
											<span className="mt-1 block text-xs font-normal text-[#777]">{option.text}</span>
										</button>
									);
								})}
							</div>
							{/* <button
								onClick={() => {
									quizeStartFunction();
								}}
								className="mr-[5px] border border-[#2222] px-[30px] rounded-[10px] bg-[#bc5eb3] text-white font-bold"
							>
								{" "}
								Start{" "}
							</button> */}

							<div className="space-y-4">
								<input
									type="text"
									value={titleInput}
									onChange={handleTitleChange}
									placeholder="Session title..."
									className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-primary disabled:bg-gray-100"
									disabled={!hasActiveSession}
								/>

								<button
									onClick={quizeStartFunction}
									disabled={!hasActiveSession}
									className="w-full bg-primary disabled:bg-gray-400 text-white py-3 px-4 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
								>
									{hasActiveSession ? (
										<>
											<CirclePlay size={18} />
											Start Session
										</>
									) : (
										"Waiting for Live Session..."
									)}
								</button>
								{bootstrapError && (
									<p className="text-sm text-red-600">
										{bootstrapError}
									</p>
								)}
							</div>
						</div>
					</div>
				</div>

				<div className="md:col-span-5 p-4 bg-white rounded-lg border h-auto">
					<div className="flex items-center justify-between mb-4">
						<h4 className="text-lg font-semibold text-gray-800">
							Active Participants
						</h4>
						<span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">
							{participantsActiveNumber} Online
						</span>
					</div>

					<div className="space-y-3 max-h-48 overflow-y-auto scrollbar-thin">
						{activeUsersData?.map(
							(
								item: {
									userName: string;
									userId:
										| string
										| number
										| bigint
										| boolean
										| null
										| undefined;
								},
								index: React.Key | null | undefined
							) => (
								<div
									key={index}
									className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border"
								>
									<div className="w-10 h-10 bg-gradient-to-r from-primary to-orange-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
										{item?.userName
											?.charAt(0)
											.toUpperCase()}
									</div>
									<div className="flex-1 min-w-0">
										<p className="font-medium text-gray-900 truncate">
											{item.userName.toUpperCase()}
										</p>
										<p className="text-xs text-gray-500 truncate">
											ID: {item.userId}
										</p>
									</div>
									<div
										className="w-2 h-2 bg-green-500 rounded-full animate-pulse"
										title="Online"
									></div>
								</div>
							)
						)}

						{(!activeUsersData || activeUsersData.length === 0) && (
							<div className="text-center py-6 text-gray-500">
								<div className="w-12 h-12 mx-auto mb-2 bg-gray-200 rounded-full flex items-center justify-center">
									<Users
										className="text-gray-500"
										size={14}
									/>
								</div>
								<p>No active participants</p>
								<p className="text-sm">
									Waiting for users to join...
								</p>
							</div>
						)}
					</div>
				</div>

				<div className="md:col-span-8 p-4 bg-[#fff] rounded-[8px] border h-[200px] relative hidden">
					<h3
						// onClick={handleCreateQuiz}
						className="text-[1.5rem] text-[#222] font-bold mb-[5px]"
					>
						{" "}
						{response?.quiz.title} {connected ? "🟢" : "🔴"}
					</h3>

					<div
						// onClick={() => leaveQuizRoom}
						className="flex gap-3 live_switch"
					>
						<span className="bg-[#f3f4f6] px-6 py-2 rounded-[5px] text-[14px] font-bold">
							{quizCreated ? " Quiz Created" : "Create Quiz"}{" "}
							{participantsActiveNumber}
						</span>
						<span className="bg-[#f3f4f6] px-6 py-2 rounded-[5px] text-[14px] font-bold">
							{" "}
							Competition{" "}
						</span>
						<span className="bg-[#f3f4f6] px-6 py-2 rounded-[5px] text-[14px] font-bold">
							{" "}
							Engagement{" "}
						</span>
					</div>
				</div>
				<div className="md:col-span-4 p-4 bg-[#fff] rounded-[8px] border h-auto hidden ">
					<h4 className="text-[#333333] border-[#2222] border-b-2 pb-[20px] text-[0.875rem]">
						Assigned MindSpear{" "}
						<span className="border border-[#fa9b47] p-2 rounded-[10px] font-bold text-[#fa9b47] ml-[5px]">
							{" "}
							Ends in {daysLeft} {Number(daysLeft) === 1 ? "day" : "days"}{" "}
						</span>
					</h4>
					<h4 className="text-[#333333] border-[#2222] border-b-2 pt-[10px] pb-[10px] text-[0.875rem]">
						Start date: {start.format("YYYY-MM-DD")}
					</h4>
					<h4 className="text-[#333333] border-[#2222] border-b-2 pt-[10px] pb-[10px] text-[0.875rem]">
						End date: {end.format("YYYY-MM-DD")}
					</h4>
					<h4 className="text-[#333333] pt-[6px] pb-[10px] text-[0.875rem]">
						Hosted by {response?.quiz.user.full_name}
					</h4>
				</div>

				<div className="md:col-span-12 p-4 bg-[#fff] rounded-[8px] border shadow-3">
					<Summary
						participantsNumber={participantsActiveNumber}
						urlnamelive="live/"
					/>
				</div>
			</div>
		</div>
	);
}

export default QuizReport;
