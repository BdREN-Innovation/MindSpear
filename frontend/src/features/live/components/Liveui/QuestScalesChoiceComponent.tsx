"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useRef, useState } from "react";
// import clsx from "clsx";
import { useSearchParams } from "next/navigation";
import axiosInstance from "@/utils/axiosInstance";
import { upsertAnswer } from "@/features/live/store/leaderboardAnswersSlice";
import { useDispatch } from "react-redux";
import moment from "@/lib/dayjs";
import { AxiosError } from "axios";
import ScaleRow, { ScaleOption } from "./Scales/ScaleRow";
import SharedQuestTimer from "@/components/SharedQuestTimer";
import {
	ParticipantStage,
	ParticipantTimerPanel,
	StickySubmitBar,
	WaitingStage,
	markAnswered,
	wasAnswered,
} from "./participant-ui";
type TaskQuestion = ScaleOption;
type TaskItem = {
	id?: number | string;
	quiz_id?: number | string;
	serial_number?: number;
	title?: string;
	question_type?: string;
	task_type?: string; // "scales"
	description?: string | null;
	questions?: TaskQuestion[];
	time_limit_seconds?: number | string;
	source_content_url?: string | null;

	// IMPORTANT: min/max may exist at root (from your sample)
	minNumber?: number;
	maxNumber?: number;

	// sometimes wrapped in task_data in chalangeData.tasks
	task_data?: {
		time_limit?: number;
		minNumber?: number;
		maxNumber?: number;
	};
};
type Props = {
	task?: TaskItem;
	value?: string | null; // kept for legacy API (unused for scales)
	onChange?: (val: string) => void; // legacy
};
const QuestScalesChoiceComponent: React.FC<Props> = ({ task }) => {
	const dispatch = useDispatch();
	const searchParams = useSearchParams();
	const joinid = searchParams.get("jid");
	const attempId = searchParams.get("aid");
	const [watingData, setwatingData] = useState(true);
	const [, setchalangeData] = useState<any>({});
	const currentTimeGetRef = useRef<number>(0);
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
		if (!task?.id) return;
		const key = `timeExpired_${task.id}`;
		const raw = localStorage.getItem(key);
		if (raw === null) {
			return;
		}
		try {
			const parsed = JSON.parse(raw);
			const expired =
				parsed?.status === "completed" &&
				String(parsed?.taskId) === String(task.id);
			setwatingData(!expired ? true : false);
		} catch {
			const expired = raw === "completed";
			setwatingData(!expired);
		}
	}, [task?.id]);

	// derive options and min/max
	const optionObjs = useMemo<ScaleOption[]>(
		() => task?.questions ?? [],
		[task?.questions],
	);

	// priority: task.minNumber/maxNumber -> task.task_data.minNumber/maxNumber -> defaults
	const minNumber = useMemo(() => {
		const direct = (task as any)?.minNumber;
		const nested = (task as any)?.task_data?.minNumber;
		return Number(direct ?? nested ?? 1);
	}, [task]);
	const maxNumber = useMemo(() => {
		const direct = (task as any)?.maxNumber;
		const nested = (task as any)?.task_data?.maxNumber;
		return Number(direct ?? nested ?? 5);
	}, [task]);
	// values aligned with options (0 => skipped)
	const [selectedValues, setSelectedValues] = useState<number[]>(
		optionObjs.map(() => 0),
	);
	const startRef = useRef<number>(Date.now());
	useEffect(() => {
		// reset when the question/task changes
		startRef.current = Date.now();
		setSelectedValues((task?.questions ?? []).map(() => 0));
		setwatingData(true);
	}, [task?.id, task?.questions]); // re-init on change

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

	// sync to Redux
	const syncReduxScales = (values: number[]) => {
		const elapsedSec = Math.max(
			0,
			Math.round((Date.now() - startRef.current) / 1000),
		);
		const answered = optionObjs.map((q, i) => ({
			id: q.id,
			text: q.text ?? q.label ?? "",
			color: q.color ?? null,
			value: values[i] ?? 0,
		}));
		dispatch(
			upsertAnswer({
				id: (task?.id as number | string) ?? "scales",
				quiz_id: (task as any)?.quiz_id ?? null,
				serial_number: (task as any)?.serial_number ?? null,
				title: task?.title ?? null,
				question_type:
					(task as any)?.question_type ?? task?.task_type ?? "scales",
				selected_time: elapsedSec,
				source_content_url: (task as any)?.source_content_url ?? null,
				questions: answered, // detailed per-option entries
				// selected_values: values,     // array like [3,1,0,...] (if your slice supports it)
			}),
		);
	};
	const handleScaleChange = (index: number, nextValue: number) => {
		setSelectedValues((prev) => {
			const copy = [...prev];
			copy[index] = Number(nextValue);
			syncReduxScales(copy);
			return copy;
		});
	};
	const handleSkip = (index: number) => {
		setSelectedValues((prev) => {
			const copy = [...prev];
			copy[index] = 0; // 0 means skipped
			syncReduxScales(copy);
			return copy;
		});
	};
	const dataNew: any = task;
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
					selected_option: selectedValues, // array of numbers
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
		if (!task?.id) return;
		const saved = setTaskExpired(task.id);
		const ok =
			saved?.status === "completed" &&
			String(saved?.taskId ?? task.id) === String(task.id);
		if (ok) {
			setwatingData(false);
		}
	};
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
	const handleTimeUpdate = (remaining: number) => {
		currentTimeGetRef.current = remaining;
	};
	const ratedCount = selectedValues.filter((value) => value !== 0).length;
	const selectionText = `${ratedCount} of ${selectedValues.length} rated`;
	// What the ends of the scale mean (the editor's "Bottom/Top of the scale").
	const minLabel = (task as any)?.minText ?? (task as any)?.task_data?.minText;
	const maxLabel = (task as any)?.maxText ?? (task as any)?.task_data?.maxText;
	return (
		<>
			{watingData ? (
				<ParticipantStage size="wide">
					<div className="flex min-h-0 flex-1 flex-col">
						<div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
							<div className="grid gap-4 lg:grid-cols-[1fr_18rem] lg:items-start">
								<div className="rounded-lg border border-slate-200 bg-gradient-to-br from-white to-secondary/10 p-4">
									<p className="text-xs font-black uppercase tracking-wide text-primary">
										Rate each item
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

							<div className="mt-5 space-y-4">
								{optionObjs.length > 0 ? (
									optionObjs.map((opt, i) => (
										<div
											key={opt.id ?? i}
											className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
										>
											<ScaleRow
												option={opt}
												index={i}
												min={minNumber}
												max={maxNumber}
												value={selectedValues[i] ?? 0}
												onChange={handleScaleChange}
												onSkip={handleSkip}
												minLabel={minLabel}
												maxLabel={maxLabel}
											/>
										</div>
									))
								) : (
									<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
										No options provided for this question.
									</div>
								)}
							</div>
						</div>

						<StickySubmitBar
							onSubmit={dataSubmit}
							selectedText={selectionText}
							helperText="Rate each statement, then submit."
						/>
					</div>
				</ParticipantStage>
			) : (
				<WaitingStage mode={wasAnswered(task?.id) ? "host" : "timeup"} />
			)}
		</>
	);
};
export default QuestScalesChoiceComponent;
