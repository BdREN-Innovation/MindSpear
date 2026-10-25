/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import DOMPurify from "dompurify";
import {
	BarChart as GlobalBarChart,
	DonutChart as GlobalDonutChart,
	HorizontalBarChart as GlobalHorizontalBarChart,
	PieChart as GlobalPieChart,
	ScaleProgressChart,
	WordCloud,
} from "@/components/charts";
import QuickFormCreatorView from "@/features/live/components/Liveui/QuickFormCreatorView";
import QuickShortAndLongAnswer from "@/features/live/components/Liveui/QuickShortAndLongAnswer";
import {
	QuestHostEmptyChart,
	QuestHostQuestionHeader,
	QuestHostResponsePanel,
	QuestHostStage,
	QuestHostWaitingStage,
} from "@/features/live/components/quest-host-ui";
import type { HostLiveViewModel } from "@/features/live/services/hostLiveViewModel";
import { useSelector } from "react-redux";

type HostLiveQuestionViewProps = {
	isFullscreen: boolean;
	chartType: "bar" | "donut" | "dots" | "pie";
	viewModel: HostLiveViewModel;
	participantCount?: number;
	/** Quiz only: shown once the question's time is up. */
	correctAnswers?: string[];
	/** A quest's true/false is a "Yes / No" poll. */
	module?: "quiz" | "quest";
};

const VIEW_LABELS: Record<string, string> = {
	single_choice: "Single choice",
	multiple_choice: "Multiple choice",
	truefalse: "True / False",
	fill_in_the_blanks_choice: "Fill in the blank",
	shortanswer: "Short answer",
	longanswer: "Long answer",
	wordcloud: "Word cloud",
	quick_form: "Quick form",
};

// Readable type names ("shortanswer" was shown as is).
const formatViewLabel = (value: string) =>
	VIEW_LABELS[value] ?? String(value || "question").replaceAll("_", " ");

