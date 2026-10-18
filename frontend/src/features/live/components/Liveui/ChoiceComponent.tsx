"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import axiosInstance from "@/utils/axiosInstance";
import { upsertAnswer } from "@/features/live/store/leaderboardAnswersSlice";
import { useDispatch, useSelector } from "react-redux";
import moment from "@/lib/dayjs";
import SharedQuestTimer from "@/components/SharedQuestTimer";
import { AxiosError } from "axios";
import {
	AnswerOptionButton,
	ParticipantStage,
	ParticipantTimerPanel,
	StickySubmitBar,
	WaitingStage,
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
	time_limit_seconds?: number | any;
	source_content_url?: string | null;
};
type Props = {
	task?: TaskItem;
	value?: string | null;
	onChange?: (val: string) => void;
};
const MULTI_TYPES = new Set(["multiple_choice", "quiz_multiple_choice", "fill_in_the_blanks_multiple_choice"]);

const ChoiceComponent: React.FC<Props> = ({ task, value, onChange }) => {
	const dispatch = useDispatch();
	// const answers = useSelector((state: RootState) => state.answers);
	const searchParams = useSearchParams();
	const joinid = searchParams.get("jid");
	const attempId = searchParams.get("aid");
	const [watingData, setwatingData] = useState(true);
	const [, setchalangeData] = useState<any>({});
	const [, setcurrentTimeGet] = useState<any>(0);
	const questTimeData = useSelector((state: any) => state.questTime);
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
	// Quiz questions carry the editor's type names; "multiple_choice" alone missed them, so a
	// multi-answer quiz question took one pick (the last) and nobody could score on it.
	const isMulti = MULTI_TYPES.has(`${task?.task_type || task?.question_type || ""}`);
	// Each option keeps the position of its answer in the question (empty ones are skipped
	// for display, which used to shift the index sent for every answer after them).
	const optionItems = useMemo(
		() =>
			(task?.questions ?? [])
				.map((q, i) => ({
					text: `${q.text ?? q.label ?? ""}`,
					index: Number.isInteger(Number(q.id)) ? Number(q.id) : i,
				}))
				.filter((item) => item.text.trim() !== ""),
		[task?.questions],
	);
	const options = useMemo(() => optionItems.map((item) => item.text), [optionItems]);
	const [selectedOption, setSelectedOption] = useState<string | "">(
		(value as string) ?? "",
	);
	const [selectedIndex, setSelectedIndex] = useState<number>(
		Math.max(
			0,
			options.findIndex((o) => o === (value as string)),
		),
	);
	const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
	const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
	const startRef = useRef<number>(Date.now());
	useEffect(() => {
		startRef.current = Date.now();
		setSelectedOption((value as string) ?? "");
		setSelectedIndex(options.findIndex((o) => o === (value as string)));
		setSelectedIndices([]);
		setSelectedOptions([]);
		setwatingData(true);
	}, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (!isMulti) {
			setSelectedOption((value as string) ?? "");
			setSelectedIndex(options.findIndex((o) => o === (value as string)));
		}
	}, [value, options, isMulti]);
	const handleSelect = (option: string, index: number) => {
		const elapsedSec = Math.max(
			0,
			Math.round((Date.now() - startRef.current) / 1000),
		);
		if (isMulti) {
			// toggle in/out
			setSelectedIndices((prev) => {
				const exists = prev.includes(index);
				const next = exists
					? prev.filter((i) => i !== index)
					: [...prev, index];
				// keep an aligned options list (not strictly required, but nice for UI)
				setSelectedOptions(next.map((i) => options[i]));
				// Build selectedAnswer array for Redux
				const selectedAnswer =
					next.length > 0
						? next
								.map((i) => task?.questions?.[i])
								.filter(Boolean)
								.map((q) => ({
									id: q!.id,
									text: q!.text ?? q!.label ?? "",
									color: q!.color ?? null,
								}))
						: [];
				dispatch(
					upsertAnswer({
						id: (task?.id as number | string) ?? index,
						quiz_id: (task as any)?.quiz_id ?? null,
						serial_number: (task as any)?.serial_number ?? null,
						title: task?.title ?? null,
						question_type:
							(task as any)?.question_type ??
							task?.task_type ??
							null,
						selected_time: elapsedSec,
						source_content_url:
							(task as any)?.source_content_url ?? null,
						questions: selectedAnswer, // array of selected options
					}),
				);
				return next;
			});
		} else {
			// single-select
			setSelectedOption(option);
			setSelectedIndex(index);
			onChange?.(option);
			const picked = task?.questions?.[index];
			const selectedAnswer = picked
				? [
						{
							id: picked.id,
							text: picked.text ?? picked.label ?? "",
							color: picked.color ?? null,
						},
					]
				: [
						{
							id: index,
							text: option,
						},
					];
			dispatch(
				upsertAnswer({
					id: (task?.id as number | string) ?? index,
					quiz_id: (task as any)?.quiz_id ?? null,
					serial_number: (task as any)?.serial_number ?? null,
					title: task?.title ?? null,
					question_type:
						(task as any)?.question_type ?? task?.task_type ?? null,
					selected_time: elapsedSec,
					source_content_url:
						(task as any)?.source_content_url ?? null,
					questions: selectedAnswer,
				}),
			);
		}
	};

	// const handleSelect = (option: string, index: number) => {

	// 	setSelectedOption(option);
	// 	setSelectedIndex(index);
	// 	onChange?.(option);

	// 	// compute selected_time in seconds
	// 	const elapsedSec = Math.max(
	// 		0,
	// 		Math.round((Date.now() - startRef.current) / 1000)
	// 	);

	// 	// selected answer object
	// 	const picked = task?.questions?.[index];
	// 	const selectedAnswer = picked
	// 		? [
	// 				{
	// 					id: picked.id,
	// 					text: picked.text ?? picked.label ?? "",
	// 					color: picked.color ?? null,
	// 				},
	// 		  ]
	// 		: [{ id: index, text: option }];

	// 	// upsert into Redux
	// 	dispatch(
	// 		upsertAnswer({
	// 			id: (task?.id as number | string) ?? index,
	// 			quiz_id: (task as any)?.quiz_id ?? null,
	// 			serial_number: (task as any)?.serial_number ?? null,
	// 			title: task?.title ?? null,
	// 			question_type:
	// 				(task as any)?.question_type ?? task?.task_type ?? null,
	// 			selected_time: elapsedSec,
	// 			source_content_url: (task as any)?.source_content_url ?? null,
	// 			questions: selectedAnswer,
	// 		})
	// 	);
	// };

	const dataNew: any = task;
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
	}, [dataNew?.id, task?.id]);
	const dataSubmit = async () => {
		await saveAnswer();
		if (task?.id) setTaskExpired(task.id);
		setwatingData(false);
		if (typeof window !== "undefined") {
			localStorage.setItem("currentId", `${task?.id}`);
		}
	};
	const saveAnswer = async () => {
		try {
			const currentTime = moment().format("YYYY-MM-DD HH:mm:ss");
			const diffSeconds = moment(currentTime).diff(
				moment(quizStartTimeTime),
				"seconds",
			);
			// Answer positions in the question: "0,2,3" for several answers, as the scoring expects.
			const selected = isMulti
				? selectedIndices
						.map((i) => optionItems[i]?.index)
						.filter((i): i is number => i !== undefined)
						.sort((a, b) => a - b)
						.join(",")
				: optionItems[selectedIndex]?.index ?? selectedIndex;
			const payload = {
				question_id: task?.id,
				answer_data: {
					start_time: quizStartTimeTime,
					end_time: currentTime,
					selected_option: selected,
				},
				time_taken_seconds: diffSeconds,
			};
			await axiosInstance.post(
				`/quiz-attempts/${attempId}/answer`,
				payload,
			);
		} catch (error) {
			console.error("Error saving answer:", error);
		}
	};
	const handleExpire = () => {
		if (!questTimeData?.questionId) return;
		// Time's up with an answer picked but not submitted: save it (it used to be dropped).
		if (watingData && hasSelection) void saveAnswer();
		const saved = setTaskExpired(questTimeData.questionId);
		const ok =
			saved?.status === "completed" &&
			String(saved?.taskId ?? questTimeData.questionId) ===
				String(questTimeData.questionId);
		if (ok) {
			setwatingData(false);
		}
	};
	const setTaskExpired = (questionId: string | number) => {
		const key = `timeExpired_${questionId}`;
		const payload = {
			status: "completed",
			submitStatus: "complited",
			taskId: questionId,
			ts: Date.now(),
		};
		localStorage.setItem(key, JSON.stringify(payload));
		setwatingData(false);
		return payload;
	};
	useEffect(() => {
		const onStorage = (e: StorageEvent) => {
			if (e.key === `timeExpired_${questTimeData?.questionId}`) {
				// re-run your same logic
				try {
					const parsed = e.newValue ? JSON.parse(e.newValue) : null;
					const ok =
						parsed?.status === "completed" &&
						String(parsed?.taskId ?? questTimeData?.questionId) ===
							String(questTimeData?.questionId);
					setwatingData(!!ok);
				} catch {
					setwatingData(e.newValue === "completed");
				}
			}
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [questTimeData?.questionId]);

	// const onExpireWrapped = useCallback(() => {
	// 	if (dataNew?.id != null) TimerCacheManager.markCompleted(dataNew.id);
	// 	if (typeof handleExpire === "function") handleExpire();
	// }, [dataNew?.id, handleExpire]);

	// const currentTime = moment(questTimeData?.questiQsenStartTime).format("YYYY-MM-DD HH:mm:ss");
	const date = questTimeData?.questiQsenStartTime ?? "";
	const cleanDate = date.replace(/(\d+)(st|nd|rd|th)/, "$1");
	const quizStartTimeTime = moment(
		cleanDate,
		"MMMM D YYYY, h:mm:ss",
		true,
	).format("YYYY-MM-DD HH:mm:ss");
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
	const isChosen = (option: string, i: number) =>
		isMulti ? selectedIndices.includes(i) : selectedOption === option;
	const hasSelection = isMulti
		? selectedIndices.length > 0
		: Boolean(selectedOption);
	const selectionText = isMulti
		? selectedOptions.length
			? `You selected: ${selectedOptions.join(", ")}`
			: "No selection yet"
		: selectedOption
			? `You selected: ${selectedOption}`
			: "No selection yet";
	const handleTimeUpdate = (remaining: number) => {
		setcurrentTimeGet(remaining);
	};
	return (
		<>
			{watingData ? (
				<ParticipantStage size="wide">
					<div className="flex min-h-0 flex-1 flex-col">
						<div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
							<div className="grid gap-4 lg:grid-cols-[1fr_18rem] lg:items-start">
								<div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-primary/10 p-4">
									<p className="text-xs font-black uppercase tracking-wide text-primary">
										{isMulti ? "Select all that apply" : "Pick one answer"}
									</p>
									<h2 className="mt-2 break-words text-2xl font-black leading-tight text-slate-950 sm:text-3xl">
										{htmlToText(task?.title)}
									</h2>
									{(task as any)?.source_content_url && (
										// eslint-disable-next-line @next/next/no-img-element
										<img
											src={(task as any).source_content_url}
											alt=""
											className="mt-4 max-h-64 w-full rounded-lg object-contain"
										/>
									)}
								</div>
								<ParticipantTimerPanel>
									<SharedQuestTimer
										attemptId={`attempt-${dataNew?.id}`}
										onTimeUpdate={handleTimeUpdate}
										onExpire={handleExpire}
									/>
								</ParticipantTimerPanel>
							</div>

							<div className="mt-5 grid gap-3 sm:grid-cols-2">
								{options.map((option, i) => (
									<AnswerOptionButton
										key={`${option}-${i}`}
										index={i}
										multi={isMulti}
										selected={isChosen(option, i)}
										onClick={() => handleSelect(option, i)}
									>
										{option}
									</AnswerOptionButton>
								))}
								{options.length === 0 && (
									<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500 sm:col-span-2">
										No options provided for this question.
									</div>
								)}
							</div>
						</div>

						<StickySubmitBar
							onSubmit={dataSubmit}
							disabled={!hasSelection}
							selectedText={hasSelection ? selectionText : undefined}
							helperText="Choose an answer to unlock submit."
						/>
					</div>
				</ParticipantStage>
			) : (
				<WaitingStage mode="host" />
			)}
		</>
	);
};
export default ChoiceComponent;
