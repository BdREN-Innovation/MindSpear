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
export type QuestAiSlideType =
	| "poll_single"
	| "poll_multi"
	| "word_cloud"
	| "open_ended"
	| "scales"
	| "ranking"
	| "points_allocation"
	| "rating"
	| "matrix_2x2";

/** What the two ends of a 2×2 matrix axis mean. */
export interface QuestAiAxis {
	low: string;
	high: string;
}

/** One quest slide: polls and prompts, no correct answers. `options` are choices, statements or items. */
export interface QuestAiSlide {
	title: string;
	type: QuestAiSlideType;
	options: string[];
	/** matrix_2x2 only. */
	x_axis?: QuestAiAxis | null;
	y_axis?: QuestAiAxis | null;
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
	| "fill_blanks"
	| "drag_drop"
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
	/** Each missing word in [square brackets]; players type it. */
	| { type: "fill_blanks"; title: string; sentence: string }
	/** Each missing word in [square brackets]; players drag it from a word bank that also holds `distractors`. */
	| { type: "drag_drop"; title: string; sentence: string; distractors: string[] }
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