export default function HostLiveQuestionView({
	isFullscreen,
	chartType = "bar",
	viewModel,
	participantCount,
	correctAnswers,
	module = "quest",
}: HostLiveQuestionViewProps) {
	const [timeUp, setTimeUp] = useState(false);
	const {
		showLeaderboard,
		currentSlideIndex,
		totalSlides,
	} = useSelector((state: any) => state.leaderboard);
	const questTimeData = useSelector((state: any) => state.questTime);
	const { questId, questionId, questiQsenTime } = questTimeData;
	const deadline: number | null =
		typeof questTimeData.questiQsenDeadline === "number" ? questTimeData.questiQsenDeadline : null;

	const total = useMemo<number>(() => {
		const raw = Number(questiQsenTime);
		return raw > 0 ? raw : 60;
	}, [questiQsenTime]);

	const progressRef = useRef<HTMLSpanElement | null>(null);
	const timeRef = useRef<HTMLSpanElement | null>(null);
	const forceRestartRef = useRef(false);

	const storageKey = useMemo(
		() => (questId && questionId ? `timer_${questId}_${questionId}` : null),
		[questId, questionId],
	);
	// A new question starts with its answer hidden (also one the host goes back to: it restarts).
	useEffect(() => setTimeUp(false), [storageKey, deadline]);

	const getCachedTime = useCallback(() => {
		if (!storageKey) return null;
		try {
			const cached = localStorage.getItem(storageKey);
			if (cached) {
				const data = JSON.parse(cached);

				if (data.completed) {
					return 0;
				}

				const currentTime = Date.now();
				const elapsedSeconds = (currentTime - data.startTime) / 1000;
				return Math.max(0, data.totalTime - elapsedSeconds);
			}
		} catch (error) {
			console.error("Error reading cached time:", error);
		}
		return null;
	}, [storageKey]);

	const saveCurrentTime = useCallback(
		(startTime: number, totalTime: number, completed = false) => {
			if (!storageKey) return;
			try {
				localStorage.setItem(
					storageKey,
					JSON.stringify({
						startTime,
						totalTime,
						questId,
						questionId,
						savedAt: Date.now(),
						completed,
					}),
				);
			} catch (error) {
				console.error("Error saving time to localStorage:", error);
			}
		},
		[storageKey, questId, questionId],
	);

	const clearAllTimerData = useCallback(() => {
		try {
			Object.keys(localStorage).forEach((key) => {
				if (key.startsWith("timer_")) {
					localStorage.removeItem(key);
				}
			});
		} catch (error) {
			console.error("Error clearing timer data:", error);
		}
	}, []);

	useEffect(() => {
		if (showLeaderboard) {
			clearAllTimerData();
		}
	}, [clearAllTimerData, showLeaderboard]);

	const formatMMSS = (sec: number) => {
		const seconds = Math.max(0, Math.ceil(sec || 0));
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = String(seconds % 60).padStart(2, "0");
		return `${minutes}:${remainingSeconds}`;
	};

	useEffect(() => {
		if (!storageKey) return;

		const previousKey = sessionStorage.getItem("timer_prev_key");

		if (previousKey && previousKey !== storageKey) {
			try {
				localStorage.removeItem(storageKey);
			} catch {}
			forceRestartRef.current = true;
		} else {
			const hasCache = (() => {
				try {
					const cached = localStorage.getItem(storageKey);
					if (!cached) return false;
					const parsed = JSON.parse(cached);
					return parsed?.startTime && parsed?.totalTime;
				} catch {
					return false;
				}
			})();
			forceRestartRef.current = !hasCache;
		}

		sessionStorage.setItem("timer_prev_key", storageKey);
	}, [storageKey]);

	useEffect(() => {
		if (
			!progressRef.current ||
			!timeRef.current ||
			total <= 0 ||
			!storageKey
		) {
			return;
		}

		let startTime: number;
		let initialRemaining: number;

		if (deadline !== null) {
			// The server's deadline: the moment the players' countdowns end too, also after a reload
			// in another browser (the cached start below then restarted the full time).
			initialRemaining = Math.min(total, Math.max(0, (deadline - Date.now()) / 1000));
			startTime = deadline - total * 1000;
			forceRestartRef.current = false;
			saveCurrentTime(startTime, total, initialRemaining === 0);
			if (initialRemaining === 0) {
				progressRef.current.style.transition = "none";
				progressRef.current.style.width = "100%";
				timeRef.current.textContent = "0:00";
				setTimeUp(true);
				return;
			}
		} else {
			if (forceRestartRef.current) {
				const startTime = Date.now();
				saveCurrentTime(startTime, total, false);

				progressRef.current.style.transition = "none";
				progressRef.current.style.width = "0%";
				timeRef.current.textContent = formatMMSS(total);

				forceRestartRef.current = false;
			}

			const cachedRemaining = getCachedTime();
			if (cachedRemaining === 0) {
				progressRef.current.style.transition = "none";
				progressRef.current.style.width = "100%";
				timeRef.current.textContent = "0:00";
				// Already over (e.g. the page was reloaded): the answer stays revealed.
				setTimeUp(true);
				return;
			}

			if (cachedRemaining !== null && cachedRemaining > 0) {
				initialRemaining = cachedRemaining;
				const elapsed = total - cachedRemaining;
				startTime = Date.now() - elapsed * 1000;
			} else {
				initialRemaining = total;
				startTime = Date.now();
				saveCurrentTime(startTime, total, false);
			}
		}

		const initialElapsed = total - initialRemaining;
		progressRef.current.style.transition = "none";
		progressRef.current.style.width = `${(initialElapsed / total) * 100}%`;
		timeRef.current.textContent = formatMMSS(initialRemaining);

		progressRef.current.getBoundingClientRect();
		progressRef.current.style.transition = "width 100ms linear";

		const endTime = startTime + total * 1000;
		let rafId: number;
		let lastSaveTime = Date.now();

		const tick = () => {
			const currentTime = Date.now();
			const elapsedMs = currentTime - startTime;
			const remainingMs = Math.max(0, endTime - currentTime);
			const remainingSeconds = remainingMs / 1000;
			const elapsedSeconds = elapsedMs / 1000;

			const progressPercent = Math.min(100, (elapsedSeconds / total) * 100);

			if (progressRef.current) {
				progressRef.current.style.width = `${progressPercent}%`;
			}
			if (timeRef.current) {
				timeRef.current.textContent = formatMMSS(remainingSeconds);
			}

			if (currentTime - lastSaveTime > 1000) {
				saveCurrentTime(startTime, total, false);
				lastSaveTime = currentTime;
			}

			if (currentTime < endTime) {
				rafId = requestAnimationFrame(tick);
			} else {
				setTimeUp(true);
				saveCurrentTime(startTime, total, true);
				if (progressRef.current) {
					progressRef.current.style.width = "100%";
				}
				if (timeRef.current) {
					timeRef.current.textContent = "0:00";
				}
			}
		};

		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	}, [total, storageKey, deadline, getCachedTime, saveCurrentTime]);

	const cleanTitle = useMemo(
		() => DOMPurify.sanitize(viewModel.title),
		[viewModel.title],
	);
	const cleanContent = useMemo(
		() => DOMPurify.sanitize(viewModel.contentHtml),
		[viewModel.contentHtml],
	);

	const chartData = useMemo(
		() =>
			viewModel.categories.map((label, index) => ({
				label,
				value: viewModel.choiceSeries[index] ?? 0,
				color: viewModel.color[index] || undefined,
			})),
		[viewModel.categories, viewModel.choiceSeries, viewModel.color],
	);

	const shouldShowWaiting =
		viewModel.isResponseDriven && !viewModel.hasResponses;

	const renderChoiceChart = () => {
		if (!viewModel.choiceSeries.some((value) => Number(value) > 0)) {
			return <QuestHostEmptyChart />;
		}

		if (chartType === "pie") {
			return (
				<GlobalPieChart
					data={chartData}
					height={460}
					className="w-full"
					showLegend
				/>
			);
		}

		if (chartType === "donut") {
			return (
				<GlobalDonutChart
					data={chartData}
					height={460}
					className="w-full"
					showLegend
				/>
			);
		}

		return (
			<GlobalBarChart
				data={chartData}
				height={440}
				className="w-full"
				showLegend={false}
			/>
		);
	};

	const renderBody = () => {
		if (shouldShowWaiting) {
			return (
				<QuestHostWaitingStage
					responseCount={viewModel.responseTotal}
					participantCount={participantCount}
				/>
			);
		}

		switch (viewModel.displayKind) {
			case "choice":
				return <ChartCanvas>{renderChoiceChart()}</ChartCanvas>;

			case "scales": {
				// Average rating per statement ("4.5/5"); it used to show a percentage of the top value,
				// which read like a share of players.
				const range = viewModel.scaleRange;
				return (
					<ChartCanvas>
						<div className="w-full">
							{range && (
								<p className="mb-4 text-center text-sm font-semibold text-slate-500">
									Average rating
									{range.minText || range.maxText
										? ` · ${range.min} = ${range.minText || "lowest"}, ${range.max} = ${range.maxText || "highest"}`
										: ` out of ${range.max}`}
								</p>
							)}
							<ScaleProgressChart title="" items={viewModel.scaleItems} full={range?.max ?? 5} sort height={520} />
						</div>
					</ChartCanvas>
				);
			}

			case "ranking":
				return (
					<ChartCanvas>
						<GlobalHorizontalBarChart
							data={viewModel.rankingItems.map((item) => item.count)}
							categories={viewModel.rankingItems.map((item) => item.text)}
							colors={viewModel.rankingItems
								.map((item) => item.color)
								.filter(Boolean)}
							height={Math.max(380, viewModel.rankingItems.length * 58 + 120)}
						/>
					</ChartCanvas>
				);

			case "text":
				return (
					<div className="min-h-[420px] flex-1 bg-slate-50">
						<QuickShortAndLongAnswer answerData={viewModel.textAnswers} />
					</div>
				);

			case "wordcloud":
				return (
					<ChartCanvas>
						<WordCloud
							words={viewModel.wordCloudWords}
							height={520}
							minFont={18}
							maxFont={48}
							className="w-full"
						/>
					</ChartCanvas>
				);

			case "quick_form":
				return (
					<div className="min-h-[420px] flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6">
						<QuickFormCreatorView
							answerData={viewModel.quickFormAnswers}
							quickFromId={viewModel.quickFormId}
							refreshKey={viewModel.responseTotal}
						/>
					</div>
				);

			case "content":
				return (
					<div className="flex min-h-[420px] flex-1 items-center justify-center overflow-auto bg-slate-50 p-4 sm:p-8">
						<div
							className="w-full max-w-5xl overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm"
							style={{
								backgroundImage: viewModel.imageUrl
									? `linear-gradient(rgba(255,255,255,.9),rgba(255,255,255,.9)), url('${viewModel.imageUrl}')`
									: undefined,
								backgroundSize: "cover",
								backgroundPosition: "center",
							}}
						>
							<div
								dangerouslySetInnerHTML={{ __html: cleanContent }}
								className="prose max-w-none p-5 sm:p-8"
							/>
						</div>
					</div>
				);
		}
	};

	return (
		<QuestHostStage className={isFullscreen ? "pt-5" : undefined}>
			<QuestHostQuestionHeader
				title={<span dangerouslySetInnerHTML={{ __html: cleanTitle }} />}
				viewLabel={
					module === "quest" && viewModel.currentView === "truefalse"
						? "Yes / No"
						: formatViewLabel(viewModel.currentView)
				}
				responseCount={viewModel.responseTotal}
				totalSlidesLabel={
					// A quest's tasks are "questions" in its editor too (this said "Slide 1 of 2").
					totalSlides ? `Question ${currentSlideIndex + 1} of ${totalSlides}` : undefined
				}
				progressRef={progressRef}
				timeRef={timeRef}
				timeLabel={formatMMSS(total)}
			/>

			{viewModel.imageUrl && viewModel.displayKind !== "content" && (
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={viewModel.imageUrl}
					alt=""
					className="mx-auto mb-3 max-h-40 w-auto max-w-full rounded-xl object-contain"
				/>
			)}

			{timeUp && correctAnswers && correctAnswers.length > 0 && (
				<div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-green-900">
					<span className="text-sm font-bold uppercase tracking-wide">
						{correctAnswers.length > 1 ? "Correct answers" : "Correct answer"}
					</span>
					{correctAnswers.map((answer) => (
						<span key={answer} className="rounded-full bg-white px-3 py-1 text-base font-semibold shadow-sm">
							{answer}
						</span>
					))}
				</div>
			)}

			<QuestHostResponsePanel>
				<AnimatePresence mode="wait">
					<motion.div
						key={`${viewModel.taskType}-${viewModel.displayKind}-${questionId}`}
						initial={{ opacity: 0, y: 18 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.5, ease: "easeOut" }}
						className="flex min-h-[420px] flex-1 flex-col"
					>
						{renderBody()}
					</motion.div>
				</AnimatePresence>
			</QuestHostResponsePanel>
		</QuestHostStage>
	);
}

function ChartCanvas({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-[420px] flex-1 items-center justify-center overflow-auto bg-slate-50 p-4 sm:p-6 lg:p-8">
			<div className="w-full max-w-6xl rounded-[22px] border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
				{children}
			</div>
		</div>
	);
}

