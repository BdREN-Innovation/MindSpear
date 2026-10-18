"use client";

import { useCallback, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import axiosInstance from "@/utils/axiosInstance";
import { addNewQuestItem } from "@/features/quiz/store/quizItems/quizSlice";
import type { RootState } from "@/stores/store";

/** The question types the quest editor can author, in menu order. */
export const QUEST_QUESTION_TYPES = [
	{ key: "qsenchoice", label: "Multiple choice", description: "A poll with answer options.", icon: "/images/icons/Icon-01.svg" },
	{ key: "truefalse", label: "Yes / No", description: "A quick yes-or-no vote.", icon: "/images/icons/yes-no.svg" },
	{ key: "wordcloud", label: "Word cloud", description: "Short words grow with each vote.", icon: "/images/icons/word-cloud.svg" },
	{ key: "scales", label: "Scales", description: "Rate statements on a scale.", icon: "/images/icons/scales.svg" },
	{ key: "ranking", label: "Ranking", description: "Players order items by preference.", icon: "/images/icons/ranking.svg" },
	{ key: "shortanswer", label: "Short answer", description: "A sentence or two of free text.", icon: "/images/icons/Icon-03.svg" },
	{ key: "longanswer", label: "Long answer", description: "Longer free-text answers.", icon: "/images/icons/long-answer.svg" },
	{ key: "sorting", label: "Sorting", description: "Players put items in order.", icon: "/images/icons/sorting.svg" },
	{ key: "quick_form", label: "Quick form", description: "Collect names or contact details.", icon: "/images/icons/quick-form.svg" },
] as const;

export type QuestQuestionKey = (typeof QUEST_QUESTION_TYPES)[number]["key"];

/**
 * Adds a question to a quest: the server creates its row first (the editor saves every task by
 * id), then it is added to the editor and selected.
 */
export function useAddQuestQuestion(questId: string) {
	const dispatch = useDispatch();
	const [adding, setAdding] = useState<string | null>(null);
	const items = useSelector((state: RootState) => state.quiz.multypleselectedItem);
	const questItems = (items ?? []).filter((item) => `${item?.quiz_id}` === `${questId}`);

	const addQuestion = useCallback(
		async (key: string) => {
			if (!questId || adding) return;
			setAdding(key);
			try {
				const response = await axiosInstance.post(`/quest-tasks/store`, {
					quest_id: `${questId}`,
					title: "Untitled question",
					task_type: key,
					visibility: "public",
					serial_number: questItems.length + 1,
				});
				dispatch(
					addNewQuestItem({
						key,
						quiz_id: `${questId}`,
						// Empty, so the editor shows its placeholder (not text to delete first).
						title: "",
						options: [],
						maxOptions: 0,
						minOptions: 0,
						allowDuplicates: false,
						isMultipleSelection: false,
						timeLimit: "",
						contant_title: "",
						image_url: "",
						layout_id: "",
						position: questItems.length + 1,
						id: response.data.data.questTask.id,
					})
				);
			} catch (error) {
				console.error("Failed to add question:", error);
				toast.error("The question could not be added. Please try again.");
			} finally {
				setAdding(null);
			}
		},
		[adding, dispatch, questId, questItems.length]
	);

	return { addQuestion, adding };
}
