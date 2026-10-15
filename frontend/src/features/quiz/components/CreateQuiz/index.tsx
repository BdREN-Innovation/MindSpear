"use client";
import React, { useState } from "react";
import { Modal } from "@/components/ui";
import { FaPlus } from "react-icons/fa6";
import { ImFilesEmpty } from "react-icons/im";
import classNames from "classnames";
import {
	addNewItem,
	clearMultipleSelectedItems,
} from "@/features/quiz/store/quizItems/quizSlice";
import { clearQuiz, setQuiz } from "@/features/quiz/store/quizInformationSlice";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/stores/store";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Quiz } from "@/types/types";
import { toast } from "react-toastify";
interface QuizApiResponse {
	data: Quiz;
}

interface MenuItem {
	key: string;
	id: string;
	quiz_id: string;
}

function CreateQuiz() {
	const router = useRouter();
	const [isModalOpen, setIsModalOpen] = useState(false);
	const currentTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	const multypleselectedItem = useSelector(
		(state: RootState) => state.quiz.multypleselectedItem
	) as MenuItem[];
	// console.log(multypleselectedItem, "multypleselectedItem");

	const [isSubmitting, setIsSubmitting] = useState(false);

	const dispatch = useDispatch();
	const handleItemClick = async (quiztypename: string, status: string) => {
		console.log(quiztypename, status);

		try {
			setIsSubmitting(true);

			const quizResponse = await axiosInstance.post("/quizes/store", {
				title: "My Quiz",
				timezone: `${currentTimeZone}`,
				visibility: "public",
				quiztime_mode: true,
			});

			const response = await axiosInstance.get<QuizApiResponse>(
				`/quizes/show/${quizResponse?.data?.data?.quiz?.id}`
			);
			const quizDataWithType = {
				...response?.data?.data,
				qseaneType: `${quiztypename}`,
			};
			dispatch(setQuiz(quizDataWithType));

			const quizId = quizResponse?.data?.data?.quiz?.id;
			if (!quizId) {
				throw new Error("Quiz creation failed: missing quiz ID.");
			}

			if (quiztypename !== "pdf") {
				const questionResponse = await axiosInstance.post(
					`/quiz/questions/store`,
					{
						quiz_id: quizId,
						question_text: ".",
						visibility: "public",
					}
				);

				const questionId = questionResponse?.data?.data?.question?.id;
				if (!questionId) {
					throw new Error(
						"Question creation failed: missing question ID."
					);
				}

				dispatch(
					addNewItem({
						key: "quiz",
						id: `${questionId}`,
						quiz_id: `${quizId}`,
						title: "",
						options: [
							{
								id: "1",
								text: "",
								placeholder: "Add answer 1",
								color: "#F79945",
								isSelected: false,
							},
							{
								id: "2",
								text: "",
								placeholder: "Add answer 2",
								color: "#BC5EB3",
								isSelected: false,
							},
							{
								id: "3",
								text: "",
								placeholder: "Add answer 3 (optional)",
								color: "#5769e7",
								isSelected: false,
							},
							{
								id: "4",
								text: "",
								placeholder: "Add answer 4 (optional)",
								color: "#89c6c7",
								isSelected: false,
							},
						],
						maxOptions: 0,
						minOptions: 0,
						allowDuplicates: false,
						isMultipleSelection: false,
						timeLimit: "",
						quizTypeName: quiztypename,
						quizTypeModalStatus: status,
					})
				);
			}

			router.push(`/quiz-creator/${quizId}`);
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;

			if (axiosError.response) {
				console.error("API error:", axiosError.response.data);
				toast.error(
					`Error: ${
						axiosError.response.data?.message || "Request failed."
					}`
				);
			} else {
				console.error("Unexpected error:", axiosError.message);
				toast.error("Unexpected error occurred. Please try again.");
			}
		} finally {
			setIsSubmitting(false);
		}
	};
	// console.log(isSubmitting, "isSubmitting");

	return (
		<div>
			<div
				onClick={() => {
					dispatch(clearMultipleSelectedItems());
					dispatch(clearQuiz());

					setIsModalOpen(true);
				}}
				className="flex-[0_1_calc(33.333%_-_30px)] cursor-pointer mb-[30px] overflow-hidden rounded-[28px]"
			>
				<div className="group relative block overflow-hidden bg-[#f3f3fe] px-5 py-[30px] transition-all duration-300 ease-in-out hover:no-underline">
					<div
						className={classNames(
							"absolute top-[-75px] right-[-75px] h-[128px] w-[128px] rounded-full transition-transform duration-500 ease-in-out",
							"bg-[#ed3a76]",
							"group-hover:scale-[10]"
						)}
					></div>

					<div className="relative z-10 overflow-hidden text-[0.875rem] font-bold text-[#222] transition-colors duration-500 ease-in-out group-hover:text-white">
						New Quiz
					</div>
					<div className="relative z-20 flex items-center justify-center">
						<Image
							src="/images/icons/quiz.svg"
							alt="quest"
							width={150}
							height={60}
							className="text-[#f79a46] transition-colors duration-500 ease-in-out group-hover:text-white"
						/>
					</div>
					<div className="relative z-10 text-[14px] text-white flex items-center justify-center">
						{/* <Image
							src="/images/icons/quiz.svg"
							alt="quest"
							width={30}
							height={30}
							className="text-[#f79a46] transition-colors duration-500 ease-in-out group-hover:text-white"
						/> */}
						<span className="pl-1 font-bold text-[#ed3a76] transition-colors duration-500 ease-in-out group-hover:text-white">
							Click Here
						</span>
					</div>
				</div>
			</div>

			<Modal
				title="Create a new quiz"
				open={isModalOpen}
				onClose={() => setIsModalOpen(false)}
			>
				<div className="py-4 px-4 sm:px-6 lg:px-8">
					<div className="">
						<h3 className="text-[1rem] sm:text-[1rem] font-semibold pb-2">
							Quizzes
						</h3>
						<p className="w-full sm:w-full lg:w-full text-[.875rem] sm:text-[.875rem] pb-5">
							{`Craft engaging quizzes to boost active
							participation, enhance knowledge retention, and
							elevate your educational impact.`}
						</p>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
						<div
							onClick={() => handleItemClick("blank", "false")}
							className="pt-4 group"
						>
							<div className="transition-all duration-500 ease-in-out group-hover:!border-[#222] border border-[#2222] p-12 sm:p-16 flex items-center justify-center rounded-[10px] cursor-pointer">
								<FaPlus
									className="transition-all duration-500 ease-in-out group-hover:!text-[#222]"
									size={40}
									color="#2222"
								/>
							</div>
							<h3 className="text-[.875rem] pt-2 font-semibold">
								Empty Slate
							</h3>
							<p className="text-[.875rem] text-[#7b7b7b]">
								Create your own quiz from scratch.
							</p>
						</div>

						<div
							onClick={() => handleItemClick("pdf", "true")}
							className="pt-4 group"
						>
							<div className="bg-[#fda148] transition-all duration-500 ease-in-out group-hover:!border-[#222] relative border border-[#2222] p-12 sm:p-16 flex items-center justify-center rounded-[10px] cursor-pointer">
								<div className="absolute hidden lg:block right-0 top-0 py-[85px] bg-[#fdb774] w-[120px] sm:w-[150px] rounded-tl-[100px] rounded-tr-[10px] rounded-bl-[100px] rounded-br-[10px]"></div>
								<ImFilesEmpty
									className="relative transition-all duration-500 ease-in-out group-hover:!text-[#222] text-[#a35f1d]"
									size={40}
								/>
							</div>
							<h3 className="text-[.875rem] pt-2 font-semibold">
								AI Generate (From a File)
							</h3>

							<p className="text-[.875rem] text-[#7b7b7b]">
								Use a PDF, Word, PowerPoint or text file from My Files, or upload a new one.
							</p>
						</div>

						<div className="pt-4 group">
							<div className="bg-[#BC5EB3] transition-all duration-500 ease-in-out group-hover:!border-[#222] relative border border-[#2222] p-12 sm:p-16 flex items-center justify-center rounded-[10px] cursor-pointer">
								<div className="absolute hidden lg:block right-0 top-0 py-[85px] bg-[#f590eb] w-[120px] sm:w-[150px] rounded-tl-[100px] rounded-tr-[10px] rounded-bl-[100px] rounded-br-[10px]"></div>
								<ImFilesEmpty
									className="relative transition-all duration-500 ease-in-out group-hover:!text-[#222] text-[#743e6e]"
									size={40}
								/>
							</div>
							<h3 className="text-[.875rem] pt-2 font-semibold">
								AI Generate (From URL / Prompts)
							</h3>
							<p className="text-[.875rem] text-[#7b7b7b]">
								Let AI build quizzes from your chosen topics.
							</p>
						</div>
					</div>
				</div>
			</Modal>
		</div>
	);
}

export default CreateQuiz;
