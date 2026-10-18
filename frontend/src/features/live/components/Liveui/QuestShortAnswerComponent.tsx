/* eslint-disable react-hooks/exhaustive-deps */
"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { upsertAnswer } from "@/features/live/store/leaderboardAnswersSlice";
import { useDispatch } from "react-redux";
import moment from "@/lib/dayjs";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { TimerCacheManager } from "@/utils/timerCacheUtils";
import SharedQuestTimer from "@/components/SharedQuestTimer";
import {
	ParticipantStage,
	ParticipantTimerPanel,
	StickySubmitBar,
	WaitingStage,
	markAnswered,
	wasAnswered,
} from "./participant-ui";
type TaskQuestion = {
	id: number | string;
	text?: string;
	label?: string;
};
type TaskItem = {
	id?: number;
	title?: string;
	task_type?: string;
	description?: string | null;
	questions?: TaskQuestion[];
};
type Props = {
	task?: TaskItem;
	value?: string | null;
	onChange?: (val: string) => void;
};
const QuestShortAnswerComponent: React.FC<Props> = ({
	task,
	value,
	onChange,
}) => {
	const dispatch = useDispatch();
	const [answer, setAnswer] = useState(value ?? "");
	const [answersList, setAnswersList] = useState<string[]>([]);
	const [submitted, setSubmitted] = useState(false);
	const [error, setError] = useState("");
	const searchParams = useSearchParams();
	const [watingData, setwatingData] = useState(true);
	const currentTimeGetRef = useRef<number>(0);
	const [, setchalangeData] = useState<any>({});
	const handleTimeUpdate = (remaining: number) => {
		currentTimeGetRef.current = remaining;
	};
	const maxWords = 5;
	const joinid = searchParams.get("jid");
	const attempId = searchParams.get("aid");
	const startRef = useRef<number>(Date.now());
	useEffect(() => {
		if (typeof window !== "undefined" && !navigator.onLine) {
			console.warn("Offline — skipping API call");
			return;
		}
		const dataFetch = async () => {
			try {
				const response = await axiosInstance.get(
					`/quest-attempts-url/show-by-link/${joinid}`,
				);
				setchalangeData(response?.data?.data?.quest);
			} catch (error) {
				const axiosError = error as AxiosError<{
					message?: string;
				}>;
				console.error("Unexpected error:", axiosError.message);
			}
		};
		dataFetch();
	}, [joinid]);
	useEffect(() => {
		setAnswer("");
		setAnswersList([]);
		setSubmitted(false);
		setError("");
		startRef.current = Date.now();
	}, [task?.id]);
	useEffect(() => {
		if (value !== undefined && value !== null) {
			setAnswer(value);
			setSubmitted(false);
			setError("");
		}
	}, [value]);
	const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setAnswer(e.target.value);
		setError("");
		setSubmitted(false);
	};
	// const handleDefaultChange = (e: any) => {
	// 	setAnswer(e);
	// 	setError("");
	// 	setSubmitted(false);
	// };

	const wordCount = answer.trim()
		? answer.trim().split(/\s+/).filter(Boolean).length
		: 0;
	const dataNew: any = task;
	// ✅ Debounced live upsert while the user types (also sets selected_time)
	useEffect(() => {
		const t = setTimeout(() => {
			if (!task?.id) return;
			const trimmed = answer.trim();
			const elapsedSec = Math.max(
				0,
				Math.round((Date.now() - startRef.current) / 1000),
			);
			dispatch(
				upsertAnswer({
					id: (task?.id as number | string) ?? 0,
					quiz_id: (task as any)?.quiz_id ?? null,
					serial_number: (task as any)?.serial_number ?? null,
					title: (task as any)?.title ?? null,
					question_type:
						(task as any)?.question_type ??
						(task as any)?.task_type ??
						null,
					selected_time: elapsedSec,
					source_content_url:
						(task as any)?.source_content_url ?? null,
					questions: trimmed
						? [
								{
									id: 0,
									text: trimmed,
								},
							]
						: [],
				}),
			);
		}, 300); // 300ms debounce

		return () => clearTimeout(t);
	}, [answer, answersList, task?.id, dispatch]);
	const saveAnswer = async (nextList: any) => {
		try {
			const currentTime = moment().format("YYYY-MM-DD HH:mm:ss");

			// const rankIndexList = ranked.map((_, i) => i + 1);
			const payload = {
				task_id: task?.id,
				completion_data: {
					start_time: currentTime,
					selected_option: nextList,
				},
				time_taken_seconds: currentTimeGetRef.current,
			};
			await axiosInstance.post(
				`/quest-attempts/${attempId}/answer`,
				payload,
			);
		} catch (error) {
			console.error("Error saving answer:", error);
		}
	};
	const handleSubmit = async () => {
		markAnswered(task?.id);
		const trimmed = answer.trim();
		if (!trimmed) {
			// setError("Please write your answer.");
			return;
		}
		const nextList = [...answersList, trimmed];
		setAnswersList(nextList);
		setAnswer("");
		setSubmitted(true);
		setError("");
		// (Optional) Upsert again on submit to be absolutely sure
		const elapsedSec = Math.max(
			0,
			Math.round((Date.now() - startRef.current) / 1000),
		);
		await saveAnswer(nextList);
		dispatch(
			upsertAnswer({
				id: (task?.id as number | string) ?? 0,
				quiz_id: (task as any)?.quiz_id ?? null,
				serial_number: (task as any)?.serial_number ?? null,
				title: (task as any)?.title ?? null,
				question_type:
					(task as any)?.question_type ??
					(task as any)?.task_type ??
					null,
				selected_time: elapsedSec,
				source_content_url: (task as any)?.source_content_url ?? null,
				questions: [
					{
						id: 0,
						text: trimmed,
					},
				],
			}),
		);
		setError("");
		setSubmitted(true);
		setwatingData(false);
		onChange?.(trimmed);
	};
	const handleExpire = () => {
		if (!task?.id) return;
		const saved = setTaskExpired(task.id);
		const ok =
			saved?.status === "completed" &&
			String(saved?.taskId ?? task.id) === String(task.id);
		if (ok) {
			setwatingData(false);
		}
	};
	useEffect(() => {
		if (!task?.id) return;
		const key = `timeExpired_${task.id}`;
		const userStatus: any = localStorage.getItem(key);
		if (userStatus !== null) {
			const savedState = JSON.parse(userStatus);
			if (
				savedState?.status === "completed" ||
				(savedState?.submitStatus === "completed" &&
					task.id === savedState?.taskId)
			) {
				setwatingData(false);
			}
		} else {
			setwatingData(true);
		}
	}, [dataNew?.id]);
	const onExpireWrapped = useCallback(() => {
		if (dataNew?.id != null) TimerCacheManager.markCompleted(dataNew.id);
		if (typeof handleExpire === "function") handleExpire();
	}, [dataNew?.id, handleExpire]);
	useEffect(() => {
		const onStorage = (e: StorageEvent) => {
			if (e.key === `timeExpired_${task?.id}`) {
				// re-run your same logic
				try {
					const parsed = e.newValue ? JSON.parse(e.newValue) : null;
					const ok =
						parsed?.status === "completed" &&
						String(parsed?.taskId ?? task?.id) === String(task?.id);
					setwatingData(!!ok);
				} catch {
					setwatingData(e.newValue === "completed");
				}
			}
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [task?.id]);
	const setTaskExpired = (taskId: string | number) => {
		const key = `timeExpired_${taskId}`;
		const payload = {
			status: "completed",
			submitStatus: "complited",
			taskId,
			ts: Date.now(),
		};
		localStorage.setItem(key, JSON.stringify(payload));
		setwatingData(false);
		return payload;
	};
	const htmlToText = (html?: string) => {
		if (!html) return "";
		const stripped = html.replace(/<[^>]*>/g, " ");
		if (typeof window !== "undefined") {
			const div = document.createElement("div");
			div.innerHTML = stripped;
			const text = div.textContent || div.innerText || "";
			return text
				.replace(/\u00a0/g, " ")
				.replace(/\s+/g, " ")
				.trim();
		}
		return stripped
			.replace(/\u00a0/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	};
	const rowNumber =
		task?.task_type === "shortanswer"
			? 3
			: task?.task_type === "longanswer"
				? 5
				: 1;
	return (
		<>
			{watingData ? (
				<ParticipantStage size="narrow">
					<div className="flex min-h-0 flex-1 flex-col">
						<button className="hidden" onClick={() => onExpireWrapped()}>
							All QuizTimer Clear
						</button>

						<div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
							<div className="space-y-4">
								<div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-primary/10 p-4">
									<p className="text-xs font-black uppercase tracking-wide text-primary">
										Type your answer
									</p>
									<h2 className="mt-2 break-words text-2xl font-black leading-tight text-slate-950 sm:text-3xl">
										{htmlToText(task?.title)}
									</h2>
								</div>

								<ParticipantTimerPanel>
									<SharedQuestTimer
										attemptId={`attempt-${dataNew?.id}`}
										onTimeUpdate={handleTimeUpdate}
										onExpire={handleExpire}
									/>
								</ParticipantTimerPanel>

								<div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
									<textarea
										value={answer}
										onChange={handleChange}
										placeholder="Type your answer here..."
										rows={rowNumber}
										className="min-h-32 w-full resize-none rounded-lg border border-slate-300 bg-slate-50 p-4 text-base font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/15"
									/>

									<div className="mt-3 hidden justify-between text-sm font-semibold text-slate-500">
										<span>
											{wordCount}/{maxWords} words
										</span>
										{error && <span className="text-accent">{error}</span>}
									</div>

									<div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
										{task?.questions
											// Skip empty ones and placeholders older saves stored ("Option 1", "Item 1").
											?.filter((q: any) => `${q?.text ?? ""}`.trim() !== "" && !/^(Option|Item) \d+$/.test(`${q?.text}`.trim()))
											.map((item: any, i) => (
												<button
													type="button"
													onClick={() => {
														setAnswer(item?.text);
														setSubmitted(false);
													}}
													className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/10"
													key={i}
												>
													{item?.text}
												</button>
											))}
									</div>

									{submitted && (
										<p className="mt-3 rounded-md bg-primary/10 px-3 py-2 text-sm font-bold text-primary">
											Answer submitted successfully!
										</p>
									)}
								</div>
							</div>
						</div>

						<StickySubmitBar
							onSubmit={handleSubmit}
							disabled={!answer.trim()}
							selectedText={answer.trim() ? "Answer ready" : undefined}
							helperText="Type your answer to unlock submit."
						/>
					</div>
				</ParticipantStage>
			) : (
				<WaitingStage mode={wasAnswered(task?.id) ? "host" : "timeup"} />
			)}
		</>
	);
};
export default QuestShortAnswerComponent;
