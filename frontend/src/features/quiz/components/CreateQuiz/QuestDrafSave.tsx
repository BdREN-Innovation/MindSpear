/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from "react";
import { Modal } from "@/components/ui";
import { MdDataSaverOn, MdError } from "react-icons/md";
import Image from "next/image";
import { useParams, usePathname } from "next/navigation";
import { useSelector } from "react-redux";
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
import { RiDraftFill } from "react-icons/ri";
// import { type Questio nsResponse } from "@/utils/quickFormTransform";
interface QuizState {
	quiz: Quiz;
}
interface QuizRootState {
	quizInformation: {
		quizInformation: QuizState;
	};
}

function QuestDrafSave() {
	const [isModalOpen, setIsModalOpen] = useState(false);
	const params = useParams();
	const pathname = usePathname();
	// const router = useRouter();
	const isQuizCreate = pathname.includes("quest/create");
	const isQuizEdit = pathname.includes("quest/edit");

	const task2222 = useSelector(
		(state: any) => state.quickForm.byQuest as Record<string, any[]>
	);

	const qId = params?.id as string;
	const allTasks = task2222[qId] || [];
	const tasksWithQuestions = allTasks.filter(
		(task) => task.questions && task.questions.length > 0
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

	const quizresponse = useSelector(
		(state: QuizRootState) => state?.quizInformation?.quizInformation?.quiz
	);

	type ValidationResult = {
		id: string;
		title: string;
		key: string;
		messages: string[];
		hasError: boolean;
	};

	function validateQuestions(
		data: typeof quesentList | undefined | null
	): ValidationResult[] {
		if (!Array.isArray(data)) return [];

		// console.log(data, "datadatadatadata");

		return data.map((item) => {
			const messages: string[] = [];

			// ✅ guard against missing options
			const options = Array.isArray(item?.options) ? item.options : [];

			const filledOptions = options.filter(
				(opt: { text: string }) => opt?.text?.trim() !== ""
			);

			if (item.key === "qsenchoice") {
				// if (!item.title?.trim()) messages.push("Title is required.");
				if (filledOptions.length < 2)
					messages.push("At least 2 options must have text.");
			}

			if (item.key === "truefalse") {
				if (!item.title?.trim()) messages.push("Title is required.");
				if (filledOptions.length < 2)
					messages.push("At least 2 options must have text.");
			}

			if (
				[
					"sortanswer",
					"shortanswer",
					"longanswer",
					"quick_form",
				].includes(item.key)
			) {
				if (!item.title?.trim()) messages.push("Title is required.");
			}

			if (["scales", "ranking", "sorting"].includes(item.key)) {
				if (!item.title?.trim()) messages.push("Title is required.");
				if (filledOptions.length < 2)
					messages.push("At least 2 options must have text.");
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
		tasksWithQuestions
	);
	// console.log(payloadData, "payloadDatapayloadDatapayloadData");
	// console.log(transformed, "payloadDatapayloadDatapayloadData");
	// console.log(multypleselectedItem, "payloadDatapayloadDatapayloadData");

	const obj = {
		tasks: payloadData,
	};

	const onSubmit = async () => {
		try {
			const response = await axiosInstance.post(
				`/quest-tasks/update-multiple`,
				obj
			);
			toast.success(response.data.message);
			setIsModalOpen(false);
			// The editor stays open after a draft save (purging the store here also logged the user out).
			// router.push("/my-library?tab=quest");
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;
			if (axiosError.response) {
				console.error(
					"Error verifying token:",
					axiosError.response.data
				);
				toast.error(
					axiosError.response.data?.message || "Verification failed."
				);
			} else {
				console.error("Unexpected error:", axiosError.message);
				toast.error(
					axiosError.message ||
					"Unexpected error occurred. Please try again."
				);
			}
		}
	};

	const draftFunction = async () => {
		if (isFormValid) {
			onSubmit();
		} else {
			setIsModalOpen(true);
		}
	};


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
					onClick={() => draftFunction()}
					className=" group rounded-full bg-[#bc5eb3] py-2 px-4 text-[#fff] outline-1 outline-primary focus-visible:outline dark:bg-[#020D1A] dark:text-current flex items-center"
				>
					<RiDraftFill size={22} className="text-white" />
					<span className="hidden sm:inline text-[0.875rem] ml-[10px] font-medium">
						{" "}
						Save as draft{" "}
					</span>
				</button>
			) : (
				""
			)}

			{isQuizEdit ? (
				<button
					onClick={() => draftFunction()}
					className=" group rounded-full  bg-[#bc5eb3] py-[8px] px-[12px] text-[#fff] outline-1 outline-primary focus-visible:outline dark:bg-[#020D1A] dark:text-current flex items-center"
				>
					<MdDataSaverOn size={24} className="text-white" />
					<span className="hidden sm:inline text-[0.875rem] ml-[10px] font-medium">
						{" "}
						Update as draft{" "}
					</span>
				</button>
			) : (
				""
			)}

			{/* isFormValid */}
			<Modal
				// title={`${
				// 	isFormValid
				// 		? "This Eduquize be played"
				// 		: "This Eduquize can&apos;t be played"
				// }  `}
				title={""}
				open={isModalOpen}
				onClose={() => setIsModalOpen(false)}
				width={600}
			>
				{isFormValid ? (
					<div className="">
						{`${quizresponse?.title}` === "My Quest" ? (
							<>
								<div className="flex items-center justify-between">
									<div className="flex items-center">
										<Image
											className="border border-[#2222] rounded-[10px]"
											src="/images/placeholder.jpg"
											width={120}
											height={120}
											alt=""
										/>
										<div className="ml-[10px]">
											<h4 className="font-bold">
												{" "}
												Please Update Your Quiz Name{" "}
											</h4>
										</div>
									</div>

									<div className="flex flex-col">
										<button className="bg-red-500 text-white px-3 py-1 rounded">
											Fix
										</button>
									</div>
								</div>
							</>
						) : (
							<>
								<div className="flex flex-col justify-center items-center">
									<h3 className="text-[18px] md:text-[25px]  py-[10px] font-bold w-full border border-[#2222] text-center rounded-[10px] mt-[10px]">
										Do you want to{" "}
										{isQuizEdit ? "update" : "save"} this
										Quest?
									</h3>
									<IoSaveSharp className="text-[100px] text-primary my-[30px]" />
								</div>
								<div className="hidden">
									<div className="flex cursor-pointer items-center gap-4 bg-[#f2f1f0] shadow-1 p-3 rounded-md mb-[15px]">
										<FaEye className="text-[30px]" />
										<div className=" flex flex-col ">
											<h5 className="text-[17px] font-bold">
												{" "}
												Preview{" "}
											</h5>
											<p className="text-[#858585]">
												{" "}
												Launch a trial session for this
												MindSpear{" "}
											</p>
										</div>
									</div>
									<div className="flex cursor-pointer items-center gap-4 bg-[#f2f1f0] shadow-1 p-3 rounded-md">
										<SiKdenlive className="text-[30px]" />
										<div className=" flex flex-col ">
											<h5 className="text-[17px] font-bold">
												{" "}
												Host live{" "}
											</h5>
											<p className="text-[#858585]">
												{" "}
												Display from a big screen{" "}
											</p>
										</div>
									</div>
								</div>
							</>
						)}
					</div>
				) : (
					<div className="h-[300px] overflow-y-auto  scrollbar-hidden">
						{validationResults.map((result) => (
							<div
								key={result.id}
								className="shadow mt-[10px] p-[10px]"
							>
								<div className="flex items-center justify-between">
									<div className="flex items-center">
										<Image
											src={getQuestionImage(result)}
											width={70}
											height={70}
											alt=""
										/>
										<div className="ml-[10px]">
											<h4 className="font-medium">
												{result.key.toUpperCase()}
											</h4>
											<h4 className="font-bold">
												{result.messages.length > 0
													? ""
													: result.title}
											</h4>
											{result.messages.length > 0 && (
												<h4 className="text-red-500">
													{result.messages[0]}
												</h4>
											)}
										</div>
									</div>

									<div className="flex flex-col">
										{result.hasError ? (
											<button className="bg-red-500 text-white px-3 py-1 rounded">
												Fix
											</button>
										) : (
											<button className="bg-green-500 text-white px-3 py-1 rounded">
												Done
											</button>
										)}
									</div>
								</div>

								{result.hasError && (
									<div className="flex items-center mt-2">
										<MdError className="text-[30px] mr-[10px] text-[#bc5eb3]" />
										<div>
											{result.messages.map(
												(msg, index) => (
													<p
														key={index}
														className="text-sm text-red-600 font-medium"
													>
														{msg}
													</p>
												)
											)}
										</div>
									</div>
								)}
							</div>
						))}
					</div>
				)}

				<div className="flex justify-center items-center mt-[20px] gap-4 ">
					<button
						onClick={() => setIsModalOpen(false)}
						className="flex text-[.875rem]  items-center bg-[#bc5eb3] text-[#fff] font-bold py-3 px-4 w-full justify-center rounded-md"
					>
						{" "}
						Back to edit{" "}
					</button>

					{isFormValid && quizresponse?.title !== "My Quiz" && (
						<button
							onClick={() => onSubmit()}
							className="flex text-[.875rem]  items-center bg-primary text-[#fff] font-bold py-3 px-4 w-full justify-center rounded-md"
						>
							{" "}
							{isQuizEdit ? "Update" : "Submit"}{" "}
						</button>
					)}
				</div>
			</Modal>
		</div>
	);
}

export default QuestDrafSave;
