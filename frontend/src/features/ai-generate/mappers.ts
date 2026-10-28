import type { ImportFileQuestionV1 } from "@/features/fun-games/types";
import { DECK_LIMITS, QUIZ_LIMITS, type BulkSlideInput, type BulkSlidesInput, type OptionInput } from "@/features/deck/types";
import { textKey, type FunGameAiQuestion, type QuestAiTask, type QuestV2AiSlide, type QuizAiQuestion, type QuizV2AiSlide } from "./types";

// Turn AI output into the payloads each editor already saves.

/** Body items for POST /quiz/questions/store-multiple. */
export function toQuizQuestions(questions: QuizAiQuestion[], quizId: string | number, startSerial = 1) {
	return questions.map((question, index) => ({
		...question,
		quiz_id: `${quizId}`,
		visibility: "private",
		serial_number: startSerial + index,
		is_ai_generated: true,
	}));
}

const QUEST_COLORS = ["#F79945", "#BC5EB3", "#5769e7", "#89c6c7"];

/** Body items for POST /quest-tasks/store-multiple (same task_data shape as utils/questDataTransformer). */
export function toQuestTasks(tasks: QuestAiTask[], questId: string | number, startSerial = 1) {
	return tasks.map((task, index) => {
		let options = task.options.map((o) => o.trim()).filter(Boolean);
		if (task.task_type === "truefalse") options = ["Yes", "No"];
		// Open prompts keep one empty answer slot, like a task added by hand.
		if (["wordcloud", "shortanswer", "longanswer"].includes(task.task_type)) options = [""];
		if (options.length === 0) options = [""];

		return {
			quest_id: `${questId}`,
			title: task.title.slice(0, 255),
			description: "",
			task_type: task.task_type,
			serial_number: startSerial + index,
			visibility: "public",
			task_data: {
				time_limit: 30,
				questions: options.map((text, i) => ({ id: i + 1, text, color: QUEST_COLORS[i % QUEST_COLORS.length] })),
				minNumber: task.task_type === "scales" ? 1 : 0,
				maxNumber: task.task_type === "scales" ? 5 : 0,
				minText: "Strongly agree",
				maxText: "Strongly disagree",
				contant_title: "",
				image_url: "",
				layout_id: "",
			},
		};
	});
}

/** Quest v2 types whose options are free text slots; the others take none. */
const QUEST_V2_OPTION_TYPES = new Set(["poll_single", "poll_multi", "scales", "ranking", "rating"]);

/**
 * Slides for POST /quests/v2/{deck}/slides/bulk (backend BulkSlidesRequest):
 * {type, title, options?: [{label}]}; config stays at the type defaults.
 * Labels are trimmed, de-duplicated and capped like the backend (title ≤ 280,
 * label ≤ 200, ranking ≤ 12 / scales ≤ 20 / others ≤ 30 options).
 */
export function toQuestSlides(slides: QuestV2AiSlide[]): BulkSlideInput[] {
	return slides.slice(0, DECK_LIMITS.maxBulkSlides).map((slide) => {
		const title = slide.title.trim().slice(0, DECK_LIMITS.maxSlideTitle);
		if (!QUEST_V2_OPTION_TYPES.has(slide.type)) return { type: slide.type, title };

		const seen = new Set<string>();
		const labels = slide.options
			.map((option) => option.trim().slice(0, DECK_LIMITS.maxOptionLabel))
			.filter((label) => {
				const key = label.toLowerCase();
				if (!label || seen.has(key)) return false;
				seen.add(key);
				return true;
			})
			.slice(0, DECK_LIMITS.optionMax[slide.type] ?? DECK_LIMITS.optionMax.default);

		// Too few usable options: let the backend seed the type's default (empty) ones.
		const min = DECK_LIMITS.optionMin[slide.type] ?? 1;
		return labels.length >= min ? { type: slide.type, title, options: labels.map((label) => ({ label })) } : { type: slide.type, title };
	});
}

/** The bulk body, inserted after `afterPosition` (null = at the end). */
export function toQuestSlidesBulk(slides: QuestV2AiSlide[], afterPosition: number | null = null): BulkSlidesInput {
	return { slides: toQuestSlides(slides), after_position: afterPosition };
}

