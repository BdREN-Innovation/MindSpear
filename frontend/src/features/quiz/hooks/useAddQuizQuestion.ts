"use client";

import { useCallback, useState } from "react";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";
import axiosInstance from "@/utils/axiosInstance";
import { addNewItem } from "@/features/quiz/store/quizItems/quizSlice";

export type QuizQuestionKey = "quiz" | "truefalse" | "sortanswer" | "fillintheblanks";

/** The question types the quiz editor can author, in menu order. */
export const QUIZ_QUESTION_TYPES: {
	key: QuizQuestionKey;
	label: string;
	description: string;
	icon: string;
}[] = [
	{ key: "quiz", label: "Multiple choice", description: "Players pick one or more correct answers.", icon: "/images/icons/Icon-01.svg" },
	{ key: "truefalse", label: "True / False", description: "Players decide if a statement is true.", icon: "/images/icons/Icon-02.svg" },
	{ key: "sortanswer", label: "Short answer", description: "Players type the answer themselves.", icon: "/images/icons/Icon-03.svg" },
	{ key: "fillintheblanks", label: "Fill in the blanks", description: "Players choose the word that fills the gap.", icon: "/images/icons/Icon-04.svg" },
];

/**
 * Adds a question of the given type to a quiz: the server creates its row first (the editor
 * saves every question by id), then the new question is added to the editor and selected.
 */
export function useAddQuizQuestion(quizId: string) {
	const dispatch = useDispatch();
	const [adding, setAdding] = useState<QuizQuestionKey | null>(null);

	const addQuestion = useCallback(
		async (key: QuizQuestionKey) => {
			if (!quizId || adding) return;
			setAdding(key);
			try {
				const response = await axiosInstance.post(`/quiz/questions/store`, {
					quiz_id: quizId,
					question_text: ".",
					visibility: "public",
				});
				dispatch(
					addNewItem({
						key,
						id: `${response.data.data.question.id}`,
						quiz_id: `${quizId}`,
						title: "",
						options: [],
						maxOptions: 0,
						minOptions: 0,
						allowDuplicates: false,
						isMultipleSelection: false,
						timeLimit: "",
						position: 1,
					})
				);
			} catch (error) {
				console.error("Failed to add question:", error);
				toast.error("The question could not be added. Please try again.");
			} finally {
				setAdding(null);
			}
		},
		[adding, dispatch, quizId]
	);

	return { addQuestion, adding };
}
