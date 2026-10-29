// Generating questions from a document in My Files, for quizzes, quests and fun games.
// The prompts, schemas and the model call live in the AI server (ai-server/); this
// feature sends the request (aiClient.ts) and maps the answer into editor payloads.
// `quiz` writes scored slides (with their correct answers) and `quest` poll and
// prompt slides, both as backend slide type keys saved through slides/bulk;
// `fungame` writes single-answer questions for the Fun Games importer.

export type GenerationTarget = "quiz" | "quest" | "fungame";

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

/** Quest slide types the AI may write (backend type keys; a yes/no poll is poll_single with Yes / No). */
export type QuestAiSlideType = "poll_single" | "poll_multi" | "word_cloud" | "open_ended" | "scales" | "ranking" | "rating";

/** One quest slide: polls and prompts, no correct answers. `options` are choices, statements or items. */
export interface QuestAiSlide {
	title: string;
	type: QuestAiSlideType;
	options: string[];
}

/**
 * Quiz question kinds the AI may write. Both pick kinds are saved as a
 * pick_answer_single slide (several correct = select them all); true_false as
 * a true_false slide with True / False.
 */
export type QuizAiSlideType =
	| "pick_answer_single"
	| "pick_answer_multi"
	| "true_false"
	| "short_answer"
	| "correct_order"
	| "match_pairs"
	| "categorise";

/** One choice of a pick-answer question. */
export interface QuizAiChoice {
	text: string;
	correct: boolean;
}

/**
 * One quiz question with its correct answer, in the strict shape the
 * prompt asks for (validated by the AI server before it reaches the editor).
 */
export type QuizAiSlide =
	| { type: "pick_answer_single" | "pick_answer_multi"; title: string; options: QuizAiChoice[] }
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
	| { target: "quiz"; questions: QuizAiSlide[] }
	| { target: "quest"; questions: QuestAiSlide[] }
	| { target: "fungame"; questions: FunGameAiQuestion[] };

export type GeneratedFor<T extends GenerationTarget> = Extract<GenerateResponse, { target: T }>;

export interface QuestionTypeOption {
	value: string;
	label: string;
	hint?: string;
}

export const QUESTION_TYPES: Record<GenerationTarget, QuestionTypeOption[]> = {
	quiz: [
		{ value: "pick_answer_single", label: "Pick answer · one correct" },
		{ value: "pick_answer_multi", label: "Pick answer · several correct" },
		{ value: "true_false", label: "True / False" },
		{ value: "short_answer", label: "Short answer", hint: "Typed answer, up to 5 accepted spellings" },
		{ value: "correct_order", label: "Correct order" },
		{ value: "match_pairs", label: "Match pairs" },
		{ value: "categorise", label: "Categorise" },
	],
	quest: [
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
	quiz: ["pick_answer_single", "pick_answer_multi", "true_false", "short_answer", "correct_order", "match_pairs", "categorise"],
	quest: ["poll_single", "poll_multi", "word_cloud", "open_ended"],
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
	quest: { singular: "slide", plural: "slides" },
	fungame: { singular: "question", plural: "questions" },
};
