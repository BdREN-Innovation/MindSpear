/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Bookmark } from "lucide-react";
import type { RootState } from "@/stores/store";
import {
	updateSortAnswerOption,
	addSortAnswerOption,
	updateQuizImages,
	updateLimitedTimeTitle,
	removeSelectedItem,
	updatePoints,
} from "@/features/quiz/store/quizItems/quizSlice";

import StylableInput from "@/lib/StylableInput";
import StylableInputFile from "@/lib/StylableInputFile";
import { Select } from "@/components/FormElements/select";
import { FaRegClock } from "react-icons/fa";
import axiosInstance from "@/utils/axiosInstance";
import ConfirmDialog from "@/utils/showConfirmDialog";
import { AxiosError } from "axios";
import { VscActivateBreakpoints } from "react-icons/vsc";
import AddQuestionToBankModal from "@/features/dashboard/question-bank/components/QuestionBank/AddQuestionToBankModal";
import { toast } from "react-toastify";

interface QuizCreatorPreviewProps {
	id: string;
}
const SortAnswerCreatorPreview: React.FC<QuizCreatorPreviewProps> = ({
	id,
}) => {
	const dispatch = useDispatch();
	const { selectedItem } = useSelector((state: RootState) => state.quiz);
	const multypleselectedItem = useSelector(
		(state: RootState) => state.quiz.multypleselectedItem
	);
	const currentItem = multypleselectedItem.find((item) => item.id === id);
	const options = Array.isArray(currentItem?.options)
		? currentItem.options
		: [];
	const [showAddToBankModal, setShowAddToBankModal] = useState(false);

	const handleAddToQuestionBank = () => {
		setShowAddToBankModal(true);
	};

	// Get the current question text for the modal
	const currentQuestionText = selectedItem?.title || "Question";

	const questionsRemove = async () => {
		await ConfirmDialog.show(
			{
				title: "Are you sure you want to delete this questions?",
				text: "This action cannot be undone.",
				confirmButtonText: "Yes, delete it!",
			},
			async () => {
				try {
					const response = await axiosInstance.delete(
						`/quiz/questions/delete/${currentItem?.id}`
					);
					if (currentItem) {
						dispatch(removeSelectedItem(currentItem));
					}
					console.log(response, "transformedData");
				} catch (error) {
					const axiosError = error as AxiosError<{
						message?: string;
					}>;
					if (axiosError.response) {
						console.error(
							"Error verifying token:",
							axiosError.response.data
						);
						toast.error(
							`Error: ${axiosError.response.data?.message ||
							"Verification failed."
							}`
						);
					} else {
						console.error("Unexpected error:", axiosError.message);
						toast.error("Unexpected error occurred. Please try again.");
					}
				} finally {
				}
			}
		);
	};

	return (
		<div className="h-screen overflow-auto scrollbar-hidden">
			<div className="grid grid-cols-1 md:grid-cols-12 gap-4">
				<div className="md:col-span-9 p-4 bg-[#fff] rounded-[15px]">
					<StylableInput />
					<div className="w-[50%] m-auto shadow-md">
						<StylableInputFile
							initialImageUrl={currentItem?.source_content_url}
							initialImageId={currentItem?.source_image_id}
							onImageSelected={(image) =>
								dispatch(
									updateQuizImages({
										id: id,
										imageUrl: image.path,
										imageId: image.id,
									})
								)
							}
							onImageRemove={() =>
								// Only detach it from the question; the image stays in My Files.
								dispatch(
									updateQuizImages({
										id: id,
										imageUrl: undefined,
										imageId: undefined,
									})
								)
							}
						/>
					</div>
					{options?.length >= 1 && (
						<div
							key={options[0].color}
							className={`mb-4 px-4 py-6 border rounded shadow flex flex-col justify-between cursor-pointer relative bg-white`}
						>
							<div
								className="w-full h-[5px] rounded-full absolute top-0 left-0"
								style={{ backgroundColor: options[0].color }}
							></div>
							<input
								type="color"
								value={options[0].color}
								onChange={(e) =>
									dispatch(
										updateSortAnswerOption({
											id: options[0].id,
											changes: { color: e.target.value },
										})
									)
								}
								className="h-5 text-[0.875rem] w-5 cursor-pointer absolute left-2 top-8 border border-white"
							/>
							<input
								type="text"
								placeholder={options[0].placeholder}
								value={options[0].text}
								onChange={(e) =>
									dispatch(
										updateSortAnswerOption({
											id: options[0].id,
											changes: { text: e.target.value },
										})
									)
								}
								onClick={(e) => e.stopPropagation()}
								className={`w-full p-2 rounded pl-7 text-black ${options[0].isSelected
									? "bg-white"
									: "bg-white"
									}  focus:ring-[#fff] focus:outline-none text-[0.875rem]`}
								maxLength={70}
							/>
						</div>
					)}

					<div className="w-full flex justify-center items-center">
						<button
							onClick={() => dispatch(addSortAnswerOption())}
							disabled={options.length >= 4}
							className="py-[10px] px-[20px] bg-[#f2f1f0] mb-[15px] rounded-[10px] font-bold text-[#6b7280] hover:bg-primary hover:text-[#fff] disabled:opacity-50"
						>
							{options.length < 2
								? "Add accepted answers"
								: `Other accepted answers ${options.length === 4
									? ""
									: `(${4 - options.length})`
								} `}
						</button>
					</div>

					<div className="grid grid-cols-3 gap-4">
						{options.slice(1).map((option) => (
							<div
								key={option.id}
								className={`px-4 py-6 border rounded shadow flex flex-col justify-between cursor-pointer relative bg-white`}
							>
								<div
									className="w-full h-[5px] rounded-full absolute top-0 left-0"
									style={{ backgroundColor: option.color }}
								></div>

								<input
									type="color"
									value={option.color}
									onChange={(e) =>
										dispatch(
											updateSortAnswerOption({
												id: option.id,
												changes: {
													color: e.target.value,
												},
											})
										)
									}
									className="h-5 w-5 cursor-pointer absolute left-3 top-8 border border-white"
								/>
								<input
									type="text"
									placeholder={option.placeholder}
									value={option.text}
									onChange={(e) =>
										dispatch(
											updateSortAnswerOption({
												id: option.id, // <-- use current option.id here
												changes: {
													text: e.target.value,
												},
											})
										)
									}
									onClick={(e) => e.stopPropagation()}
									className={`w-full p-2 rounded pl-7 text-black ${option.isSelected
										? "bg-white"
										: "bg-white"
										}  focus:ring-[#fff] focus:outline-none text-[0.875rem]`}
									maxLength={70}
								/>
							</div>
						))}
					</div>
				</div>

				<div className="md:col-span-3 shadow-md p-3 bg-[#fff] rounded-[15px] min-h-screen ">
					<div className="flex gap-3 mb-[30px]">
						<button
							onClick={handleAddToQuestionBank}
							className="flex text-[.875rem] items-center bg-[#f2f1f0] hover:text-primary text-[#222] py-2 px-4 w-full justify-center rounded-md font-medium gap-2"
						>
							<Bookmark className="h-4 w-4" />
							Add to Question Bank
						</button>
					</div>

					<Select
						className="mt-[15px] !text-[0.875rem]"
						label="Time limit"
						items={[
							{ label: "5 Seconds", value: "5" },
							{ label: "10 Seconds", value: "10" },
							{ label: "20 Seconds", value: "20" },
							{ label: "30 Seconds", value: "30" },
							{ label: "45 Seconds", value: "45" },
							{ label: "60 Seconds", value: "60" },
						]}
						value={`${selectedItem?.timeLimit}` || "30"}
						prefixIcon={<FaRegClock />}
						onChange={(value) =>
							dispatch(
								updateLimitedTimeTitle({
									id: id,
									timeLimit: value,
								})
							)
						}
					/>

					<Select
						className="mt-[15px] !text-[0.875rem]"
						label="Points"
						items={[
							{ label: "Single Points", value: "1" },
							{ label: "Multiple Points", value: "2" },
						]}
						prefixIcon={<VscActivateBreakpoints />}
						onChange={(e) =>
							dispatch(
								updatePoints({
									id: id,
									points: e,
								})
							)
						}
						value={selectedItem?.points !== undefined || selectedItem?.points !== null ? `${selectedItem?.points}` : "1"}
					/>
				</div>
			</div>

			{showAddToBankModal && currentItem && (
				<AddQuestionToBankModal
					open={showAddToBankModal}
					onClose={() => setShowAddToBankModal(false)}
					questionId={currentItem.id}
					questionText={currentQuestionText}
					questionData={currentItem}
				/>
			)}
		</div>
	);
};

export default SortAnswerCreatorPreview;
