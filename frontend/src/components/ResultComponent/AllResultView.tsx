/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, CheckCircle2, ClipboardList } from "lucide-react";
import {
	BarChart as GlobalBarChart,
	HorizontalBarChart as GlobalHorizontalBarChart,
	PieChart as GlobalPieChart,
	ScaleProgressChart,
	WordCloud,
} from "@/components/charts";
import QuickFormAnswerView from "@/features/live/components/Liveui/QuickFormAnswerView";
import QuickShortAndLongAnswer from "@/features/live/components/Liveui/QuickShortAndLongAnswer";
import { QuestHostEmptyChart } from "@/features/live/components/quest-host-ui";
import { cn } from "@/lib/utils";

export type TabItem = {
	serial_number?: number;
	images: any;
	id: string;
	label: string;
	icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
	content: React.ReactNode | ((id: string) => React.ReactNode);
};

type Question = { id: number; text: string; color?: string };
type TaskData = {
	maxNumber: number | undefined;
	minNumber?: number;
	minText?: string;
	maxText?: string;
	questions: Question[];
	time_limit?: number;
	time_limit_seconds?: number;
};
type Task = {
	id: number;
	quest_id: number;
	title: string;
	description: string | null;
	task_type: string;
	serial_number: number;
	task_data: TaskData;
	is_required: boolean;
	created_at: string;
	updated_at: string;
};
type CompletionData = {
	start_time?: string;
	selected_option?: number | number[] | string[] | string;
};
type Submission = {
	id: number;
	/** How many players answered. */
	responses?: number;
	participant_id: number | null;
	task_id: number;
	status: string;
	completed_at: string | null;
	completion_data: CompletionData;
	created_at: string;
	updated_at: string;
	task: Task;
};

const FALLBACK_COLORS = [
	"#F79945",
	"#BC5EB3",
	"#ED3A76",
	"#111827",
	"#E07D2A",
	"#9A3F92",
	"#374151",
];

const htmlToText = (html?: string) => {
	if (!html) return "";
	const stripped = html.replace(/<[^>]*>/g, " ");
	if (typeof window !== "undefined") {
		const div = document.createElement("div");
		div.innerHTML = stripped;
		const text = div.textContent || div.innerText || "";
		return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
	}
	return stripped.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
};

const toArray = (value: CompletionData["selected_option"]) => {
	if (Array.isArray(value)) return value;
	if (value === undefined || value === null || value === "") return [];
	return [value];
};

const toNumberArray = (
	value: CompletionData["selected_option"],
	targetLength: number,
) => {
	const source = toArray(value).map((item) => Number(item) || 0);
	return Array.from({ length: Math.max(targetLength, source.length, 1) }, (_, index) =>
		Math.round(Number(source[index] ?? 0)),
	);
};

const TYPE_LABELS: Record<string, string> = {
	single_choice: "Single choice",
	multiple_choice: "Multiple choice",
	truefalse: "Yes / No",
	wordcloud: "Word cloud",
	shortanswer: "Short answer",
	longanswer: "Long answer",
	quick_form: "Quick form",
};

const taskIcon = (taskType: string) => {
	if (taskType === "single_choice" || taskType === "multiple_choice") {
		return "/images/icons/Icon-01.svg";
	}
	if (taskType === "truefalse") return "/images/icons/yes-no.svg";
	if (taskType === "wordcloud") return "/images/icons/word-cloud.svg";
	if (taskType === "ranking") return "/images/icons/ranking.svg";
	if (taskType === "sorting") return "/images/icons/sorting.svg";
	if (taskType === "shortanswer") return "/images/icons/Icon-03.svg";
	if (taskType === "longanswer") return "/images/icons/long-answer.svg";
	if (taskType === "quick_form") return "/images/icons/quick-form.svg";
	if (taskType === "scales") return "/images/icons/scales.svg";
	return "";
};

const wordValues = (selected: CompletionData["selected_option"]) => {
	const totals = new Map<string, { text: string; value: number }>();

	for (const item of toArray(selected)) {
		const text = String(item ?? "").trim();
		if (!text) continue;

		const key = text.toLowerCase();
		const existing = totals.get(key);
		if (existing) {
			existing.value += 1;
		} else {
			totals.set(key, { text, value: 1 });
		}
	}

	return Array.from(totals.values()).sort((left, right) => {
		if (right.value !== left.value) return right.value - left.value;
		return left.text.localeCompare(right.text);
	});
};

