"use client";

import React, { useState } from "react";
import Image from "next/image";
import { useDispatch } from "react-redux";
import { BookOpen, ListPlus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import PdfModal from "@/features/quiz/components/PdfQuiz/PdfModal";
import { QuestionBankModal } from "@/components/Layouts/sidebar/create-quiz-sidebar-contant";
import { QUIZ_QUESTION_TYPES, useAddQuizQuestion } from "@/features/quiz/hooks/useAddQuizQuestion";

/** What the editor shows for a quiz with no questions: start with a type, a file or the question bank. */
export default function QuizEmptyState({ quizId }: { quizId: string }) {
	const dispatch = useDispatch();
	const { addQuestion, adding } = useAddQuizQuestion(quizId);
	const [showPdfModal, setShowPdfModal] = useState(false);
	const [showBankModal, setShowBankModal] = useState(false);

	return (
		<div className="flex min-h-[calc(100vh-140px)] items-center justify-center rounded-[15px] bg-white px-4 py-10">
			<div className="w-full max-w-[720px] text-center">
				<div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#fff3e8]">
					<ListPlus className="h-8 w-8 text-primary" aria-hidden />
				</div>
				<h2 className="mt-4 text-2xl font-bold text-[#222]">Add your first question</h2>
				<p className="mx-auto mt-2 max-w-[460px] text-sm text-[#666]">
					Pick a question type to get started. You can reorder, duplicate or delete questions
					from the list on the left at any time.
				</p>

				<div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
					{QUIZ_QUESTION_TYPES.map((type) => (
						<button
							key={type.key}
							type="button"
							onClick={() => addQuestion(type.key)}
							disabled={adding !== null}
							className="group flex items-center gap-4 rounded-xl border border-[#e5e5e5] bg-white p-4 text-left transition hover:border-primary hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-70"
						>
							<span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-[#f7f7f7] group-hover:bg-[#fff3e8]">
								{adding === type.key ? (
									<span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
								) : (
									<Image src={type.icon} alt="" width={30} height={30} />
								)}
							</span>
							<span>
								<span className="block font-semibold text-[#222]">{type.label}</span>
								<span className="block text-xs text-[#777]">{type.description}</span>
							</span>
						</button>
					))}
				</div>

				<div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wide text-[#999]">
					<span className="h-px flex-1 bg-[#eee]" />
					or
					<span className="h-px flex-1 bg-[#eee]" />
				</div>

				<div className="flex flex-col justify-center gap-3 sm:flex-row">
					<Button variant="outline" onClick={() => setShowPdfModal(true)}>
						<Sparkles className="h-4 w-4 text-primary" aria-hidden />
						Generate from a file
					</Button>
					<Button variant="outline" onClick={() => setShowBankModal(true)}>
						<BookOpen className="h-4 w-4 text-secondary" aria-hidden />
						Import from question bank
					</Button>
				</div>
			</div>

			{showPdfModal && <PdfModal initialOpen appendToQuiz onClose={() => setShowPdfModal(false)} />}
			{showBankModal && (
				<QuestionBankModal
					isOpen={showBankModal}
					onClose={() => setShowBankModal(false)}
					quizId={quizId}
					dispatch={dispatch}
				/>
			)}
		</div>
	);
}
