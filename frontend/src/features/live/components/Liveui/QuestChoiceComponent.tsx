"use client";

/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSearchParams } from "next/navigation";
import axiosInstance from "@/utils/axiosInstance";
import { upsertAnswer } from "@/features/live/store/leaderboardAnswersSlice";
import { useDispatch, useSelector } from "react-redux";
// import { RootState } from "@/services/redux/store";
import moment from "@/lib/dayjs";
import { AxiosError } from "axios";
import { TimerCacheManager } from "@/utils/timerCacheUtils";
import SharedQuestTimer from "@/components/SharedQuestTimer";
import {
	AnswerOptionButton,
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
	value?: string | null; // kept for backward compat on single-select
	onChange?: (val: string) => void;
};
const QuestChoiceComponent: React.FC<Props> = ({ task, value, onChange }) => {
	const dispatch = useDispatch();
	//   const answers = useSelector((state: RootState) => state.answers);
	const searchParams = useSearchParams();
	const joinid = searchParams.get("jid");
	const attempId = searchParams.get("aid");
	const [watingData, setwatingData] = useState(true);
	const [, setchalangeData] = useState<any>({});
	const currentTimeGetRef = useRef<number>(0);
	const questTimeData = useSelector((state: any) => state.questTime);
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
	const isMulti =
		(task?.task_type || task?.question_type) === "multiple_choice";
	const options = useMemo(
		() =>
			task?.questions
				?.map((q) => q.text ?? q.label ?? "")
				.filter(Boolean) ?? [],
		[task?.questions],
	);

	// ---------- Selection State ----------
	// single-select legacy
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
	}, [task?.id]);
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
	}, [dataNew?.id]);
	const dataSubmit = async () => {
		markAnswered(task?.id);
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
			const payload = {
				task_id: task?.id,
				completion_data: {
					start_time: currentTime,
					// send array for multi, single index for others
					selected_option: isMulti ? selectedIndices : selectedIndex,
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
	const handleExpire = () => {
		if (!questTimeData?.questionId) return;
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

	// 4) when the timer truly finishes, mark completed to freeze state forever
	const onExpireWrapped = useCallback(() => {
		if (dataNew?.id != null) TimerCacheManager.markCompleted(dataNew.id);
		if (typeof handleExpire === "function") handleExpire();
	}, [dataNew?.id, handleExpire]);
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
		currentTimeGetRef.current = remaining;
	};
	return (
		<>
			{watingData ? (
				<ParticipantStage size="wide">
					<div className="flex min-h-0 flex-1 flex-col">
						<button className="hidden" onClick={() => onExpireWrapped()}>
							All QuizTimer Clear
						</button>

						<div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
							<div className="grid gap-4 lg:grid-cols-[1fr_18rem] lg:items-start">
								<div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-primary/10 p-4">
									<p className="text-xs font-black uppercase tracking-wide text-primary">
										{isMulti ? "Choose every match" : "Choose your move"}
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
				<WaitingStage mode={wasAnswered(task?.id) ? "host" : "timeup"} />
			)}
		</>
	);
};
export default QuestChoiceComponent;
