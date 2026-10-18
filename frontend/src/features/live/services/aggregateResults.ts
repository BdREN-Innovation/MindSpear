import type { AnswerAggregatePayload } from "@/features/live/types";

type LiveTask = {
	id: number;
	quest_id?: number;
	task_type?: string;
	question_type?: string;
	task_data?: {
		questions?: Array<{ text?: string; label?: string }>;
	};
};

export type LiveResultDatum =
	// total: how many players answered (several picks each on a multiple-answer question).
	// scaleMax: on a scale, number holds each statement's average rating out of scaleMax.
	| { quest_id: number; task_type: string; id: number; number: number[]; total?: number; scaleMax?: number }
	| {
			quest_id: number;
			task_type: string;
			id: number;
			text: Array<{ userId: string; userName: string; value: string | string[] }>;
	  };

const textLikeTypes = new Set([
	"shortanswer",
	"longanswer",
	"wordcloud",
	"sort_answer_choice",
]);

const parseAggregateKey = (key: string): unknown => {
	try {
		return JSON.parse(key);
	} catch {
		return key;
	}
};

const numericIndex = (value: unknown): number | null => {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}

	return null;
};

const flattenTextValues = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return value.flatMap((item) => flattenTextValues(item));
	}

	if (value && typeof value === "object") {
		const maybeText = (value as { text?: unknown; value?: unknown; label?: unknown }).text ??
			(value as { value?: unknown }).value ??
			(value as { label?: unknown }).label;
		return maybeText ? flattenTextValues(maybeText) : [];
	}

	const text = String(value ?? "").trim();
	return text ? [text] : [];
};

type ChartScores = NonNullable<AnswerAggregatePayload["chart"]>["scores"];

const chartScoresToNumber = (scores: ChartScores, round = true): number[] | null => {
	if (!scores) return null;

	const number: number[] = [];
	const entries = Array.isArray(scores)
		? scores.map((value, index) => [String(index), value] as const)
		: Object.entries(scores);

	for (const [key, value] of entries) {
		const index = numericIndex(key);
		if (index === null || index < 0) continue;

		while (number.length <= index) number.push(0);
		number[index] = round ? Math.round(Number(value) || 0) : Number(value) || 0;
	}

	return number.length ? number : null;
};

export function aggregatePayloadToResult(
	payload: AnswerAggregatePayload,
	task: LiveTask
): LiveResultDatum | null {
	const taskId = Number(
		payload.task_id ??
			payload.current_task_id ??
			payload.question_id ??
			payload.current_question_id ??
			task.id
	);
	if (!taskId || taskId !== Number(task.id)) return null;

	const taskType = String(task.task_type ?? task.question_type ?? "").toLowerCase();
	const answers = payload.answers ?? {};
	const questId = Number(task.quest_id ?? 0);

	// How many players answered (a chart's scores, e.g. a scale's averages, aren't a head count).
	const answered = Number(payload.total_answers ?? payload.chart?.total_answers);
	const total = Number.isFinite(answered) && answered > 0 ? { total: answered } : {};

	if (taskType === "scales") {
		const averages = chartScoresToNumber(payload.chart?.averages, false);
		if (averages) {
			return {
				quest_id: questId, task_type: taskType, id: taskId, number: averages, ...total,
				scaleMax: Number(payload.chart?.scale_max) || undefined,
			};
		}
	}

	const chartNumber = chartScoresToNumber(payload.chart?.scores);
	if (chartNumber && !textLikeTypes.has(taskType)) {
		return { quest_id: questId, task_type: taskType, id: taskId, number: chartNumber, ...total };
	}

	if (textLikeTypes.has(taskType)) {
		const text = Object.entries(answers).flatMap(([key, count]) => {
			const values = flattenTextValues(parseAggregateKey(key));
			return values.flatMap((value) =>
				Array.from({ length: Math.max(Number(count) || 1, 1) }, () => ({
					userId: "",
					userName: "Participant",
					value,
				}))
			);
		});

		return { quest_id: questId, task_type: taskType, id: taskId, text };
	}

	const optionCount = task.task_data?.questions?.length ?? 0;
	const number = Array.from({ length: Math.max(optionCount, 1) }, () => 0);
	// Scales: how many players rated each statement, to turn the sums into averages.
	const ratedBy: number[] = [];

	for (const [key, countValue] of Object.entries(answers)) {
		const count = Number(countValue) || 0;
		const parsed = parseAggregateKey(key);
		// A multiple-answer pick arrives as "0,2,3": each picked option gets the count.
		const values = Array.isArray(parsed)
			? parsed
			: typeof parsed === "string" && parsed.includes(",")
				? parsed.split(",")
				: [parsed];

		values.forEach((value, position) => {
			if (taskType === "scales") {
				// 0 is a statement left unrated.
				const rating = Number(value) || 0;
				if (!rating) return;
				while (number.length <= position) number.push(0);
				number[position] += rating * count;
				ratedBy[position] = (ratedBy[position] ?? 0) + count;
				return;
			}

			const index = numericIndex(value);
			if (index === null || index < 0) return;

			while (number.length <= index) number.push(0);
			number[index] += count;
		});
	}

	if (taskType === "scales") {
		const averages = number.map((sum, index) => (ratedBy[index] ? Math.round((sum / ratedBy[index]) * 10) / 10 : 0));
		return { quest_id: questId, task_type: taskType, id: taskId, number: averages, ...total };
	}

	return { quest_id: questId, task_type: taskType, id: taskId, number, ...total };
}
