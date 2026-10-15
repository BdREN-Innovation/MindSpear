import type { ImportFileQuestionV1 } from "@/features/fun-games/types";
import { DECK_LIMITS, type BulkSlideInput, type BulkSlidesInput } from "@/features/deck/types";
import type { FunGameAiQuestion, QuestAiTask, QuestV2AiSlide, QuizAiQuestion } from "./types";

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

/** Rows for the fun-game JSON import preview (single answer only). */
export function toFunGameImport(questions: FunGameAiQuestion[]): ImportFileQuestionV1[] {
	return questions.map((q) => ({
		type: "single_choice",
		text: q.text,
		options: q.options,
		answer: q.answer,
	}));
}
