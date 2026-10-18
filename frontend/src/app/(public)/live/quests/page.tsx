/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useEffect, useMemo, useState } from "react";
import HostLiveHeader from "./HostLiveHeader";
import HostLiveQuestionView from "./HostLiveQuestionView";
import HostLiveNavigationControls from "./HostLiveNavigationControls";
import HostLiveLeftSideBar from "./HostLiveLeftSideBar";
import { useDispatch, useSelector } from "react-redux";
import {
	nextSlide,
	prevSlide,
	setCurrentSlideIndex,
	setTotalSlides,
	forceEndLive,
} from "@/features/live/store/leaderboardSlice";
import QuestCompletedPages from "@/features/quest/components/QuestCompletedPages";
import { AxiosError } from "axios";
import { useSearchParams } from "next/navigation";

import axiosInstance from "@/utils/axiosInstance";
import moment from "@/lib/dayjs";
import { setQuestData } from "@/features/quest/store/questQuestionTimeSlice";
import { Modal } from "@/components/ui";
import { useLiveSession } from "@/features/live/hooks/useLiveSession";
import {
	aggregatePayloadToResult,
	type LiveResultDatum,
} from "@/features/live/services/aggregateResults";
import { buildHostLiveViewModel } from "@/features/live/services/hostLiveViewModel";
import {
	changeQuestTask,
	endLiveSession,
} from "@/features/live/services/liveSessionApi";
import type { SessionSnapshot, TimerState } from "@/features/live/types";
import { toast } from "react-toastify";
import {
	QuestHostLiveShell,
	QuestHostStage,
	QuestHostWaitingStage,
} from "@/features/live/components/quest-host-ui";
import {
	isQuestHostMusicArmed,
	playQuestCountdownAudio,
	startQuestHostMusic,
	stopQuestHostMusic,
} from "@/features/live/services/questHostAudio";

const sleep = (ms: number) =>
	new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});

type Task = {
	[x: string]: any;
	id: number;
	title: string;
	task_type: string;
	open_datetime?: string;
	close_datetime?: string;
	created_at?: string;
	updated_at?: string;
	contant_title?: string;
	image_url?: string;
	layout_id?: string;
	description: string | null;
	serial_number: number;
	duration: number;
	quest_id: number;
	session_id: number;
	maxNumber?: number;
	minNumber?: number;
	quiztime_mode?: boolean;
	is_required: boolean;
	task_data: {
		questions?: { id: number | string; text: string; color?: string }[];
		time_limit?: number;
		// Scales: the range and what its ends mean.
		minNumber?: number;
		maxNumber?: number;
		minText?: string;
		maxText?: string;
	};
};

type Quest = {
	id: number;
	title: string;
	tasks: Task[];
};

/* Map quiz question types -> viewer-understood task_type */
function mapQuizTypeToTaskType(qtype: string): string {
	switch (qtype) {
		// SINGLE CHOICE
		case "quiz_single_choice":
			return "single_choice";
		case "quiz_multiple_choice":
			return "multiple_choice";
		// MULTIPLE CHOICE
		case "multiple_choice":
			return "multiple_choice";
		case "true_false_choice":
			return "truefalse";
		case "truefalse":
			return "truefalse";
		case "sort_answer_choice":
			return "shortanswer";
		case "fill_in_the_blanks_choice":
			return "single_choice";
		case "wordcloud":
			return "wordcloud";
		case "scales":
			return "scales";
		case "ranking":
			return "ranking";
		case "longanswer":
			return "longanswer";
		case "sorting":
			return "sorting";
		case "quick_form":
			return "quick_form";
		case "single_choice":
			return "single_choice";
		case "shortanswer":
			return "shortanswer";
		case "content":
			return "content";
		default:
			return "";
	}
}

/* Normalize quizeData.questions -> Quest.tasks shape */

