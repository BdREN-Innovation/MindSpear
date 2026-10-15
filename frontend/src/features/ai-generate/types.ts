// Generating questions from a document in My Files, for quizzes, quests and fun games.
// `quest` feeds the legacy (v1) quest editor; `quest_v2` writes slides for the
// slide-based Quest v2 editor (backend type keys, saved through slides/bulk).

export type GenerationTarget = "quiz" | "quest" | "quest_v2" | "fungame";

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

/** Fun games are single-answer only. */
export interface FunGameAiQuestion {
	text: string;
	options: string[];
	answer: number;
}

export type GenerateResponse =
	| { target: "quiz"; questions: QuizAiQuestion[] }
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
	quest: ["single_choice", "multiple_choice", "truefalse", "wordcloud"],
	quest_v2: ["poll_single", "poll_multi", "word_cloud", "open_ended"],
	fungame: ["single_choice", "true_false"],
};

export const MAX_QUESTIONS = 30;

/** Characters of document text sent to the AI; longer selections are cut. */
export const MAX_TEXT_CHARS = 60_000;

export const TARGET_NOUN: Record<GenerationTarget, { singular: string; plural: string }> = {
	quiz: { singular: "question", plural: "questions" },
	quest: { singular: "task", plural: "tasks" },
	quest_v2: { singular: "slide", plural: "slides" },
	fungame: { singular: "question", plural: "questions" },
};
