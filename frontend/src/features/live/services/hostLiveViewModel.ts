import type { LiveResultDatum } from "@/features/live/services/aggregateResults";

type HostTaskQuestion = {
	text?: string;
	color?: string;
};

export type HostLiveTask = {
	id: number | string;
	title?: string | null;
	task_type?: string | null;
	quest_id?: number | string | null;
	serial_number?: number | string | null;
	contant_title?: string | null;
	image_url?: string | null;
	task_data?: {
		questions?: HostTaskQuestion[];
	};
};

type TextAnswerValue = string | string[];

type TextAnswerItem =
	| string
	| {
			value?: TextAnswerValue;
			text?: TextAnswerValue;
			label?: TextAnswerValue;
	  };

export type HostWordCloudWord = {
	text: string;
	value: number;
};

export type HostRankingItem = {
	text: string;
	count: number;
	color?: string;
};

export type HostScaleItem = {
	text: string;
	value: number;
};

export type HostLiveViewModel = {
	currentView: string;
	taskType: string;
	title: string;
	categories: string[];
	color: string[];
	displayKind:
		| "choice"
		| "ranking"
		| "scales"
		| "text"
		| "wordcloud"
		| "quick_form"
		| "content";
	isResponseDriven: boolean;
	hasResponses: boolean;
	responseTotal: number;
	choiceSeries: number[];
	rankingItems: HostRankingItem[];
	scaleItems: HostScaleItem[];
	textAnswers: string[];
	wordCloudWords: HostWordCloudWord[];
	quickFormAnswers: unknown[];
	contentHtml: string;
	imageUrl: string | null;
	quickFormId: number | string | null;
};

const CHOICE_TASK_TYPES = new Set([
	"single_choice",
	"multiple_choice",
	"truefalse",
	"fill_in_the_blanks_choice",
]);

const ORDERED_TASK_TYPES = new Set(["ranking", "sorting"]);
const TEXT_TASK_TYPES = new Set([
	"shortanswer",
	"longanswer",
	"sort_answer_choice",
]);

const RESPONSE_TASK_TYPES = new Set([
	...CHOICE_TASK_TYPES,
	...ORDERED_TASK_TYPES,
	...TEXT_TASK_TYPES,
	"scales",
	"wordcloud",
]);

const normalizeTaskType = (taskType: unknown) =>
	String(taskType ?? "").trim().toLowerCase();

const flattenTextValue = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return value.flatMap((item) => flattenTextValue(item));
	}

	if (value && typeof value === "object") {
		const nextValue =
			(value as { value?: unknown; text?: unknown; label?: unknown }).value ??
			(value as { text?: unknown }).text ??
			(value as { label?: unknown }).label;
		return nextValue === undefined ? [] : flattenTextValue(nextValue);
	}

	const text = String(value ?? "").trim();
	return text ? [text] : [];
};

const extractTextAnswers = (
	result: LiveResultDatum | null | undefined
): string[] => {
	if (!result || !("text" in result) || !Array.isArray(result.text)) return [];

	return (result.text as TextAnswerItem[]).flatMap((item) =>
		flattenTextValue(item)
	);
};

const normalizeChoiceSeries = (
	result: LiveResultDatum | null | undefined,
	categoryCount: number
) => {
	const values =
		result && "number" in result && Array.isArray(result.number)
			? result.number
			: [];
	const targetLength = Math.max(categoryCount, values.length);

	return Array.from({ length: targetLength }, (_, index) =>
		Math.round(Number(values[index] ?? 0))
	);
};

const hasNumericResponses = (series: number[]) =>
	series.some((value) => Math.abs(Number(value) || 0) > 0);

const buildRankingItems = (
	categories: string[],
	series: number[],
	colors: string[]
): HostRankingItem[] =>
	categories
		.map((text, index) => ({
			text,
			count: Math.round(Number(series[index] ?? 0)),
			color: colors[index] || undefined,
		}))
		.sort((left, right) => right.count - left.count);

const buildScaleItems = (
	categories: string[],
	series: number[]
): HostScaleItem[] =>
	categories
		.map((text, index) => ({
			text,
			value: Math.round(Number(series[index] ?? 0)),
		}))
		.sort((left, right) => right.value - left.value);

