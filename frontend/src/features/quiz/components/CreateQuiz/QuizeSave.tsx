import React, { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui";
// import { QuizItem, FinalData, TransformedQuestion } from '@/types/types';
import { MdDataSaverOn } from "react-icons/md";
import { AlertTriangle, Pencil, Save } from "lucide-react";
import Image from "next/image";
import { useParams, useRouter, usePathname } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/stores/store";
import axiosInstance from "@/utils/axiosInstance";
import { toast } from "react-toastify";
import { AxiosError } from "axios";
// import { useRouter } from 'next/router';
import { convertDataToQuestions } from "@/utils/quizUtils";
import { Quiz } from "@/types/types";
import { clearQuiz } from "@/features/quiz/store/quizInformationSlice";
import { clearMultipleSelectedItems, setSelectedItem } from "@/features/quiz/store/quizItems/quizSlice";
const TYPE_ICONS: Record<string, string> = {
	quiz: "/images/icons/Icon-01.svg",
	truefalse: "/images/icons/Icon-02.svg",
	sortanswer: "/images/icons/Icon-03.svg",
	fillintheblanks: "/images/icons/Icon-04.svg",
};

interface QuizState {
	quiz: Quiz;
}
interface QuizRootState {
	quizInformation: {
		quizInformation: QuizState;
	};
}

function QuizeSave() {
	const [isModalOpen, setIsModalOpen] = useState(false);
	const params = useParams();
	const pathname = usePathname();
	const router = useRouter();
	const isQuizCreate = pathname.includes("quiz-creator");
	const isQuizEdit = pathname.includes("quiz-edit");

	const dispatch = useDispatch();
	// Set after a save. The questions are cleared when the editor unmounts: clearing them before
	// leaving flashed the empty "Add your first question" picker while the next page loaded. Only
	// the questions are cleared; purging the whole store also logged the user out.
	const savedRef = useRef(false);
	useEffect(
		() => () => {
			if (savedRef.current) dispatch(clearMultipleSelectedItems());
		},
		[dispatch]
	);
	const qId = params?.quizId as string;
	const quesentList = useSelector(
		(state: RootState) => state.quiz.multypleselectedItem,
	);
	const multypleselectedItem = quesentList?.filter(
		(list) => `${list?.quiz_id}` === `${qId}`,
	);
	const quizresponse = useSelector(
		(state: QuizRootState) => state?.quizInformation?.quizInformation?.quiz,
	);
	console.log(quizresponse, "quizInformation");

	type ValidationResult = {
		id: string;
		title: string;
		key: string;
		messages: string[];
		hasError: boolean;
	};

	// The title is the editor's HTML: an emptied editor can leave markup such as "<br>".
	const hasText = (html?: string) =>
		!!html?.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

	function validateQuestions(data: typeof quesentList): ValidationResult[] {
		console.log(quesentList, "datadatadatadatadatadata");

		return data.map((item) => {
			const messages: string[] = [];

			const filledOptions = item.options.filter(
				(opt) => opt.text?.trim() !== "",
			);
			const selectedOptions = item.options.filter(
				(opt) => opt.isSelected,
			);
			console.log(
				selectedOptions,
				"quesentListquesentListquesentListquesentList",
			);

			if (item.key === "quiz" || item.key === "fillintheblanks") {
				if (!hasText(item.title)) {
					messages.push("Add the question text.");
				}
				if (filledOptions.length < 2) {
					messages.push("Fill in at least 2 answers.");
				}
				if (selectedOptions.length === 0) {
					messages.push("Mark the correct answer.");
				}
				if (!item.isMultipleSelection && selectedOptions.length > 1) {
					messages.push("Mark only one correct answer, or turn on Multiple correct answers.");
				}
				// Players see the blank where the question has four or more underscores.
				if (item.key === "fillintheblanks" && hasText(item.title) && !/_{4,}/.test(item.title ?? "")) {
					messages.push("Add the blank: type ____ (four underscores) where the missing word goes.");
				}
			}

			if (item.key === "truefalse") {
				if (!hasText(item.title)) {
					messages.push("Add the question text.");
				}
				if (selectedOptions.length !== 1) {
					messages.push("Choose True or False as the correct answer.");
				}
			}

			if (item.key === "sortanswer") {
				if (!hasText(item.title)) {
					messages.push("Add the question text.");
				}
				// Without an accepted answer nobody can ever get it right.
				if (filledOptions.length === 0) {
					messages.push("Add at least one accepted answer.");
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
	const transformed = convertDataToQuestions(multypleselectedItem);
	console.log(multypleselectedItem, "validationResultsvalidationResults");
	// console.log(transformed, "validationResultsvalidationResults");

	const isFormValid = validationResults.every((result) => !result.hasError);
	const problems = validationResults
		.filter((result) => result.hasError)
		.map((result) => ({
			...result,
			position: multypleselectedItem.find((item) => `${item.id}` === `${result.id}`)?.position ?? "",
		}));
	const hasQuizName = !!quizresponse?.title?.trim() && quizresponse?.title !== "My Quiz";
	const totalPoints = multypleselectedItem.reduce((sum, item) => sum + (Number(item.points) || 1), 0);
	const [saving, setSaving] = useState(false);

	/** "Fix": close the dialog on the question that needs it (the buttons did nothing). */
	const fixQuestion = (id: string) => {
		const item = multypleselectedItem.find((question) => `${question.id}` === `${id}`);
		if (item) dispatch(setSelectedItem(item));
		setIsModalOpen(false);
	};

	const onSubmit = async () => {
		if (saving) return;
		setSaving(true);
		try {
			const response = await axiosInstance.post(
				`/quiz/questions/${
					isQuizCreate
						? "update-multiple"
						: isQuizEdit
							? "update-multiple"
							: ""
				}   `,
				transformed,
			);
			toast.success(response.data.message);
			setIsModalOpen(false);
			// The editor's questions are cleared once it unmounts (see below).
			savedRef.current = true;
			router.push("/my-library/quiz-page");
			dispatch(clearQuiz());
			// console.log(response, "responseData?.data");
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;

			if (axiosError.response) {
				console.error(
					"Error verifying token:",
					axiosError.response.data,
				);
				toast.error(
					axiosError.response.data?.message || "The quiz could not be saved. Please try again.",
				);
			} else {
				console.error("Unexpected error:", axiosError.message);
				toast.error(
					axiosError.message ||
						"Unexpected error occurred. Please try again.",
				);
			}
		} finally {
			setSaving(false);
		}
	};

	return (
		<div>
			{isQuizCreate ? (
				<button
					onClick={() => setIsModalOpen(true)}
					className=" group rounded-full bg-gray-3 py-[8px] px-[12px] text-[#111928] outline-1 outline-primary focus-visible:outline dark:bg-[#020D1A] dark:text-current flex items-center"
				>
					<MdDataSaverOn size={30} />
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
					onClick={() => setIsModalOpen(true)}
					className=" group rounded-full bg-gray-3 py-[8px] px-[12px] text-[#111928] outline-1 outline-primary focus-visible:outline dark:bg-[#020D1A] dark:text-current flex items-center"
				>
					<MdDataSaverOn size={30} />
					<span className="hidden sm:inline text-[0.875rem] ml-[10px] font-medium">
						{" "}
						Update{" "}
					</span>
				</button>
			) : (
				""
			)}

			<Modal title="" open={isModalOpen} onClose={() => setIsModalOpen(false)}>
				{!isFormValid ? (
					<div>
						<div className="flex items-start gap-3">
							<span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-50">
								<AlertTriangle className="h-5 w-5 text-red-500" aria-hidden />
							</span>
							<div>
								<h3 className="text-lg font-bold text-[#222]">
									{problems.length === 1
										? "1 question needs attention"
										: `${problems.length} questions need attention`}
								</h3>
								<p className="text-sm text-[#666]">
									Fix these before {isQuizEdit ? "updating" : "saving"} your quiz.
								</p>
							</div>
						</div>
						<ul className="mt-4 max-h-[320px] space-y-2 overflow-y-auto pr-1">
							{problems.map((result) => (
								<li
									key={result.id}
									className="flex items-center gap-3 rounded-lg border border-[#eee] p-3"
								>
									{TYPE_ICONS[result.key] && (
										<Image src={TYPE_ICONS[result.key]} alt="" width={32} height={32} />
									)}
									<div className="min-w-0 flex-1">
										<p className="text-xs font-semibold uppercase tracking-wide text-[#999]">
											Question {result.position}
										</p>
										<ul className="text-sm text-red-600">
											{result.messages.map((msg) => (
												<li key={msg}>{msg}</li>
											))}
										</ul>
									</div>
									<button
										type="button"
										onClick={() => fixQuestion(result.id)}
										className="flex-shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
									>
										Fix
									</button>
								</li>
							))}
						</ul>
					</div>
				) : !hasQuizName ? (
					<div className="text-center">
						<span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fff3e8]">
							<Pencil className="h-6 w-6 text-primary" aria-hidden />
						</span>
						<h3 className="mt-3 text-lg font-bold text-[#222]">Give your quiz a name first</h3>
						<p className="mx-auto mt-1 max-w-[380px] text-sm text-[#666]">
							Click <span className="font-semibold">Untitled quiz</span> at the top left to name it, then
							{isQuizEdit ? " update" : " save"} again.
						</p>
					</div>
				) : (
					<div className="text-center">
						<span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fff3e8]">
							<Save className="h-6 w-6 text-primary" aria-hidden />
						</span>
						<h3 className="mt-3 text-lg font-bold text-[#222]">
							{isQuizEdit ? "Update" : "Save"} &ldquo;{quizresponse?.title}&rdquo;?
						</h3>
						<p className="mt-1 text-sm text-[#666]">
							{multypleselectedItem.length} question{multypleselectedItem.length === 1 ? "" : "s"} ·{" "}
							{totalPoints} point{totalPoints === 1 ? "" : "s"}
						</p>
					</div>
				)}

				<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
					<button
						type="button"
						onClick={() => setIsModalOpen(false)}
						className="w-full rounded-lg border border-[#e5e5e5] bg-white px-4 py-2.5 text-sm font-semibold text-[#333] hover:bg-[#fafafa]"
					>
						Keep editing
					</button>

					{isFormValid && hasQuizName && (
						<button
							type="button"
							onClick={() => onSubmit()}
							disabled={saving}
							className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
						>
							{saving && (
								<span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
							)}
							{isQuizEdit ? "Update quiz" : "Save quiz"}
						</button>
					)}
				</div>
			</Modal>
		</div>
	);
}

export default QuizeSave;
