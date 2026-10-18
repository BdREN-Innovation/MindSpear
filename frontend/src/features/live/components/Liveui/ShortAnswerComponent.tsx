"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { upsertAnswer } from "@/features/live/store/leaderboardAnswersSlice";
import { useDispatch } from "react-redux";
import moment from "@/lib/dayjs";
import axiosInstance from "@/utils/axiosInstance";
import SharedQuestTimer from "@/components/SharedQuestTimer";
import { AxiosError } from "axios";
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
	color?: string;
};
type TaskItem = {
	id?: number | string;
	quiz_id?: number | string;
	serial_number?: number;
	title?: string;
	question_type?: string;
	task_type?: string;
	description?: string | null;
	questions?: TaskQuestion[];
	time_limit_seconds?: number | string;
	source_content_url?: string | null;
};
type Props = {
	task?: TaskItem;
	value?: string | null;
	onChange?: (val: string) => void;
};
const ShortAnswerComponent: React.FC<Props> = ({ task, value, onChange }) => {
	const dispatch = useDispatch();
	const [answer, setAnswer] = useState(value ?? "");
	const [answersList, setAnswersList] = useState<string[]>([]);
	const [submitted, setSubmitted] = useState(false);
	const [error, setError] = useState("");
	const searchParams = useSearchParams();
	const attempId = searchParams.get("aid");
	const joinid = searchParams.get("jid");
	const [watingData, setwatingData] = useState(true);
	const [, setchalangeData] = useState<any>({});
	const [currentTimeGet, setcurrentTimeGet] = useState<any>(0);
	const maxWords = 5;
	const startRef = useRef<number>(Date.now());
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
	const wordCount = answer.trim()
		? answer.trim().split(/\s+/).filter(Boolean).length
		: 0;
	const dataNew: any = task;
	useEffect(() => {
		const dataFetch = async () => {
			try {
				const response = await axiosInstance.get(
					`/quiz-attempts-url/show/${joinid}`,
				);
				setchalangeData(response?.data?.data?.quiz);
			} catch (error) {
				const axiosError = error as AxiosError<{
					message?: string;
				}>;
				console.error("Unexpected error:", axiosError.message);
			}
		};
		dataFetch();
	}, [joinid]);

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
	}, [answer, task, dispatch]);
	const saveAnswer = async (nextList: any) => {
		try {
			const currentTime = moment().format("YYYY-MM-DD HH:mm:ss");

			// const rankIndexList = ranked.map((_, i) => i + 1);
			const payload = {
				question_id: task?.id,
				answer_data: {
					start_time: currentTime,
					selected_option: nextList,
				},
				time_taken_seconds: currentTimeGet,
			};
			await axiosInstance.post(
				`/quiz-attempts/${attempId}/answer`,
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
			setError("Please write your answer.");
			return;
		}
		const nextList = [...answersList, trimmed];
		setAnswersList(nextList);
		setAnswer("");
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
	const handleTimeUpdate = (s: any) => {
		setcurrentTimeGet(s);
	};
	const handleExpire = () => {
		if (task?.id) {
			localStorage.setItem(
				`timeExpired_${task.id}`,
				JSON.stringify({
					status: "completed",
					submitStatus: "complited",
					taskId: task.id,
					ts: Date.now(),
				}),
			);
		}
		setwatingData(false);
	};
	return (
		<>
			{watingData ? (
				<ParticipantStage size="narrow">
					<div className="flex min-h-0 flex-1 flex-col">
						<div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
							<div className="space-y-4">
								<div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-primary/10 p-4">
									<p className="text-xs font-black uppercase tracking-wide text-primary">
										Type your answer
									</p>
									<h2 className="mt-2 break-words text-2xl font-black leading-tight text-slate-950 sm:text-3xl">
										{task?.title || "Short Answer"}
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
										rows={4}
										className="min-h-36 w-full resize-none rounded-lg border border-slate-300 bg-slate-50 p-4 text-base font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/15"
									/>

									<div className="mt-3 flex justify-between gap-3 text-sm font-semibold text-slate-500">
										<span>
											{wordCount}/{maxWords} words
										</span>
										{error && <span className="text-accent">{error}</span>}
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
export default ShortAnswerComponent;
