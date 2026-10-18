/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-expressions */
"use client";

import { QuestionBlock } from "@/features/quest/components/Quest/QuickFormComponents/quest";
import axiosInstance from "@/utils/axiosInstance";
// import moment from "@/lib/dayjs";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaChevronDown } from "react-icons/fa";
import { useSearchParams } from "next/navigation";
import { AxiosError } from "axios";
import SharedQuestTimer from "@/components/SharedQuestTimer";
import {
	ParticipantStage,
	ParticipantTimerPanel,
	StickySubmitBar,
	WaitingStage,
	markAnswered,
	wasAnswered,
} from "./participant-ui";
// import moment from "@/lib/dayjs";

const CheckboxPreview: React.FC<{
	options: {
		id: string;
		text: string;
	}[];
	selected: string[];
	onToggle: (optId: string, checked: boolean) => void;
}> = ({ options, selected, onToggle }) => (
	<div className="space-y-2">
		{options.map((o) => {
			const id = String(o.id);
			const checked = selected.includes(id);
			return (
				<label
					key={id}
					className="flex items-center gap-2 cursor-pointer"
				>
					<input
						type="checkbox"
						className="h-4 w-4 text-primary border-gray-300 rounded"
						checked={checked}
						onChange={(e) => onToggle(id, e.target.checked)}
					/>
					<span>{o.text}</span>
				</label>
			);
		})}
	</div>
);
const RadioPreview: React.FC<{
	options: {
		id: string;
		text: string;
	}[];
	name: string;
	selected?: string;
	onSelect: (optId: string) => void;
}> = ({ options, name, selected, onSelect }) => (
	<div className="space-y-2">
		{options.map((o) => {
			const id = String(o.id);
			return (
				<label
					key={id}
					className="flex items-center gap-2 cursor-pointer"
				>
					<input
						type="radio"
						name={name}
						className="h-4 w-4 text-primary border-gray-300"
						checked={selected === id}
						onChange={() => onSelect(id)}
					/>
					<span>{o.text}</span>
				</label>
			);
		})}
	</div>
);
const DropdownPreview: React.FC<{
	options: {
		id: string;
		text: string;
	}[];
	selected?: string;
	onSelect: (optId: string) => void;
}> = ({ options, selected, onSelect }) => (
	<div className="relative">
		<select
			className="w-full border border-gray-300 rounded-md px-3 py-2 appearance-none"
			value={selected ?? ""}
			onChange={(e) => onSelect(e.target.value)}
		>
			<option value="">Select an option</option>
			{options.map((o) => (
				<option key={o.id} value={String(o.id)}>
					{o.text}
				</option>
			))}
		</select>
		<FaChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none" />
	</div>
);
const ShortAnswerPreview: React.FC<{
	value?: string;
	onChange: (v: string) => void;
}> = ({ value, onChange }) => (
	<input
		type="text"
		placeholder="Your answer"
		value={value ?? ""}
		onChange={(e) => onChange(e.target.value)}
		className="w-full border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
	/>
);
const parseSN = (sn?: string | number) => {
	const n = Number(sn);
	return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER; // non-numeric last
};
type TaskItem = {
	id?: number;
	title?: string;
	description?: string | null;
	questions?: QuestionBlock[];
};
type Props = {
	task?: TaskItem;
	onSubmit?: (payload: any) => void; // <-- submit callback
};

/* ---------------- helpers ---------------- */

const optIndex1 = (
	opts:
		| {
				id: string | number;
		  }[]
		| undefined,
	pickedId: string,
) => {
	const list = opts ?? [];
	const i = list.findIndex((o) => String(o.id) === pickedId);
	return i >= 0 ? i + 1 : undefined;
};
const buildSubmission = (
	qs: QuestionBlock[],
	form: Record<string, string | string[]>,
) => {
	return qs.map((q) => {
		const qid = String(q.id);
		const base = {
			id: String(q.id),
			type: q.type,
			label: q.label ?? null,
			options: (q.options ?? []).map((o) => ({
				id: String(o.id),
				text: o.text ?? null,
			})),
			serial_number: String(q.serial_number ?? ""),
		};
		const value = form[qid];
		switch (q.type) {
			case "checkbox": {
				const arr = Array.isArray(value) ? (value as string[]) : [];
				const indices = arr
					.map((picked) => optIndex1(q.options, picked))
					.filter((x): x is number => typeof x === "number");
				return {
					...base,
					selected_options: indices,
				};
			}
			case "radio":
			case "dropdown": {
				const picked = typeof value === "string" ? value : "";
				const idx1 = picked ? optIndex1(q.options, picked) : undefined;
				return {
					...base,
					selected_option: idx1,
				};
			}
			case "short-answer": {
				const text = typeof value === "string" ? value : "";
				return {
					...base,
					text,
				};
			}
			default:
				return base;
		}
	});
};
/* ------------------------------------------ */

