// Generating questions from a document in My Files, for quizzes, quests and fun games.
// The prompts, schemas and the model call live in the AI server (ai-server/); this
// feature sends the request (aiClient.ts) and maps the answer into editor payloads.
// `quest` feeds the legacy (v1) quest editor; `quest_v2` writes slides for the
// slide-based Quest v2 editor (backend type keys, saved through slides/bulk).
// `quiz` feeds the legacy quiz creator; `quiz_v2` writes scored slides (with
// their correct answers) for the slide-based Quiz v2 editor.

export type GenerationTarget = "quiz" | "quiz_v2" | "quest" | "quest_v2" | "fungame";

export interface GenerationOptions {
	topic: string;
	questionCount: number;
	questionTypes: string[];
	difficulty: string;
	audienceLevel: string;
	focusArea: string;
}

export interface GenerateRequest extends GenerationOptions {
	target: GenerationTarget;
	/** Text of the selected pages. */
	textData: string;
}

/** Same shape the quiz creator already stores via /quiz/questions/store-multiple. */
export interface QuizAiQuestion {
	question_text: string;
	question_type: "single_choice" | "multiple_choice" | "true_false" | "fill_in_the_blanks" | "short_answer";
	options: { choices: string[]; correct_answer: number | number[] };
}

/** Quest tasks are polls and prompts: no correct answers. */
export interface QuestAiTask {
	title: string;
	task_type: "single_choice" | "multiple_choice" | "truefalse" | "ranking" | "scales" | "wordcloud" | "shortanswer" | "longanswer";
	options: string[];
}

/** Quest v2 slide types the AI may write (backend type keys; a yes/no poll is poll_single with Yes / No). */
export type QuestV2AiSlideType = "poll_single" | "poll_multi" | "word_cloud" | "open_ended" | "scales" | "ranking" | "rating";

/** One Quest v2 slide: polls and prompts, no correct answers. `options` are choices, statements or items. */
export interface QuestV2AiSlide {
	title: string;
	type: QuestV2AiSlideType;
	options: string[];
}

/**
 * Quiz v2 question kinds the AI may write: the scored backend slide types plus
 * `true_false`, which is saved as a pick_answer_single slide with True / False.
 */
export type QuizV2AiSlideType =
	| "pick_answer_single"
	| "pick_answer_multi"
	| "true_false"
	| "short_answer"
	| "correct_order"
	| "match_pairs"
	| "categorise";

/** One choice of a pick-answer question. */
export interface QuizV2AiChoice {
	text: string;
	correct: boolean;
}

/**
 * One Quiz v2 question with its correct answer, in the strict shape the
 * prompt asks for (validated by the AI server before it reaches the editor).
 */
export type QuizV2AiSlide =
	| { type: "pick_answer_single" | "pick_answer_multi"; title: string; options: QuizV2AiChoice[] }
	| { type: "true_false"; title: string; answer: boolean }
	| { type: "short_answer"; title: string; accepted_answers: string[] }
	/** `items` in the correct order, first = top. */
	| { type: "correct_order"; title: string; items: string[] }
	| { type: "match_pairs"; title: string; pairs: { left: string; right: string }[] }
	/** Every item names one of `categories`. */
	| { type: "categorise"; title: string; categories: string[]; items: { text: string; category: string }[] };

/** Fun games are single-answer only. */
export interface FunGameAiQuestion {
	text: string;
	options: string[];
	answer: number;
}

export type GenerateResponse =
	| { target: "quiz"; questions: QuizAiQuestion[] }
	| { target: "quiz_v2"; questions: QuizV2AiSlide[] }
	| { target: "quest"; questions: QuestAiTask[] }
	| { target: "quest_v2"; questions: QuestV2AiSlide[] }
	| { target: "fungame"; questions: FunGameAiQuestion[] };

export type GeneratedFor<T extends GenerationTarget> = Extract<GenerateResponse, { target: T }>;

export interface QuestionTypeOption {
	value: string;
	label: string;
	hint?: string;
}

export const QUESTION_TYPES: Record<GenerationTarget, QuestionTypeOption[]> = {
	quiz: [
		{ value: "single_choice", label: "Single choice" },
		{ value: "multiple_choice", label: "Multiple choice" },
		{ value: "true_false", label: "True / False" },
		{ value: "fill_in_the_blanks", label: "Fill in the blanks" },
		{ value: "short_answer", label: "Short answer" },
	],
	quiz_v2: [
		{ value: "pick_answer_single", label: "Pick answer · one correct" },
		{ value: "pick_answer_multi", label: "Pick answer · several correct" },
		{ value: "true_false", label: "True / False", hint: "Saved as a pick-answer slide" },
		{ value: "short_answer", label: "Short answer", hint: "Typed answer, up to 5 accepted spellings" },
		{ value: "correct_order", label: "Correct order" },
		{ value: "match_pairs", label: "Match pairs" },
		{ value: "categorise", label: "Categorise" },
	],
	quest: [
		{ value: "single_choice", label: "Poll · one answer" },
		{ value: "multiple_choice", label: "Poll · several answers" },
		{ value: "truefalse", label: "Yes / No" },
		{ value: "ranking", label: "Ranking" },
		{ value: "scales", label: "Scales", hint: "Rate statements" },
		{ value: "wordcloud", label: "Word cloud" },
		{ value: "shortanswer", label: "Short answer" },
		{ value: "longanswer", label: "Long answer" },
	],
	quest_v2: [
		{ value: "poll_single", label: "Multiple choice · one answer", hint: "Includes yes / no questions" },
		{ value: "poll_multi", label: "Multiple choice · several answers" },
		{ value: "word_cloud", label: "Word cloud" },
		{ value: "open_ended", label: "Open ended" },
		{ value: "scales", label: "Scales", hint: "Rate statements" },
		{ value: "ranking", label: "Ranking" },
		{ value: "rating", label: "Rating", hint: "Star-rate items" },
	],
	fungame: [
		{ value: "single_choice", label: "Multiple choice (one correct)" },
		{ value: "true_false", label: "True / False" },
	],
};

export const DEFAULT_TYPES: Record<GenerationTarget, string[]> = {
	quiz: ["single_choice", "multiple_choice", "true_false", "fill_in_the_blanks", "short_answer"],
	quiz_v2: ["pick_answer_single", "pick_answer_multi", "true_false", "short_answer", "correct_order", "match_pairs", "categorise"],
	quest: ["single_choice", "multiple_choice", "truefalse", "wordcloud"],
	quest_v2: ["poll_single", "poll_multi", "word_cloud", "open_ended"],
	fungame: ["single_choice", "true_false"],
};

export const MAX_QUESTIONS = 30;

/** Comparison key for AI text: trimmed, inner whitespace collapsed, case-folded. */
export function textKey(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** Characters of document text sent to the AI; longer selections are cut. */
export const MAX_TEXT_CHARS = 60_000;

export const TARGET_NOUN: Record<GenerationTarget, { singular: string; plural: string }> = {
	quiz: { singular: "question", plural: "questions" },
	quiz_v2: { singular: "question", plural: "questions" },
	quest: { singular: "task", plural: "tasks" },
	quest_v2: { singular: "slide", plural: "slides" },
	fungame: { singular: "question", plural: "questions" },
};
