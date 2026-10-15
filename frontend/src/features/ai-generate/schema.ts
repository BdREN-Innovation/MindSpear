import { z } from "zod";
import { MAX_QUESTIONS, QUESTION_TYPES } from "./types";

// Validates what the browser sends and what the AI returns, so bad output never reaches the editors.

const typeValues = (target: keyof typeof QUESTION_TYPES) => QUESTION_TYPES[target].map((t) => t.value) as [string, ...string[]];

export const generateRequestSchema = z.object({
	target: z.enum(["quiz", "quest", "quest_v2", "fungame"]),
	textData: z.string().trim().min(40, "The selected pages don't contain enough text to write questions from."),
	topic: z.string().trim().min(1, "Enter a topic.").max(200),
	questionCount: z.coerce.number().int().min(1).max(MAX_QUESTIONS),
	questionTypes: z.array(z.string()).min(1, "Choose at least one question type."),
	difficulty: z.string().max(40).default("Medium"),
	audienceLevel: z.string().max(40).default("Generic"),
	focusArea: z.string().max(300).default(""),
});

const text = z.string().trim().min(1);

export const quizQuestionSchema = z
	.object({
		question_text: text,
		question_type: z.enum(typeValues("quiz")),
		options: z.object({
			choices: z.array(z.string()).min(1).max(8),
			correct_answer: z.union([z.number().int().min(0), z.array(z.number().int().min(0)).min(1)]),
		}),
	})
	.refine((q) => {
		const answers = Array.isArray(q.options.correct_answer) ? q.options.correct_answer : [q.options.correct_answer];
		return answers.every((a) => a < q.options.choices.length);
	}, "correct_answer points outside choices");

export const questTaskSchema = z.object({
	title: text,
	task_type: z.enum(typeValues("quest")),
	options: z.array(z.string()).max(8).default([]),
});

/** Quest v2 types that need options, and how many at least (backend minimums: polls/ranking 2, scales 1). */
const QUEST_V2_MIN_OPTIONS: Record<string, number> = { poll_single: 2, poll_multi: 2, ranking: 2, scales: 1, rating: 1 };

export const questV2SlideSchema = z
	.object({
		title: text,
		type: z.enum(typeValues("quest_v2")),
		options: z.array(z.string()).max(12).default([]),
	})
	.refine((slide) => {
		const min = QUEST_V2_MIN_OPTIONS[slide.type] ?? 0;
		return slide.options.filter((o) => o.trim() !== "").length >= min;
	}, "not enough options for this slide type");

export const funGameQuestionSchema = z
	.object({
		text,
		options: z.array(text).min(2).max(6),
		answer: z.number().int().min(0),
	})
	.refine((q) => q.answer < q.options.length, "answer points outside options");

/** Keeps the valid items and drops the rest; the AI occasionally gets one wrong. */
export function keepValid<T>(items: unknown, schema: z.ZodType<T>): T[] {
	if (!Array.isArray(items)) return [];
	return items.flatMap((item) => {
		const parsed = schema.safeParse(item);
		return parsed.success ? [parsed.data] : [];
	});
}