function normalizeQuizeToQuest(quizeData: any): Quest {
	const tasks: Task[] = [...quizeData.tasks]
		.map((q, idx): Task => {
			return {
				id: q.id,
				quest_id: quizeData.id,
				session_id: quizeData.questSession?.id,
				title: q.title,
				description: null,
				task_type: mapQuizTypeToTaskType(q.task_type),
				serial_number: q.serial_number ?? idx + 1,
				task_data: {
					questions: q?.task_data?.questions,
					// time_limit: q.time_limit_seconds ? q.time_limit_seconds : q?.time_limit,
					time_limit: q?.task_data?.time_limit ?? 0,
					minNumber: q?.task_data?.minNumber,
					maxNumber: q?.task_data?.maxNumber,
					minText: q?.task_data?.minText,
					maxText: q?.task_data?.maxText,
				},
				is_required: true,
				open_datetime: quizeData.start_datetime,
				close_datetime: quizeData.end_datetime,
				duration: quizeData.duration || 0,
				quiztime_mode: quizeData.quiztime_mode || false,
				maxNumber: q?.task_data?.maxNumber,
				minNumber: q?.task_data?.minNumber,
				contant_title: q?.task_data?.contant_title,
				image_url: q?.task_data?.image_url?.path,
				layout_id: q?.task_data?.layout_id,
			};
		})
		.sort((a, b) => (a.serial_number ?? 0) - (b.serial_number ?? 0));
	return { id: quizeData.id, title: quizeData.title, tasks };
}

/* Guard against duplicate ids in results (your sample has id: 43 twice) */
function uniqueById<T extends { id: number }>(arr: T[]): T[] {
	const seen = new Set<number>();
	const out: T[] = [];
	// keep the LAST occurrence
	for (let i = arr.length - 1; i >= 0; i--) {
		const item = arr[i];
		if (!seen.has(item.id)) {
			out.unshift(item);
			seen.add(item.id);
		}
	}
	return out;
}

