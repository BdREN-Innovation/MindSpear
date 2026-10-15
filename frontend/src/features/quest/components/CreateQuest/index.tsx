"use client";

import React, { useState } from "react";
import classNames from "classnames";
import Image from "next/image";
import axiosInstance from "@/utils/axiosInstance";
import { Quiz } from "@/types/types";
import { useDispatch } from "react-redux";
import { setQuest } from "@/features/quest/store/questInformationSlice";
import {
	addNewQuestItem,
	setSelectedItem,
} from "@/features/quiz/store/quizItems/quizSlice";
import { AxiosError } from "axios";
import { useRouter } from "next/navigation";
import moment from "@/lib/dayjs";
import { toast } from "react-toastify";
import { Sparkles } from "lucide-react";
import { DocumentToQuestionsModal } from "@/features/ai-generate/components/DocumentToQuestionsWizard";
import type { GeneratedContext } from "@/features/ai-generate/components/DocumentToQuestionsWizard";
import { toQuestTasks } from "@/features/ai-generate/mappers";
import type { GeneratedFor } from "@/features/ai-generate/types";

interface QuizApiResponse {
	data: Quiz;
}

function CreateQuest() {
	const currentTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const dispatch = useDispatch();
	const router = useRouter();
	const [aiOpen, setAiOpen] = useState(false);

	/** New quest from AI-generated tasks; opens it in the editor, which loads tasks from the server. */
	const createFromDocument = async (
		result: GeneratedFor<"quest">,
		{ options }: GeneratedContext
	) => {
		const endTime = new Date(
			new Date().setFullYear(new Date().getFullYear() + 5)
		);
		try {
			const questResponse = await axiosInstance.post("/quests/store", {
				title: options.topic.slice(0, 255) || "Untitled Quest",
				timezone: `${currentTimeZone}`,
				visibility: "public",
				quiztime_mode: true,
				start_datetime: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
				end_datetime: moment(endTime)
					.add(24, "hours")
					.format("YYYY-MM-DD HH:mm:ss"),
			});
			const questId = questResponse?.data?.data?.quest?.id;
			if (!questId) throw new Error("Quest creation failed: missing quest ID.");

			await axiosInstance.post(
				"/quest-tasks/store-multiple",
				{ tasks: toQuestTasks(result.questions, questId) },
				{ timeout: 60_000 }
			);
			toast.success(`Quest created with ${result.questions.length} tasks.`);
			router.push(`/quest/edit/${questId}`);
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;
			throw new Error(
				axiosError.response?.data?.message ||
					axiosError.message ||
					"The tasks were generated but couldn't be saved. Please try again."
			);
		}
	};

	const handleItemClick = async (quiztypename: string, status: string) => {
		console.log(quiztypename, status);
		const endTime = new Date(
			new Date().setFullYear(new Date().getFullYear() + 5)
		);

		try {
			const quizResponse = await axiosInstance.post("/quests/store", {
				title: "Untitled Quest",
				timezone: `${currentTimeZone}`,
				visibility: "public",
				quiztime_mode: true,
				start_datetime: moment(new Date()).format(
					"YYYY-MM-DD HH:mm:ss"
				),
				end_datetime: moment(endTime)
					.add(24, "hours")
					.format("YYYY-MM-DD HH:mm:ss"),
			});

			console.log(
				quizResponse,
				"quizResponsequizResponsequizResponsequizResponse"
			);

			const response = await axiosInstance.get<QuizApiResponse>(
				`/quests/show/${quizResponse?.data?.data?.quest?.id}`
			);
			const quizDataWithType = {
				...response?.data?.data,
				qseaneType: `${quiztypename}`,
			};
			dispatch(setQuest(quizDataWithType));

			const quizId = quizResponse?.data?.data?.quest?.id;
			if (!quizId) {
				throw new Error("Quiz creation failed: missing quiz ID.");
			}

			const responseQuestTasks = await axiosInstance.post(
				`/quest-tasks/store`,
				{
					quest_id: `${quizId}`,
					title: "Untitled question",
					task_type: `qsenchoice`,
					visibility: "public",
					serial_number: 1,
				}
			);

			// addNewQuestItem({
			// 		key: "qsenchoice",
			// 		quiz_id: `${quizId}`,
			// 		title: "",
			// 		options: [],
			// 		maxOptions: 0,
			// 		minOptions: 0,
			// 		allowDuplicates: false,
			// 		isMultipleSelection: false,
			// 		timeLimit: "",
			// 		position: 1,
			// 		id: responseQuestTasks.data.data.questTask.id,
			// 	})

			dispatch(
				addNewQuestItem({
					key: "qsenchoice",
					quiz_id: `${quizId}`,
					title: "Untitled question",
					options: [],
					maxOptions: 0,
					minOptions: 0,
					allowDuplicates: false,
					isMultipleSelection: false,
					timeLimit: "",
					contant_title: "",
					image_url: "",
					layout_id: "",
					position: 1,
					id: responseQuestTasks.data.data.questTask.id,
				})
			);

			dispatch(
				setSelectedItem({
					key: "qsenchoice",
					id: `${quizId}`,
					title: "Untitled question",
					options: [],
					maxOptions: 0,
					minOptions: 0,
					allowDuplicates: false,
					isMultipleSelection: false,
					timeLimit: "",
				})
			);

			// const questionResponse = await axiosInstance.post(
			// 	`/quest-tasks/store`,
			// 	{
			// 		quest_id: quizId,
			// 		title: ".",
			// 		task_type: "qsenchoice",
			// 		serial_number: "1",
			// 	}
			// );

			// const questionId = questionResponse?.data?.data?.questTask?.id;

			// dispatch(
			// 	addNewQuestItem({
			// 		key: "qsenchoice",
			// 		id: `${questionId}`,
			// 		quiz_id: `${quizId}`,
			// 		title: "",
			// 		options: [],
			// 		maxOptions: 0,
			// 		minOptions: 0,
			// 		allowDuplicates: false,
			// 		isMultipleSelection: false,
			// 		timeLimit: "",
			// 		quizTypeName: quiztypename,
			// 		quizTypeModalStatus: status,
			// 	})
			// );

			router.push(`/quest/create/${quizId}`);
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;

			if (axiosError.response) {
				console.error("API error:", axiosError.response.data);
				toast.error(
					`Error: ${axiosError.response.data?.message || "Request failed."
					}`
				);
			} else {
				console.error("Unexpected error:", axiosError.message);
				toast.error("Unexpected error occurred. Please try again.");
			}
		} finally {
		}
	};

	return (
		<div>
			<div className="flex-[0_1_calc(33.333%_-_30px)] cursor-pointer mb-[30px] overflow-hidden rounded-[28px]">
				{/* <Link
					href="/quest/create"
				> */}

				<div
					onClick={() => handleItemClick("blank", "false")}
					className="group relative block overflow-hidden bg-[#f3f3fe] px-5 py-[30px] transition-all duration-300 ease-in-out hover:no-underline"
				>
					{/* Circle background with lower z-index */}
					<div
						className={classNames(
							"absolute top-[-75px] right-[-75px] h-[128px] w-[128px] rounded-full",
							"bg-secondary",
							"group-hover:scale-[10]",
							"transition-transform duration-500 ease-in-out",
							"z-0"
						)}
					></div>

					{/* Title */}
					<div className="relative z-10 text-[0.875rem] font-bold text-[#222] group-hover:text-white transition-colors duration-500 ease-in-out">
						New Quest
					</div>

					{/* Image with higher z-index and transparent background */}
					<div className="relative z-20 flex items-center justify-center">
						<Image
							src="/images/icons/quest.svg"
							alt="quest"
							width={150}
							height={60}
							className="transition-all duration-500 ease-in-out"
						/>
					</div>

					{/* Click Here */}
					<div className="relative z-10 text-[14px] text-[#f79a46] flex items-center justify-center">
						<span className="pl-1 font-bold text-center group-hover:text-white transition-colors duration-500 ease-in-out">
							Click Here
						</span>
					</div>

					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							setAiOpen(true);
						}}
						className="relative z-30 mx-auto mt-3 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-secondary shadow-sm transition hover:bg-white hover:shadow"
					>
						<Sparkles className="h-3.5 w-3.5" aria-hidden />
						Or generate from a file
					</button>
				</div>
			</div>

			<DocumentToQuestionsModal
				open={aiOpen}
				onClose={() => setAiOpen(false)}
				title="Generate a quest from a document"
				target="quest"
				generateLabel="Generate quest"
				onGenerated={createFromDocument}
			/>
		</div>
	);
}

export default CreateQuest;