export const toWordCloudWords = (
	answers: string[]
): HostWordCloudWord[] => {
	const totals = new Map<string, HostWordCloudWord>();

	for (const answer of answers) {
		const text = String(answer ?? "").trim();
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

export const isResponseDrivenTaskType = (taskType: unknown) =>
	RESPONSE_TASK_TYPES.has(normalizeTaskType(taskType));

export function buildHostLiveViewModel(
	task: HostLiveTask,
	result: LiveResultDatum | null | undefined
): HostLiveViewModel {
	const taskType = normalizeTaskType(task.task_type);
	const currentView = taskType || "single_choice";
	const categories = (task.task_data?.questions ?? []).map(
		(question) => question.text ?? ""
	);
	const color = (task.task_data?.questions ?? []).map(
		(question) => question.color ?? ""
	);
	const choiceSeries = normalizeChoiceSeries(result, categories.length);
	const rankingItems = buildRankingItems(categories, choiceSeries, color);
	const scaleItems = buildScaleItems(categories, choiceSeries);
	const textAnswers = extractTextAnswers(result);
	const wordCloudWords = toWordCloudWords(textAnswers);
	const numericTotal = choiceSeries.reduce(
		(total, value) => total + Math.max(Number(value) || 0, 0),
		0
	);
	const responseTotal = Math.round(
		textAnswers.length > 0
			? textAnswers.length
			: result && "total" in result && result.total
				? result.total
				: numericTotal
	);
	const isResponseDriven = isResponseDrivenTaskType(taskType);

	if (ORDERED_TASK_TYPES.has(taskType)) {
		return {
			currentView,
			taskType,
			title: task.title ?? "Untitled",
			categories,
			color,
			displayKind: "ranking",
			isResponseDriven,
			hasResponses: hasNumericResponses(choiceSeries),
			responseTotal,
			choiceSeries,
			rankingItems,
			scaleItems,
			textAnswers,
			wordCloudWords,
			quickFormAnswers: [],
			contentHtml: task.contant_title ?? "",
			imageUrl: task.image_url ?? null,
			quickFormId: task.id ?? null,
		};
	}

	if (taskType === "scales") {
		return {
			currentView,
			taskType,
			title: task.title ?? "Untitled",
			categories,
			color,
			displayKind: "scales",
			isResponseDriven,
			hasResponses: hasNumericResponses(choiceSeries),
			responseTotal,
			choiceSeries,
			rankingItems,
			scaleItems,
			textAnswers,
			wordCloudWords,
			quickFormAnswers: [],
			contentHtml: task.contant_title ?? "",
			imageUrl: task.image_url ?? null,
			quickFormId: task.id ?? null,
		};
	}

	if (taskType === "wordcloud") {
		return {
			currentView,
			taskType,
			title: task.title ?? "Untitled",
			categories,
			color,
			displayKind: "wordcloud",
			isResponseDriven,
			hasResponses: textAnswers.length > 0,
			responseTotal,
			choiceSeries,
			rankingItems,
			scaleItems,
			textAnswers,
			wordCloudWords,
			quickFormAnswers: [],
			contentHtml: task.contant_title ?? "",
			imageUrl: task.image_url ?? null,
			quickFormId: task.id ?? null,
		};
	}

	if (TEXT_TASK_TYPES.has(taskType)) {
		return {
			currentView,
			taskType,
			title: task.title ?? "Untitled",
			categories,
			color,
			displayKind: "text",
			isResponseDriven,
			hasResponses: textAnswers.length > 0,
			responseTotal,
			choiceSeries,
			rankingItems,
			scaleItems,
			textAnswers,
			wordCloudWords,
			quickFormAnswers: [],
			contentHtml: task.contant_title ?? "",
			imageUrl: task.image_url ?? null,
			quickFormId: task.id ?? null,
		};
	}

	if (taskType === "quick_form") {
		return {
			currentView,
			taskType,
			title: task.title ?? "Untitled",
			categories,
			color,
			displayKind: "quick_form",
			isResponseDriven: false,
			hasResponses: false,
			responseTotal,
			choiceSeries,
			rankingItems,
			scaleItems,
			textAnswers,
			wordCloudWords,
			quickFormAnswers: [],
			contentHtml: task.contant_title ?? "",
			imageUrl: task.image_url ?? null,
			quickFormId: task.id ?? null,
		};
	}

	if (taskType === "content") {
		return {
			currentView,
			taskType,
			title: task.title ?? "Untitled",
			categories,
			color,
			displayKind: "content",
			isResponseDriven: false,
			hasResponses: false,
			responseTotal,
			choiceSeries,
			rankingItems,
			scaleItems,
			textAnswers,
			wordCloudWords,
			quickFormAnswers: [],
			contentHtml: task.contant_title ?? "",
			imageUrl: task.image_url ?? null,
			quickFormId: task.id ?? null,
		};
	}

	return {
		currentView,
		taskType,
		title: task.title ?? "Untitled",
		categories,
		color,
		displayKind: "choice",
		isResponseDriven,
		hasResponses: hasNumericResponses(choiceSeries),
		responseTotal,
		choiceSeries,
		rankingItems,
		scaleItems,
		textAnswers,
		wordCloudWords,
		quickFormAnswers: [],
		contentHtml: task.contant_title ?? "",
		imageUrl: task.image_url ?? null,
		quickFormId: task.id ?? null,
	};
}