export default function LiveQuiz() {
	const [endModalOpen, setEndModalOpen] = useState(false);
	const [sessionId, setSessionId] = useState<number | null>(null);
	const [publicChannelKey, setPublicChannelKey] = useState<string | null>(
		null
	);

	const [isFullscreen, setIsFullscreen] = useState(false);
	const [chartType, setChartType] = useState<
		"bar" | "donut" | "dots" | "pie"
	>("bar");
	const [countdownValue, setCountdownValue] = useState<number | null>(null);
	const [isAdvancing, setIsAdvancing] = useState(false);
	const [joinCode, setJoinCode] = useState<string | null>(null);

	const [quest, setQuest] = useState<Quest | null>(null);
	const [results, setResults] = useState<LiveResultDatum[]>([]);
	const { scope } = useSelector((state: any) => state.leaderboard);

	const searchParams = useSearchParams();
	const quizeIdString = searchParams.get("qid");
	const sessionIdFromUrl = searchParams.get("sid");
	const publicChannelKeyFromUrl = searchParams.get("pck");

	const questId = `${quizeIdString}`;
	const questjoinlink = searchParams.get("jlk");

	const dispatch = useDispatch();
	const {
		lastSlideReached,
		showLeaderboard,
		currentSlideIndex,
		totalSlides,
	} = useSelector((state: any) => state.leaderboard);

	const toggleFullscreen = () => {
		if (!isFullscreen)
			document.documentElement
				.requestFullscreen()
				.catch((e) => console.error("Fullscreen error:", e));
		else if (document.fullscreenElement) document.exitFullscreen();
	};

	const handleFullscreenChange = () =>
		setIsFullscreen(!!document.fullscreenElement);

	const activeSessionId = sessionId ?? sessionIdFromUrl;
	const {
		channelState,
		applySnapshot: applyLiveSnapshot,
	} = useLiveSession({
		module: "quest",
		sessionId: activeSessionId,
		publicChannelKey: publicChannelKey ?? publicChannelKeyFromUrl,
		role: "host",
	});

	useEffect(() => {
		if (channelState.sessionStatus === "ended") {
			setEndModalOpen(false);
			dispatch(forceEndLive());
			stopQuestHostMusic();
		}
	}, [channelState.sessionStatus, dispatch]);

	useEffect(() => {
		if (!channelState.currentTaskId) return;

		dispatch(
			setQuestData({
				questId,
				questionId: `${channelState.currentTaskId}`,
				questiQsenStartTime:
					typeof channelState.timerState?.start_time === "string"
						? channelState.timerState.start_time
						: moment().format("MMMM Do YYYY, h:mm:ss"),
				questiQsenTime: `${
					channelState.timerState?.duration_seconds ??
					channelState.timerState?.remaining_seconds ??
					""
				}`,
				questiQsenLateStartTime: false,
			})
		);
	}, [
		channelState.currentTaskId,
		channelState.timerState,
		dispatch,
		questId,
	]);

	useEffect(() => {
		if (channelState.sessionStatus === "ended") return;
		if (!quest || !channelState.currentTaskId) return;

		const nextIndex = quest.tasks.findIndex(
			(task) => Number(task.id) === Number(channelState.currentTaskId)
		);

		if (nextIndex >= 0 && nextIndex !== currentSlideIndex) {
			dispatch(setCurrentSlideIndex(nextIndex));
		}
	}, [
		channelState.currentTaskId,
		channelState.sessionStatus,
		currentSlideIndex,
		dispatch,
		quest,
	]);

	useEffect(() => {
		if (!channelState.answerAggregate || !quest) return;

		const taskId = Number(channelState.answerAggregate.task_id);
		const task = (quest?.tasks ?? []).find((item) => Number(item.id) === taskId);
		if (!task) return;

		const result = aggregatePayloadToResult(channelState.answerAggregate, task);
		if (!result) return;

		setResults((previous) =>
			uniqueById([
				...previous.filter((item) => Number((item as any).id) !== result.id),
				result,
			])
		);
	}, [channelState.answerAggregate, quest]);

	useEffect(() => {
		if (typeof window !== "undefined" && !navigator.onLine) {
			console.warn("Offline — skipping API call");
			return;
		}

		const loadFromFile = async () => {
			try {
				{
					const dataFetch = async () => {
						try {
							const response = await axiosInstance.get(
								`/quests/start-by-admin/${questjoinlink}`
							);

							const questData = response?.data?.data;

							const normalized = normalizeQuizeToQuest({
								...questData.quest,
								questSession: questData.questSession,
							});

							setQuest(normalized);
							setJoinCode(questData?.quest?.join_code ?? null);
							setResults([]);
							setSessionId(questData.questSession.id);
							setPublicChannelKey(
								questData.questSession.public_channel_key ?? null
							);

							dispatch(
								setTotalSlides(normalized.tasks.length || 0)
							);
						} catch (error) {
							const axiosError = error as AxiosError<{
								message?: string;
							}>;
							console.error("Error verifying token:", axiosError);
						} finally {
						}
					};
					dataFetch();
				}
			} catch (error) {
				const axiosError = error as AxiosError<{ message?: string }>;
				if (axiosError?.response) {
					console.error(
						"Error loading data:",
						axiosError.response.data?.message || "Load failed."
					);
				} else {
					console.error(
						"Unexpected error:",
						(error as Error).message
					);
				}
			}
		};
		loadFromFile();
	}, [questjoinlink]);

	// derive slides (tasks) + current task
	const tasks: Task[] = quest?.tasks ?? [];

	const currentTask: Task | null = tasks.length
		? tasks[Math.min(currentSlideIndex, tasks.length - 1)]
		: null;

	useEffect(() => {
		if (!currentTask) return;

		setChartType(currentTask.task_type === "truefalse" ? "pie" : "bar");
	}, [currentTask?.id, currentTask?.task_type]);

	// map result by task id for quick lookup
	const resultByTaskId = useMemo(() => {
		const m = new Map<number, LiveResultDatum>();

		for (const r of results) m.set(r.id, r);
		return m;
	}, [results]);

	// compute view model
	const viewModel = useMemo(() => {
		if (!currentTask) return null;
		return buildHostLiveViewModel(
			currentTask,
			resultByTaskId.get(currentTask.id) ?? null
		);
	}, [currentTask, resultByTaskId]);

	// fullscreen listeners
	useEffect(() => {
		const onEsc = (e: KeyboardEvent) => {
			if (e.key === "Escape" && document.fullscreenElement)
				document.exitFullscreen();
		};
		document.addEventListener("fullscreenchange", handleFullscreenChange);
		document.addEventListener("keydown", onEsc);
		return () => {
			document.removeEventListener(
				"fullscreenchange",
				handleFullscreenChange
			);
			document.removeEventListener("keydown", onEsc);
		};
	}, []);

	const timerStateForTask = (task: Task): TimerState => {
		const timeLimit = Number(task?.task_data?.time_limit ?? 0);
		const duration = Number.isFinite(timeLimit) ? timeLimit : 0;

		return {
			status: "running",
			start_time: moment().format("MMMM Do YYYY, h:mm:ss"),
			duration_seconds: duration,
			remaining_seconds: duration,
		};
	};

	const applyCommittedState = (
		liveState: SessionSnapshot,
		task: Task,
		index: number
	) => {
		applyLiveSnapshot(liveState);
		dispatch(
			setQuestData({
				questId,
				questionId: `${liveState.current_task_id ?? task.id}`,
				questiQsenStartTime:
					typeof liveState.timer_state?.start_time === "string"
						? liveState.timer_state.start_time
						: moment().format("MMMM Do YYYY, h:mm:ss"),
				questiQsenTime: `${
					liveState.timer_state?.duration_seconds ??
					liveState.timer_state?.remaining_seconds ??
					task.task_data?.time_limit ??
					""
				}`,
				questiQsenLateStartTime: false,
			})
		);
		dispatch(setCurrentSlideIndex(index));
	};

	const handleNext = async () => {
		if (!quest || !activeSessionId) return;
		const nextIndex = Math.min(
			currentSlideIndex + 1,
			(quest.tasks?.length ?? 1) - 1
		);
		const nextTask = quest.tasks[nextIndex];
		if (nextTask) {
			const liveState = await changeQuestTask(
				activeSessionId,
				nextTask.id,
				timerStateForTask(nextTask)
			);
			applyCommittedState(liveState, nextTask, nextIndex);
		}
		if (!(showLeaderboard && lastSlideReached) && !nextTask) {
			dispatch(nextSlide());
		}
	};

	const runCountdownAndNext = async () => {
		if (isAdvancing) return;

		setIsAdvancing(true);
		void startQuestHostMusic();

		try {
			void playQuestCountdownAudio();
			for (const value of [3, 2, 1]) {
				setCountdownValue(value);
				await sleep(1000);
			}
			setCountdownValue(null);
			await handleNext();
		} catch (error) {
			console.error("Failed to advance quest slide:", error);
			toast.error("Unable to move to the next quest slide.");
			setCountdownValue(null);
		} finally {
			setIsAdvancing(false);
		}
	};

	const handleNextWithConfirm = async () => {
		if (!quest) return;

		const isLast = currentSlideIndex === quest.tasks.length - 1;

		if (isLast) {
			setEndModalOpen(true);
			return;
		}

		await runCountdownAndNext();
	};

	const handlePrev = async () => {
		if (!quest || !activeSessionId) return;
		const nextIndex = Math.max(
			currentSlideIndex - 1,
			0
		);
		const nextTask = quest.tasks[nextIndex];
		if (nextTask) {
			const liveState = await changeQuestTask(
				activeSessionId,
				nextTask.id,
				timerStateForTask(nextTask)
			);
			applyCommittedState(liveState, nextTask, nextIndex);
		}
		if (!nextTask) dispatch(prevSlide());
	};

	const endHostLive = async () => {
		if (!activeSessionId) {
			console.error("session_id missing");
			return;
		}
		try {
			await endLiveSession("quest", activeSessionId);

			setEndModalOpen(false);
			dispatch(forceEndLive());
			stopQuestHostMusic();
		} catch (err) {
			console.error("Failed to end live", err);
			toast.error("Failed to end quest live session.");
		}
	};
	const handleCloseClick = () => {
		setEndModalOpen(true);
	};

	useEffect(() => {
		if (isQuestHostMusicArmed()) void startQuestHostMusic();

		const resumeMusic = () => {
			if (isQuestHostMusicArmed()) void startQuestHostMusic();
		};

		window.addEventListener("pointerdown", resumeMusic, { once: true });
		return () => window.removeEventListener("pointerdown", resumeMusic);
	}, []);

	return (
		<QuestHostLiveShell isFullscreen={isFullscreen}>
			<div className="px-3 pt-3 sm:px-5 lg:px-8">
				{/* A quest has no leaderboard: it is shown once the quest has ended, when nobody can join. */}
				<HostLiveHeader
					onClose={handleCloseClick}
					joinCode={showLeaderboard ? null : joinCode}
					label={showLeaderboard ? "Ended" : undefined}
				/>
			</div>
			{!showLeaderboard && (
				<div className="fixed left-3 top-24 z-[80] hidden lg:block">
					<HostLiveLeftSideBar
						onChartTypeChange={(type) => setChartType(type)}
						activeChartType={chartType}
					/>
				</div>
			)}
			{showLeaderboard ? (
				<QuestCompletedPages pagesStatus={"creator"} />
			) : viewModel ? (
				<HostLiveQuestionView
					isFullscreen={isFullscreen}
					chartType={chartType}
					viewModel={viewModel}
					participantCount={channelState.participantCount}
				/>
			) : (
				<QuestHostStage>
					<QuestHostWaitingStage
						title={totalSlides === 0 ? "Loading quest" : "No slide to show"}
						subtitle="We are preparing the host presentation stage."
						participantCount={channelState.participantCount}
					/>
				</QuestHostStage>
			)}

			{scope === "slide" ? (
				<HostLiveNavigationControls
					currentView={viewModel?.currentView || "choice"}
					isFullscreen={isFullscreen}
					onPrev={handlePrev}
					// onNext={handleNextSlide}
					onNext={handleNextWithConfirm}
					onToggleFullscreen={toggleFullscreen}
					isBusy={isAdvancing}
					isFirst={currentSlideIndex === 0}
					isLast={!!quest && currentSlideIndex === quest.tasks.length - 1}
				/>
			) : (
				<>
					{!showLeaderboard && (
						<HostLiveNavigationControls
							currentView={viewModel?.currentView || "choice"}
							isFullscreen={isFullscreen}
							onPrev={handlePrev}
							onNext={handleNextWithConfirm}
							onToggleFullscreen={toggleFullscreen}
							isBusy={isAdvancing}
							isFirst={currentSlideIndex === 0}
							isLast={!!quest && currentSlideIndex === quest.tasks.length - 1}
						/>
					)}
				</>
			)}
			{countdownValue !== null && (
				<div className="fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden bg-slate-950/95 text-white backdrop-blur-sm">
					<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(247,153,69,.28),transparent_35%),linear-gradient(135deg,rgba(188,94,179,.18),transparent_40%),linear-gradient(225deg,rgba(237,58,118,.16),transparent_36%)]" />
					<div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.14)_1px,transparent_1px)] [background-size:42px_42px]" />
					<div className="relative text-center">
						<p className="mb-4 text-sm font-black uppercase tracking-[0.45em] text-primary-100">
							Next question in
						</p>
						<div
							key={countdownValue}
							className="animate-[ping_1s_ease-out_1] text-[10rem] font-black leading-none text-primary drop-shadow-[0_0_42px_rgba(247,153,69,.65)] md:text-[16rem]"
						>
							{countdownValue}
						</div>
						<p className="mt-4 text-xl font-bold text-white/80">
							Get ready
						</p>
					</div>
				</div>
			)}
			<Modal
				title="End Live Session"
				open={endModalOpen}
				onClose={() => setEndModalOpen(false)}
				width={500}
			>
				<div className="space-y-3">
					{/* It always said "last question", also when ending early with the close button. */}
					<p className="text-gray-700 text-[15px] leading-relaxed">
						{!quest || currentSlideIndex >= quest.tasks.length - 1 ? (
							<>
								You are on the <span className="font-medium">last question</span> of this quest.
							</>
						) : (
							<>
								You are on question {currentSlideIndex + 1} of {quest.tasks.length}. Ending now finishes it
								for everyone; the remaining questions won&apos;t be asked.
							</>
						)}
					</p>

					<p className="text-gray-700 text-sm font-medium">
						End this quest and show the final results?
					</p>

					<div className="flex justify-end gap-3 pt-3">
						<button
							className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 transition"
							onClick={() => setEndModalOpen(false)}
						>
							Keep going
						</button>

						<button
							disabled={!activeSessionId}
							className={`px-4 py-2 rounded text-white transition
    							${
									!activeSessionId
										? "bg-gray-400 cursor-not-allowed"
										: "bg-accent hover:bg-accent/90"
								}
  									`}
							onClick={endHostLive}
						>
							End Quest
						</button>
					</div>
				</div>
			</Modal>
		</QuestHostLiveShell>
	);
}