function ChartPanel({ sub }: { sub: Submission }) {
	const taskType = String(sub.task.task_type || "").toLowerCase();
	const questions = sub.task.task_data?.questions ?? [];
	const categories = questions.map((question, index) =>
		question.text || `Option ${index + 1}`,
	);
	const colors = questions.map(
		(question, index) => question.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length],
	);
	const values = toNumberArray(sub.completion_data?.selected_option, categories.length);
	const chartData = values.map((value, index) => ({
		label: categories[index] ?? `Option ${index + 1}`,
		value,
		color: colors[index],
	}));
	const hasValues = values.some((value) => Number(value) > 0);

	if (
		taskType === "single_choice" ||
		taskType === "multiple_choice" ||
		taskType === "fill_in_the_blanks_choice"
	) {
		return hasValues ? (
			<GlobalBarChart data={chartData} height={420} className="w-full" />
		) : (
			<QuestHostEmptyChart />
		);
	}

	if (taskType === "truefalse") {
		return hasValues ? (
			<GlobalPieChart data={chartData} height={420} className="w-full" />
		) : (
			<QuestHostEmptyChart />
		);
	}

	if (taskType === "ranking" || taskType === "sorting") {
		const orderedCategories = [...questions]
			.sort((left, right) => Number(left.id) - Number(right.id))
			.map((item) => item.text);

		return hasValues ? (
			<GlobalHorizontalBarChart
				data={values}
				categories={orderedCategories.length ? orderedCategories : categories}
				colors={colors}
				height={Math.max(360, values.length * 58 + 110)}
			/>
		) : (
			<QuestHostEmptyChart />
		);
	}

	if (taskType === "scales") {
		// Average rating per statement ("4.5/5"), not a percentage of the top value.
		const averages = toArray(sub.completion_data?.selected_option);
		const scaleItems = categories.map((text, index) => ({
			text,
			value: Math.round(Number(averages[index] ?? 0) * 10) / 10,
			color: colors[index],
		}));
		const { minNumber, maxNumber, minText, maxText } = sub.task.task_data ?? {};
		const min = Number(minNumber) || 1;
		const max = Number(maxNumber) || 5;

		return (
			<div className="w-full">
				<p className="mb-4 text-center text-sm font-semibold text-slate-500">
					Average rating
					{minText || maxText
						? ` · ${min} = ${minText || "lowest"}, ${max} = ${maxText || "highest"}`
						: ` out of ${max}`}
				</p>
				<ScaleProgressChart title="" items={scaleItems} full={max} sort height={460} />
			</div>
		);
	}

	if (taskType === "wordcloud") {
		const words = wordValues(sub.completion_data?.selected_option);

		return words.length ? (
			<WordCloud words={words} height={440} minFont={18} maxFont={46} className="w-full" />
		) : (
			<QuestHostEmptyChart />
		);
	}

	if (taskType === "longanswer" || taskType === "shortanswer") {
		return (
			<div className="min-h-[420px] w-full rounded-2xl bg-slate-50">
				<QuickShortAndLongAnswer answerData={toArray(sub.completion_data?.selected_option)} />
			</div>
		);
	}

	if (taskType === "quick_form") {
		return (
			<QuickFormAnswerView
				data={{
					id: "",
					time: 120,
					user_name: "",
					answer_data: sub?.completion_data,
				}}
			/>
		);
	}

	return <QuestHostEmptyChart title="Unsupported result" description="This task type has no chart renderer yet." />;
}

function ResultPanel({ sub }: { sub: Submission }) {
	const title = htmlToText(sub.task.title);
	const rawTaskType = String(sub.task.task_type || "").toLowerCase();
	const taskType = TYPE_LABELS[rawTaskType] ?? rawTaskType.replaceAll("_", " ");
	const selectedItems = toArray(sub.completion_data?.selected_option);
	const numericValues = toNumberArray(
		sub.completion_data?.selected_option,
		sub.task.task_data?.questions?.length ?? selectedItems.length,
	);
	const responseTotal = sub.responses ??
		(rawTaskType === "wordcloud" ||
		rawTaskType === "shortanswer" ||
		rawTaskType === "longanswer"
			? selectedItems.length
			: numericValues.reduce((total, value) => total + Math.max(value, 0), 0));

	return (
		<div className="space-y-5">
			<section className="grid gap-4 lg:grid-cols-[1fr_220px_220px]">
				<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
					<p className="mb-2 text-xs font-black uppercase tracking-wide text-primary">
						Question
					</p>
					<h2 className="break-words text-2xl font-black leading-tight text-slate-950">
						{title}
					</h2>
				</div>
				<ResultStat label="Type" value={taskType} />
				<ResultStat label="Responses" value={responseTotal || "None"} />
			</section>

			<section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
				<ChartPanel sub={sub} />
			</section>
		</div>
	);
}

function ResultStat({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
			<p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">
				{label}
			</p>
			<p className="text-xl first-letter:uppercase font-black text-slate-950">{value}</p>
		</div>
	);
}