const QuickFormPreview: React.FC<Props> = ({ task }) => {
	const dataNew: any = task;
	const searchParams = useSearchParams();
	const [questions, setQuestions] = useState<QuestionBlock[]>(
		(task?.questions as QuestionBlock[]) ?? [],
	);
	const [form, setForm] = useState<Record<string, string | string[]>>({});
	const [, setchalangeData] = useState<any>({});
	const currentTimeGetRef = useRef<number>(0);
	const attempId = searchParams.get("aid");
	const joinid = searchParams.get("jid");
	const [watingData, setwatingData] = useState(true);
	useEffect(() => {
		setQuestions((task?.questions as QuestionBlock[]) ?? []);
		setForm({});
	}, [task?.id, task?.questions]);
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
			taskId,
			ts: Date.now(),
		};
		localStorage.setItem(key, JSON.stringify(payload));
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
	const orderedQuestions = useMemo(() => {
		return questions
			.map((q, idx) => ({
				q,
				idx,
			}))
			.sort((a, b) => {
				const diff =
					parseSN(a.q.serial_number) - parseSN(b.q.serial_number);
				return diff !== 0 ? diff : a.idx - b.idx;
			})
			.map(({ q }) => q);
	}, [questions]);
	const update = (qid: string, val: string | string[]) => {
		const next = {
			...form,
			[qid]: val,
		};
		setForm(next);
	};
	const renderPreview = (q: QuestionBlock) => {
		const qid = String(q.id);
		const opts = (q.options ?? [])
			.filter((o) => o.text !== null && o.text.trim() !== "")
			.map((o) => ({
				id: String(o.id),
				text: o.text,
			}));
		switch (q.type) {
			case "checkbox": {
				const selected = Array.isArray(form[qid])
					? (form[qid] as string[])
					: [];
				return (
					<CheckboxPreview
						options={opts}
						selected={selected}
						onToggle={(optId, checked) => {
							const set = new Set(selected);
							checked ? set.add(optId) : set.delete(optId);
							update(qid, Array.from(set));
						}}
					/>
				);
			}
			case "radio": {
				const selected =
					typeof form[qid] === "string" ? (form[qid] as string) : "";
				return (
					<RadioPreview
						options={opts}
						name={qid}
						selected={selected}
						onSelect={(optId) => update(qid, optId)}
					/>
				);
			}
			case "dropdown": {
				const selected =
					typeof form[qid] === "string" ? (form[qid] as string) : "";
				return (
					<DropdownPreview
						options={opts}
						selected={selected}
						onSelect={(optId) => update(qid, optId)}
					/>
				);
			}
			case "short-answer": {
				const val =
					typeof form[qid] === "string" ? (form[qid] as string) : "";
				return (
					<ShortAnswerPreview
						value={val}
						onChange={(v) => update(qid, v)}
					/>
				);
			}
			default:
				return null;
		}
	};

	// const handleSubmit = () => {
	// 	const payload = buildSubmission(orderedQuestions, form);
	// 	saveAnswer(payload);
	// 	//console.log("SUBMIT payload:", payload);
	// };
	const handleSubmit = async () => {
		markAnswered(task?.id);
		const payload = buildSubmission(orderedQuestions, form);
		await saveAnswer(payload);
		setwatingData(false);
	};
	const saveAnswer = async (data: any) => {
		try {
			// const currentTime = moment().format("YYYY-MM-DD HH:mm:ss");
			const payload = {
				task_id: task?.id,
				completion_data: {
					...data,
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
	const handleTimeUpdate = (remaining: number) => {
		currentTimeGetRef.current = remaining;
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
										Quick form
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
								{orderedQuestions.map((q) => (
									<div
										key={String(q.id)}
										className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
									>
										<p className="mb-3 font-black text-slate-800">
											<span className="mr-2 inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-md bg-slate-950 px-2 text-xs text-white">
												{parseSN(q.serial_number)}
											</span>
											{q.label || "Untitled Question"}
										</p>
										{renderPreview(q)}
									</div>
								))}

								{orderedQuestions.length === 0 && (
									<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm font-semibold text-slate-500">
										No questions for this quick form.
									</div>
								)}
							</div>
						</div>

						<StickySubmitBar
							onSubmit={handleSubmit}
							disabled={orderedQuestions.length === 0}
							selectedText={
								orderedQuestions.length > 0
									? `${orderedQuestions.length} form ${orderedQuestions.length === 1 ? "item" : "items"}`
									: undefined
							}
							helperText="Complete the form to submit."
						/>
					</div>
				</ParticipantStage>
			) : (
				<WaitingStage mode={wasAnswered(task?.id) ? "host" : "timeup"} />
			)}
		</>
	);
};
export default QuickFormPreview;
