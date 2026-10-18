/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui";
import { MdDataSaverOn } from "react-icons/md";
import { AlertTriangle, Pencil, Save } from "lucide-react";
import Image from "next/image";
import { useParams, useRouter, usePathname } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { clearMultipleSelectedItems, setSelectedItem } from "@/features/quiz/store/quizItems/quizSlice";
// import { RootState } from "@/services/redux/store";
import axiosInstance from "@/utils/axiosInstance";
import { toast } from "react-toastify";
import { AxiosError } from "axios";
// import { useRouter } from 'next/router';
// import { clearQuest } from "@/services/redux/features/questInformationSlice";
import { QuestConvertDataComponent } from "@/utils/questDataTransformer";
import { quickFormTaskArray } from "@/utils/quickFormTransform";
import { SaveAll } from "lucide-react";
// import { type Questio nsResponse } from "@/utils/quickFormTransform";

function QuestSave() {
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [saving, setSaving] = useState(false);
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
	const params = useParams();
	const pathname = usePathname();
	const router = useRouter();
	const isQuizCreate = pathname.includes("quest/create");
	const isQuizEdit = pathname.includes("quest/edit");

	const task2222 = useSelector(
		(state: any) => state.quickForm.byQuest as Record<string, any[]>,
	);

	const qId = params?.id as string;
	const allTasks = task2222[qId] || [];
	const tasksWithQuestions = allTasks.filter(
		(task) => task.questions && task.questions.length > 0,
	);
	// console.log(allTasks, "allTasksallTasksallTasks");

	const quesentList =
		useSelector((state: any) => state.quiz.multypleselectedItem) ?? [];
	const multypleselectedItem: any[] = Array.isArray(quesentList)
		? quesentList.filter((list) => `${list?.quiz_id}` === `${qId}`)
		: [];

	// console.log(
	// 	multypleselectedItem,
	// 	"multypleselectedItemmultypleselectedItemmultypleselectedItem"
	// );


	type ValidationResult = {
		id: string;
		title: string;
		key: string;
		messages: string[];
		hasError: boolean;
	};

	function validateQuestions(
		data: typeof quesentList | undefined | null,
	): ValidationResult[] {
		if (!Array.isArray(data)) return [];

		// console.log(data, "datadatadatadata");

		return data.map((item) => {
			const messages: string[] = [];

			// ✅ guard against missing options
			const options = Array.isArray(item?.options) ? item.options : [];

			const filledOptions = options.filter(
				(opt: { text: string }) => opt?.text?.trim() !== "",
			);

			if (item.key === "qsenchoice") {
				if (!item.title?.trim()) messages.push("Add the question text.");
				if (filledOptions.length < 2)
					messages.push("Fill in at least 2 options.");
			}

			if (item.key === "wordcloud" && !item.title?.trim()) {
				messages.push("Add the question text.");
			}

			if (item.key === "truefalse") {
				if (!item.title?.trim()) messages.push("Add the question text.");
				if (filledOptions.length < 2)
					messages.push("Fill in at least 2 options.");
			}

			if (
				[
					"sortanswer",
					"shortanswer",
					"longanswer",
					"quick_form",
				].includes(item.key)
			) {
				if (!item.title?.trim()) messages.push("Add the question text.");
			}

			if (["scales", "ranking", "sorting"].includes(item.key)) {
				if (!item.title?.trim()) messages.push("Add the question text.");
				if (filledOptions.length < 2)
					messages.push("Fill in at least 2 options.");
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
	// console.log(payloadData, "payloadDatapayloadDatapayloadData");
	// console.log(transformed, "payloadDatapayloadDatapayloadData");
	// console.log(multypleselectedItem, "payloadDatapayloadDatapayloadData");

	const obj = {
		tasks: payloadData,
	};

	// The quest being edited (its settings live in questInformation).
	const questInfo = useSelector((state: any) => state.questInformation?.questInformation);
	const questTitle: string = (questInfo?.quest ?? questInfo)?.title ?? "";
	const hasQuestName = !!questTitle.trim() && questTitle !== "My Quest" && questTitle !== "Untitled Quest";
	const problems = validationResults
		.filter((result) => result.hasError)
		.map((result) => ({
			...result,
			position: multypleselectedItem.find((item) => `${item.id}` === `${result.id}`)?.position ?? "",
		}));
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
				`/quest-tasks/update-multiple`,
				obj,
			);
			toast.success(response.data.message);
			setIsModalOpen(false);
			// The editor's questions are cleared once it unmounts (see below).
			savedRef.current = true;
			router.push("/my-library/quest-page");
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;
			if (axiosError.response) {
				console.error(
					"Error verifying token:",
					axiosError.response.data,
				);
				toast.error(
					axiosError.response.data?.message || "The quest could not be saved. Please try again.",
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

	// console.log(isQuizEdit, "isQuizCreateisQuizCreateisQuizCreateisQuizCreate");
	const getQuestionImage = (channel: any) => {
		const imageMap: { [key: string]: string } = {
			qsenchoice: "/images/icons/Icon-01.svg",
			truefalse: "/images/icons/yes-no.svg",
			wordcloud: "/images/icons/word-cloud.svg",
			scales: "/images/icons/scales.svg",
			ranking: "/images/icons/ranking.svg",
			shortanswer: "/images/icons/Icon-03.svg",
			longanswer: "/images/icons/long-answer.svg",
			sorting: "/images/icons/sorting.svg",
			quick_form: "/images/icons/quick-form.svg",
		};

		return imageMap[channel.key] || "/images/types/default.png";
	};

	return (
		<div>
			{isQuizCreate ? (
				<button
					onClick={() => setIsModalOpen(true)}
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
					onClick={() => setIsModalOpen(true)}
					className=" group rounded-full  bg-gray-3 py-[8px] px-[12px] text-[#111928] outline-1 outline-primary focus-visible:outline dark:bg-[#020D1A] dark:text-current flex items-center"
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

			<Modal title="" open={isModalOpen} onClose={() => setIsModalOpen(false)} width={600}>
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
									Fix these before {isQuizEdit ? "updating" : "saving"} your quest.
								</p>
							</div>
						</div>
						<ul className="mt-4 max-h-[320px] space-y-2 overflow-y-auto pr-1">
							{problems.map((result) => (
								<li key={result.id} className="flex items-center gap-3 rounded-lg border border-[#eee] p-3">
									<Image src={getQuestionImage(result)} alt="" width={32} height={32} />
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
				) : !hasQuestName ? (
					<div className="text-center">
						<span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fff3e8]">
							<Pencil className="h-6 w-6 text-primary" aria-hidden />
						</span>
						<h3 className="mt-3 text-lg font-bold text-[#222]">Give your quest a name first</h3>
						<p className="mx-auto mt-1 max-w-[380px] text-sm text-[#666]">
							Click <span className="font-semibold">Untitled quest</span> at the top left to name it, then
							{isQuizEdit ? " update" : " save"} again.
						</p>
					</div>
				) : (
					<div className="text-center">
						<span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fff3e8]">
							<Save className="h-6 w-6 text-primary" aria-hidden />
						</span>
						<h3 className="mt-3 text-lg font-bold text-[#222]">
							{isQuizEdit ? "Update" : "Save"} &ldquo;{questTitle}&rdquo;?
						</h3>
						<p className="mt-1 text-sm text-[#666]">
							{multypleselectedItem.length} question{multypleselectedItem.length === 1 ? "" : "s"}
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
					{isFormValid && hasQuestName && (
						<button
							type="button"
							onClick={() => onSubmit()}
							disabled={saving}
							className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
						>
							{saving && (
								<span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
							)}
							{isQuizEdit ? "Update quest" : "Save quest"}
						</button>
					)}
				</div>
			</Modal>
		</div>
	);
}

export default QuestSave;