export default function AllResultView({
	resultList,
	loading,
	tabs,
	initialTabId,
	className,
}: {
	resultList: Submission[];
	loading: boolean;
	tabs?: TabItem[];
	initialTabId?: string;
	className?: string;
}) {
	const dynamicTabs: TabItem[] = useMemo(() => {
		if (!Array.isArray(resultList)) return [];
		return resultList.map((sub) => ({
			id: String(sub.task.id),
			label: sub.task.title,
			serial_number: sub.task.serial_number,
			images: taskIcon(String(sub.task.task_type || "").toLowerCase()),
			content: <ResultPanel sub={sub} />,
		}));
	}, [resultList]);

	const items: TabItem[] = useMemo(
		() =>
			(tabs?.length ? tabs : dynamicTabs)
				.slice()
				.sort((left, right) => Number(left.serial_number) - Number(right.serial_number)),
		[tabs, dynamicTabs],
	);

	const [active, setActive] = useState<string>(
		initialTabId ?? items[0]?.id ?? "",
	);
	const activeIndex = Math.max(0, items.findIndex((tab) => tab.id === active));

	useEffect(() => {
		if (!items.length) return;
		const exists = items.some((tab) => tab.id === active);
		if (!exists) setActive(items[0].id);
	}, [items, active]);

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (!items.length) return;
			if (event.key === "ArrowDown" || event.key === "ArrowRight") {
				event.preventDefault();
				setActive(items[(activeIndex + 1) % items.length].id);
			} else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
				event.preventDefault();
				setActive(items[(activeIndex - 1 + items.length) % items.length].id);
			} else if (event.key === "Home") {
				event.preventDefault();
				setActive(items[0].id);
			} else if (event.key === "End") {
				event.preventDefault();
				setActive(items[items.length - 1].id);
			}
		},
		[activeIndex, items],
	);

	if (loading && !items.length) {
		return (
			<div className={cn("rounded-[24px] border border-slate-200 bg-white p-8 text-center", className)}>
				<div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
					<BarChart3 className="h-7 w-7 animate-pulse" />
				</div>
				<p className="font-black text-slate-900">Loading quest results...</p>
			</div>
		);
	}

	if (!items.length) {
		return (
			<div className={cn("w-full", className)}>
				<div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
					No data found.
				</div>
			</div>
		);
	}

	return (
		<div className={cn("w-full", className)}>
			<div className="mb-5 grid gap-4 sm:grid-cols-3">
				<ResultSummaryCard label="Questions" value={items.length} icon={<ClipboardList />} />
				<ResultSummaryCard label="Status" value="Completed" icon={<CheckCircle2 />} />
				<ResultSummaryCard label="View" value="Aggregated" icon={<BarChart3 />} />
			</div>

			<div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
				<aside
					role="tablist"
					aria-label="Quest result sections"
					onKeyDown={onKeyDown}
					className="flex gap-3 overflow-x-auto rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm [scrollbar-width:none] [-ms-overflow-style:none] lg:sticky lg:top-4 lg:max-h-[calc(92vh-120px)] lg:flex-col lg:overflow-y-auto"
				>
					{items.map((tab) => {
						const Icon = tab.icon;
						const isActive = tab.id === active;
						const label = htmlToText(String(tab.label || ""));

						return (
							<button
								key={tab.id}
								role="tab"
								aria-selected={isActive}
								aria-controls={`panel-${tab.id}`}
								id={`tab-${tab.id}`}
								onClick={() => setActive(tab.id)}
								className={cn(
									"relative flex min-w-[132px] shrink-0 items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.98] lg:min-w-0 lg:w-full",
									isActive
										? "border-primary bg-primary/10 shadow-sm"
										: "border-slate-200 bg-slate-50 hover:border-secondary/40 hover:bg-secondary/10",
								)}
							>
								<span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white shadow-sm">
									{Icon ? <Icon className="h-5 w-5" /> : null}
									{typeof tab.images === "string" && tab.images.length > 0 ? (
										<Image
											src={tab.images}
											alt={`${label} icon`}
											width={44}
											height={44}
											className="h-8 w-8 object-contain"
										/>
									) : null}
								</span>
								<span className="min-w-0">
									<span className="block text-xs font-black uppercase tracking-wide text-slate-500">
										Question {tab.serial_number}
									</span>
									<span className="line-clamp-2 text-sm font-black text-slate-950">
										{label}
									</span>
								</span>
							</button>
						);
					})}
				</aside>

				<section className="min-h-[460px] rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:min-h-[620px]">
					<AnimatePresence mode="wait">
						{items.map((tab) => {
							const isActive = tab.id === active;
							return (
								isActive && (
									<motion.div
										key={tab.id}
										role="tabpanel"
										id={`panel-${tab.id}`}
										aria-labelledby={`tab-${tab.id}`}
										initial={{ opacity: 0, y: 16 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: -12 }}
										transition={{ duration: 0.35, ease: "easeOut" }}
										className="focus:outline-none"
									>
										{typeof tab.content === "function"
											? tab.content(tab.id)
											: tab.content}
									</motion.div>
								)
							);
						})}
					</AnimatePresence>
				</section>
			</div>
		</div>
	);
}

function ResultSummaryCard({
	label,
	value,
	icon,
}: {
	label: string;
	value: React.ReactNode;
	icon: React.ReactNode;
}) {
	return (
		<div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
			<div className="mb-3 flex items-center justify-between gap-3">
				<span className="text-xs font-black uppercase tracking-wide text-slate-500">
					{label}
				</span>
				<span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4">
					{icon}
				</span>
			</div>
			<div className="text-2xl font-black text-slate-950">{value}</div>
		</div>
	);
}
