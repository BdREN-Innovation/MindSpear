// Generating questions from a document in My Files, for quizzes, quests and fun games.

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

/** Fun games are single-answer only. */
export interface FunGameAiQuestion {
	text: string;
	options: string[];
	answer: number;
}

export type GenerateResponse =
	| { target: "quiz"; questions: QuizAiQuestion[] }
	| { target: "quest"; questions: QuestAiTask[] }
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
	fungame: [
		{ value: "single_choice", label: "Multiple choice (one correct)" },
		{ value: "true_false", label: "True / False" },
	],
};

export const DEFAULT_TYPES: Record<GenerationTarget, string[]> = {
	quiz: ["single_choice", "multiple_choice", "true_false", "fill_in_the_blanks", "short_answer"],
	quest: ["single_choice", "multiple_choice", "truefalse", "wordcloud"],
	fungame: ["single_choice", "true_false"],
};

export const MAX_QUESTIONS = 30;

/** Characters of document text sent to the AI; longer selections are cut. */
export const MAX_TEXT_CHARS = 60_000;

export const TARGET_NOUN: Record<GenerationTarget, { singular: string; plural: string }> = {
	quiz: { singular: "question", plural: "questions" },
	quest: { singular: "task", plural: "tasks" },
	fungame: { singular: "question", plural: "questions" },
};
