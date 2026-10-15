import type { ImportFileQuestionV1 } from "@/features/fun-games/types";
import type { FunGameAiQuestion, QuestAiTask, QuizAiQuestion } from "./types";

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

/** Rows for the fun-game JSON import preview (single answer only). */
export function toFunGameImport(questions: FunGameAiQuestion[]): ImportFileQuestionV1[] {
	return questions.map((q) => ({
		type: "single_choice",
		text: q.text,
		options: q.options,
		answer: q.answer,
	}));
}
