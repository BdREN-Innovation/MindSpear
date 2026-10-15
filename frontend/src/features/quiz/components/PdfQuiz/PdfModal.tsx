"use client";

import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams, useRouter } from "next/navigation";
import { AxiosError } from "axios";
import axiosInstance from "@/utils/axiosInstance";
import moment from "@/lib/dayjs";
import { transformQuestionData } from "@/utils/quizUtils";
import { setMultipleSelectedItems } from "@/features/quiz/store/quizItems/quizSlice";
import { Quiz } from "@/types/types";
import { DocumentToQuestionsModal } from "@/features/ai-generate/components/DocumentToQuestionsWizard";
import { toQuizQuestions } from "@/features/ai-generate/mappers";
import type { GeneratedFor } from "@/features/ai-generate/types";
import type { GeneratedContext } from "@/features/ai-generate/components/DocumentToQuestionsWizard";

interface QuizState {
	qseaneType: string;
	quiz: Quiz;
}
interface QuizInformationProps {
	quizInformation: {
		quizInformation: QuizState;
	};
}

/** "AI Generate (From a File)" for quizzes: pick a document from My Files (or upload one) and generate questions. */
export default function PdfModal({
	initialOpen = false,
	onClose,
}: {
	initialOpen?: boolean;
	onClose?: () => void;
}) {
	const params = useParams();
	const router = useRouter();
	const dispatch = useDispatch();
	const quizId = `${params?.quizId ?? ""}`;

	const quizData = useSelector(
		(state: QuizInformationProps) => state.quizInformation.quizInformation
	);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const shouldOpen =
			initialOpen ||
			(quizData?.qseaneType === "pdf" &&
				quizData?.quiz.questions?.length === 0);

		if (shouldOpen) setOpen(true);
	}, [initialOpen, quizData]);

	const close = () => {
		setOpen(false);
		onClose?.();
	};

	const saveQuestions = async (
		result: GeneratedFor<"quiz">,
		{ options }: GeneratedContext
	) => {
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		try {
			const response = await axiosInstance.post(
				`/quiz/questions/store-multiple`,
				{ questions: toQuizQuestions(result.questions, quizId) },
				{ timeout: 60_000 }
			);

			// Name the new quiz after the topic and open it for a day, as before.
			await axiosInstance
				.post(`/quizes/update/${quizId}`, {
					title: options.topic,
					open_datetime: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
					close_datetime: moment(
						new Date(Date.now() + 24 * 60 * 60 * 1000)
					).format("YYYY-MM-DD HH:mm:ss"),
					timezone,
					is_published: true,
				})
				.catch((error) => console.error("Quiz update failed:", error));

			dispatch(
				setMultipleSelectedItems(
					transformQuestionData(response?.data.data.questions)
				)
			);
			router.push(`/quiz-edit/${quizId}`);
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;
			throw new Error(
				axiosError.response?.data?.message ||
					"The questions were generated but couldn't be saved. Please try again."
			);
		}
	};

	return (
		<DocumentToQuestionsModal
			open={open}
			onClose={close}
			title="Generate a quiz from a document"
			target="quiz"
			generateLabel="Generate quiz"
			onGenerated={saveQuestions}
		/>
	);
}
