"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui";
import { MdDataSaverOn, MdError } from "react-icons/md";
import Image from "next/image";
import { useParams, useRouter, usePathname } from "next/navigation";
import { useSelector } from "react-redux";
import { useSurveyOptional } from "@/contexts/SurveyContext";
// import { RootState } from "@/services/redux/store";
import axiosInstance from "@/utils/axiosInstance";
import { toast } from "react-toastify";
import { AxiosError } from "axios";
import { FaEye } from "react-icons/fa6";
import { SiKdenlive } from "react-icons/si";
// import { useRouter } from 'next/router';
import { Quiz } from "@/types/types";
// import { clearQuest } from "@/services/redux/features/questInformationSlice";
import { IoSaveSharp } from "react-icons/io5";
import { QuestConvertDataComponent } from "@/utils/questDataTransformer";
import { quickFormTaskArray } from "@/utils/quickFormTransform";
import { SaveAll } from "lucide-react";
// import { type Questio nsResponse } from "@/utils/quickFormTransform";
interface QuizState {
	quiz: Quiz;
}
interface QuizRootState {
	quizInformation: {
		quizInformation: QuizState;
	};
}

function SurveySave() {
	const [isModalOpen, setIsModalOpen] = useState(false);
	const params = useParams();
	const pathname = usePathname();
	const router = useRouter();
	const isQuizCreate = pathname.includes("survey/create");
	const isQuizEdit = pathname.includes("survey/edit");
	const surveyContext = useSurveyOptional();

	const task2222 = useSelector(
		(state: any) => state.quickForm.byQuest as Record<string, any[]>,
	);

	const qId = params?.id as string;
	const allTasks = task2222[qId] || [];
	const tasksWithQuestions = allTasks.filter(
		(task) => task.questions && task.questions.length > 0,
	);
	// console.log(allTasks, "allTasksallTasksallTasks");

	// Get all questions from surveyQuestionsSlice (page-aware storage)
	const reduxQuestionsByPage = useSelector(
		(state: any) => state.surveyQuestions?.questionsByPage || {},
	);

	// Get edited questions from the survey store (this has the latest edits)
	const reduxEditedQuestions = useSelector(
		(state: any) => state.survey?.multypleselectedItem || [],
	);

	const contextQuestionsByPage = surveyContext?.state.questionsByPage;
	const contextEditedQuestions = surveyContext?.state.multypleselectedItem;

	const questionsByPage =
		contextQuestionsByPage && Object.keys(contextQuestionsByPage).length > 0
			? contextQuestionsByPage
			: reduxQuestionsByPage;

	const editedQuestions =
		contextEditedQuestions && contextEditedQuestions.length > 0
			? contextEditedQuestions
			: reduxEditedQuestions;

	// Use editedQuestions if available (they contain the edits), otherwise fall back to questionsByPage
	let multypleselectedItem: any[] = [];

	if (editedQuestions && editedQuestions.length > 0) {
		// Use the edited questions from surveySlice (these have the latest changes)
		multypleselectedItem = editedQuestions.filter((item: any) => {
			return (
				item?.survey_id === Number(qId) ||
				item?.survey_id === qId ||
				!item?.survey_id ||
				item?.quiz_id === Number(qId) ||
				item?.quiz_id === qId
			);
		}) as any[];
	} else {
		// Fall back to page-aware storage if no edited questions
		multypleselectedItem = Object.entries(questionsByPage)
			.flat()
			.flat()
			.filter((item: any) => {
				// Only include questions from the current survey
				return (
					item?.survey_id === Number(qId) ||
					item?.survey_id === qId ||
					!item?.survey_id
				);
			}) as any[];
	}

	const stripHtml = (html: string) =>
		html
			.replace(/<[^>]*>/g, "")
			.replace(/&nbsp;/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	type ValidationResult = {
		id: string;
		title: string;
		key: string;
		messages: string[];
		hasError: boolean;
	};

	function validateQuestions(
		data: any[] | undefined | null,
	): ValidationResult[] {
		if (!Array.isArray(data) || data.length === 0) return [];

		return data
			.filter((item) => {
				// Skip completely empty questions (no title and no options)
				const hasTitle = item?.title?.trim();
				const hasOptions =
					Array.isArray(item?.options) && item.options.length > 0;
				return hasTitle || hasOptions;
			})
			.map((item) => {
				const messages: string[] = [];

				// Only validate questions with options (multiple choice, ranking, scales, etc)
				const options = Array.isArray(item?.options)
					? item.options
					: [];
				const filledOptions = options.filter((opt: any) => {
					const text = typeof opt === "string" ? opt : opt?.text;
					return text?.trim() !== "";
				});

				console.log(`VALIDATION - Question ${item.id} (${item.key}):`, {
					totalOptions: options.length,
					filledOptions: filledOptions.length,
					options: options,
				});

				// For question types that require options
				if (
					[
						"qsenchoice",
						"truefalse",
						"ranking",
						"scales",
						"sorting",
						"wordcloud",
					].includes(item.key)
				) {
					if (filledOptions.length < 2) {
						messages.push("At least 2 options must have text.");
					}
				}

				return {
					id: item.id,
					title: item.title,
					key: item.key,
					messages,
					hasError: messages.length > 0,
				};
			});
	}

	const validationResults = validateQuestions(multypleselectedItem);
	const transformed = QuestConvertDataComponent(multypleselectedItem);
	const isFormValid = validationResults.every((result) => !result.hasError);
	const payloadData = quickFormTaskArray(
		transformed.tasks,
		tasksWithQuestions,
	);

	// Group questions by page, then recalculate serial numbers per page
	const questionsByPageGrouped = multypleselectedItem.reduce(
		(acc: Record<number, any[]>, item: any) => {
			const pageId = item?.page_id || 1;
			if (!acc[pageId]) {
				acc[pageId] = [];
			}
			acc[pageId].push(item);
			return acc;
		},
		{},
	);

	// Flatten and assign correct serial numbers per page
	const questionsArray = Object.entries(questionsByPageGrouped).flatMap(
		([pageId, pageQuestions]: [string, any]) => {
			return (pageQuestions as any[]).map((item: any, index: number) => {
				const rawTitle =
					item?.title?.trim() || item?.question_text?.trim();
				const normalizedTitle = rawTitle ? stripHtml(rawTitle) : "";
				const titleText =
					normalizedTitle && normalizedTitle !== "." ? rawTitle : "";

				// Extract options from item - handle multiple formats
				let options: any[] = [];
				if (Array.isArray(item.options)) {
					options = item.options
						.map((opt: any) => {
							if (typeof opt === "string") {
								return opt.trim();
							} else if (opt && opt.text) {
								return opt.text.trim();
							}
							return null;
						})
						.filter((opt: any) => opt !== null && opt !== "");
				}

				// Debug logging
				console.log(`Question ${item.id} (${item.key}):`, {
					title: titleText,
					rawOptions: item.options,
					processedOptions: options,
				});

				const payload: Record<string, any> = {
					id: item.id,
					survey_id: item.survey_id || Number(qId),
					serial_number: index + 1,
					is_required: item.is_required ?? false,
				};

				if (titleText) {
					payload.question_text = titleText;
				}
				if (options.length > 0) {
					payload.options = options;
				}

				return payload;
			});
		},
	);

	const obj = {
		questions: questionsArray, // Only send questions array
	};

	const normalizeOptions = (rawOptions: any) => {
		let options: any[] = [];
		if (!rawOptions) return options;
		try {
			if (typeof rawOptions === "string") {
				options = JSON.parse(rawOptions);
			} else if (Array.isArray(rawOptions)) {
				options = rawOptions;
			}
		} catch (error) {
			console.error("Error parsing options:", error);
			options = [];
		}
		return options
			.map((opt: any) =>
				typeof opt === "string" ? opt.trim() : opt.text?.trim(),
			)
			.filter(Boolean);
	};

	const onSubmit = async () => {
		try {
			// Use the locally edited data (multypleselectedItem) instead of server data
			// This ensures all changes made in the UI are preserved
			const updatePayload = {
				questions: questionsArray,
			};

			console.log("FINAL PAYLOAD BEING SENT:", updatePayload);
			console.log(
				"Payload with full details:",
				JSON.stringify(updatePayload, null, 2),
			);

			const response = await axiosInstance.post(
				"/survey-questions/update-multiple",
				updatePayload,
			);

			toast.success(
				response.data.message ||
					`Survey ${isQuizEdit ? "updated" : "created"} successfully`,
			);
			setIsModalOpen(false);

			// Redirect based on mode
			if (isQuizEdit) {
				// For edit mode, do a hard reload to fetch fresh data from server
				// This ensures the latest changes are loaded
				window.location.href = `/survey/create/${qId}`;
			} else {
				// For create mode, redirect to the library (purging the whole store here also logged
				// the user out on the next page load).
				router.push("/my-library/survey-page");
			}
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;
			if (axiosError.response) {
				console.error("Error:", axiosError.response.data);
				toast.error(
					axiosError.response.data?.message || "Verification failed.",
				);
			} else {
				console.error("Unexpected error:", axiosError.message);
				toast.error(
					axiosError.message ||
						"Unexpected error occurred. Please try again.",
				);
			}
		}
	};

	// console.log(isQuizEdit, "isQuizCreateisQuizCreateisQuizCreateisQuizCreate");

	const handleSaveClick = () => {
		// No validation checks - directly open confirmation modal
		setIsModalOpen(true);
	};

	return (
		<div>
			{isQuizCreate ? (
				<button
					onClick={handleSaveClick}
					className=" group rounded-full bg-gray-3 py-2 px-4 text-[#111928] outline-1 outline-primary focus-visible:outline dark:bg-[#020D1A] dark:text-current flex items-center"
				>
					<SaveAll size={22} className="text-gray-600" />
					<span className="hidden sm:inline text-[0.875rem] ml-[10px] font-medium">
						{" "}
						Save{" "}
					</span>
				</button>
			) : (
				""
			)}
			{isQuizEdit ? (
				<button
					onClick={handleSaveClick}
					className=" group rounded-full bg-gray-3 py-[8px] px-[12px] text-[#111928] outline-1 outline-primary focus-visible:outline dark:bg-[#020D1A] dark:text-current flex items-center"
				>
					<MdDataSaverOn size={24} />
					<span className="hidden sm:inline text-[0.875rem] ml-[10px] font-medium">
						{" "}
						Update{" "}
					</span>
				</button>
			) : (
				""
			)}

			{/* Confirmation Modal - Only shows when validation passes */}
			<Modal
				title={""}
				open={isModalOpen}
				onClose={() => setIsModalOpen(false)}
			>
				<div className="flex flex-col justify-center items-center">
					<h3 className="text-[18px] md:text-[25px]  py-[10px] font-bold w-full border border-[#2222] text-center rounded-[10px] mt-[10px] shadow-2">
						{" "}
						Are you sure you want to{" "}
						{isQuizEdit ? "update" : "save"} the Survey{" "}
					</h3>
					<IoSaveSharp className="text-[100px] text-primary my-[30px]" />
				</div>

				<div className="flex justify-center items-center mt-[20px] gap-4 ">
					<button
						onClick={() => setIsModalOpen(false)}
						className="flex text-[.875rem]  items-center bg-[#bc5eb3] text-[#fff] hover:text-blue-600 font-bold py-3 px-4 w-full justify-center rounded-md"
					>
						{" "}
						Cancel{" "}
					</button>

					<button
						onClick={() => onSubmit()}
						className="flex text-[.875rem]  items-center bg-primary text-[#fff] hover:text-blue-600 font-bold py-3 px-4 w-full justify-center rounded-md"
					>
						{" "}
						{isQuizEdit ? "Update" : "Submit"}{" "}
					</button>
				</div>
			</Modal>
		</div>
	);
}

export default SurveySave;