const optionMin = (type: string) => DECK_LIMITS.optionMin[type] ?? 1;
const optionMax = (type: string) => DECK_LIMITS.optionMax[type] ?? DECK_LIMITS.optionMax.default;
const optionLabel = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, DECK_LIMITS.maxOptionLabel);

/** Drops empty and repeated (case-insensitive) values, keeping the first spelling. */
function uniqueTexts(values: string[]): string[] {
	const seen = new Set<string>();
	return values.flatMap((value) => {
		const label = optionLabel(value);
		const key = textKey(label);
		if (!label || seen.has(key)) return [];
		seen.add(key);
		return [label];
	});
}

/**
 * At most `max` choices, in their original order: the correct ones win the
 * places (a single-answer question keeps its one), and a multi keeps at least
 * one wrong choice so it never becomes "everything is right".
 */
function clampChoices<T extends { is_correct?: boolean | null }>(choices: T[], max: number, keepAWrongOne: boolean): T[] {
	if (choices.length <= max) return choices;
	const correct = choices.flatMap((choice, index) => (choice.is_correct ? [index] : []));
	const wrong = choices.flatMap((choice, index) => (choice.is_correct ? [] : [index]));
	const reserveWrong = keepAWrongOne && wrong.length > 0 ? 1 : 0;
	const keptCorrect = correct.slice(0, Math.max(1, max - reserveWrong));
	const keep = new Set([...keptCorrect, ...wrong.slice(0, max - keptCorrect.length)]);
	return choices.filter((_, index) => keep.has(index));
}

/**
 * Up to `max` items in their original order, with every group that has items
 * keeping at least one (so cutting 25 items to 20 can't empty a category).
 */
function capPerGroup<T>(items: T[], max: number, groupOf: (item: T) => string): T[] {
	if (items.length <= max) return items;
	const keep = new Set<number>();
	const groups = new Set<string>();
	items.forEach((item, index) => {
		const group = groupOf(item);
		if (!groups.has(group) && keep.size < max) {
			groups.add(group);
			keep.add(index);
		}
	});
	items.forEach((_, index) => {
		if (keep.size < max) keep.add(index);
	});
	return items.filter((_, index) => keep.has(index));
}

/**
 * One Quiz v2 slide for the bulk body, or null when too little survives the
 * clean-up. The AI may write more than the backend takes (schema.ts lets it):
 * texts are trimmed and de-duplicated, then clamped to the type's limits.
 */
function toQuizSlide(slide: QuizV2AiSlide): BulkSlideInput | null {
	const title = slide.title.trim().slice(0, DECK_LIMITS.maxSlideTitle);

	switch (slide.type) {
		case "pick_answer_single":
		case "pick_answer_multi": {
			const seen = new Set<string>();
			const unique: OptionInput[] = slide.options.flatMap((option) => {
				const label = optionLabel(option.text);
				if (!label || seen.has(textKey(label))) return [];
				seen.add(textKey(label));
				return [{ label, is_correct: option.correct === true }];
			});
			const multi = slide.type === "pick_answer_multi";
			const options = clampChoices(unique, optionMax("pick_answer_single"), multi);
			const correct = options.filter((option) => option.is_correct).length;
			if (options.length < optionMin("pick_answer_single") || correct === 0) return null;
			if (!multi && correct !== 1) return null;
			if (multi && correct === options.length) return null;
			// One Pick answer type: several marked correct makes players select them all.
			return { type: "pick_answer_single", title, options };
		}
		case "true_false":
			// The labels stay English like the legacy quiz's True / False.
			return {
				type: "true_false",
				title,
				options: [
					{ label: "True", is_correct: slide.answer === true },
					{ label: "False", is_correct: slide.answer !== true },
				],
			};
		case "short_answer": {
			// Accepted answers are the option labels (hidden from players); longer ones than a player may type could never match.
			const answers = uniqueTexts(slide.accepted_answers)
				.filter((answer) => answer.length <= QUIZ_LIMITS.shortAnswerDefaultMaxLength)
				.slice(0, optionMax("short_answer"));
			if (answers.length < optionMin("short_answer")) return null;
			return { type: "short_answer", title, options: answers.map((label) => ({ label })) };
		}
		case "correct_order": {
			// The author order (option position) is the correct order.
			const items = uniqueTexts(slide.items).slice(0, optionMax("correct_order"));
			if (items.length < optionMin("correct_order")) return null;
			return { type: "correct_order", title, options: items.map((label) => ({ label })) };
		}
		case "match_pairs": {
			// Cells left p1, right p1, left p2, … like the backend's seeded pairs; participants see the right column shuffled.
			const lefts = new Set<string>();
			const rights = new Set<string>();
			const pairs = slide.pairs
				.map((pair) => ({ left: optionLabel(pair.left), right: optionLabel(pair.right) }))
				.filter(({ left, right }) => {
					if (!left || !right || lefts.has(textKey(left)) || rights.has(textKey(right))) return false;
					lefts.add(textKey(left));
					rights.add(textKey(right));
					return true;
				})
				.slice(0, Math.min(QUIZ_LIMITS.maxPairs, Math.floor(optionMax("match_pairs") / 2)));
			if (pairs.length < QUIZ_LIMITS.minPairs) return null;
			return {
				type: "match_pairs",
				title,
				options: pairs.flatMap(({ left, right }, index) => [
					{ label: left, payload: { side: "left", pair_key: `p${index + 1}` } },
					{ label: right, payload: { side: "right", pair_key: `p${index + 1}` } },
				]),
			};
		}
		case "categorise": {
			// Category labels ≤ 100 characters, distinct; items must name one of them.
			const cut = (value: string) => optionLabel(value).slice(0, QUIZ_LIMITS.maxCategoryLabel).trim();
			const labels = uniqueTexts(slide.categories.map(cut));
			const labelOf = new Map(labels.map((label) => [textKey(label), label]));
			const seen = new Set<string>();
			const items = slide.items.flatMap((item) => {
				const label = optionLabel(item.text);
				const category = labelOf.get(textKey(cut(item.category)));
				if (!label || !category || seen.has(textKey(label))) return [];
				seen.add(textKey(label));
				return [{ label, category }];
			});
			// At most 5 categories (the ones that have items, in order), at most 20 items, and
			// no category left without an item; then keys c1…cN (QUIZ_LIMITS.authorKeyPattern).
			const used = labels.filter((label) => items.some((item) => item.category === label)).slice(0, QUIZ_LIMITS.maxCategories);
			const kept = capPerGroup(
				items.filter((item) => used.includes(item.category)),
				optionMax("categorise"),
				(item) => item.category
			);
			const categories = used
				.filter((label) => kept.some((item) => item.category === label))
				.map((label, index) => ({ key: `c${index + 1}`, label }));
			if (categories.length < QUIZ_LIMITS.minCategories || kept.length < optionMin("categorise")) return null;
			const keyOf = new Map(categories.map((category) => [category.label, category.key]));
			return {
				type: "categorise",
				title,
				config: { categories },
				options: kept.map((item) => ({ label: item.label, payload: { correct_category_key: keyOf.get(item.category)! } })),
			};
		}
		default:
			return null;
	}
}

/**
 * Slides for POST /quizzes/{deck}/slides/bulk (backend BulkSlidesRequest +
 * QuizFields): pick answers carry options[].is_correct, short_answer its
 * accepted answers as labels, correct_order its items in the correct order,
 * match_pairs payload {side, pair_key}, categorise config.categories and
 * payload {correct_category_key}. Scoring and timing stay at the quiz
 * defaults. Slides that end up below their type's option minimum are left out.
 */
export function toQuizSlides(slides: QuizV2AiSlide[]): BulkSlideInput[] {
	return slides.flatMap((slide) => {
		const mapped = toQuizSlide(slide);
		return mapped ? [mapped] : [];
	}).slice(0, DECK_LIMITS.maxBulkSlides);
}

/** The Quiz v2 bulk body, inserted after `afterPosition` (null = at the end). */
export function toQuizSlidesBulk(slides: QuizV2AiSlide[], afterPosition: number | null = null): BulkSlidesInput {
	return { slides: toQuizSlides(slides), after_position: afterPosition };
}

/** Rows for the fun-game JSON import preview (single answer only). */
export function toFunGameImport(questions: FunGameAiQuestion[]): ImportFileQuestionV1[] {
	return questions.map((q) => ({
		type: "single_choice",
		text: q.text,
		options: q.options,
		answer: q.answer,
	}));
}
