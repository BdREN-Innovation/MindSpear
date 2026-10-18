"use client";

import React, { useState } from "react";
import { IoIosCheckmark } from "react-icons/io";
import { Bookmark } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/stores/store";
import {
	toggleOptionSelection,
	updateOptionColor,
	updateTrueFalseOption,
	TrueFalseOption,
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
const TrueFalseComponend: React.FC<QuizCreatorPreviewProps> = ({ id }) => {
	const dispatch = useDispatch();
	const { selectedItem } = useSelector((state: RootState) => state.quiz);
	const multypleselectedItem = useSelector(
		(state: RootState) => state.quiz.multypleselectedItem
	);
	const currentItem = multypleselectedItem.find((item) => item.id === id);
	// Hooks before the early return: returning first changed the hook count between renders
	// ("Rendered more hooks than during the previous render").
	const [showAddToBankModal, setShowAddToBankModal] = useState(false);
	if (!currentItem) return null;
	const trueFalseItems = {
		...currentItem,
		options: currentItem.options.filter(
			(option) => option.text === "True" || option.text === "False"
		),
	};

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
	console.log(questionsRemove);


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

					<div className="grid gap-4 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 auto-rows-fr">
						{(trueFalseItems?.options as TrueFalseOption[])?.map(
							(option) => (
								<div
									key={option.id}
									onClick={() =>
										dispatch(
											toggleOptionSelection({
												quizId: id,
												optionId: option.id,
												isMultipleSelection: false,
											})
										)
									}
									className={`px-4 py-6 border rounded shadow flex flex-col justify-between cursor-pointer relative  ${option.isSelected
										? "bg-[#bdffd8]"
										: "bg-white"
										}`}
								>
									<div
										className="w-full h-[5px] rounded-full absolute top-0 left-0"
										style={{
											backgroundColor: option.color,
										}}
									></div>

									<div
										className="absolute top-6 right-2 w-[35px] h-[35px] border-4 border-[#abccb9] cursor-pointer rounded-full flex items-center justify-center"
										style={{
											backgroundColor: option.isSelected
												? "#51d683"
												: "#fff",
											borderColor: option.isSelected
												? "#fff"
												: option.color,
										}}
									>
										{option.isSelected && (
											<IoIosCheckmark
												size={50}
												className="text-white"
											/>
										)}
									</div>

									<div className="flex items-center gap-4 mt-3">
										<input
											type="color"
											value={option.color}
											onChange={(e) => {
												e.stopPropagation();
												dispatch(
													updateOptionColor({
														quizId: id,
														optionId: option.id,
														color: e.target.value,
													})
												);
											}}
											onClick={() => {
												dispatch(
													toggleOptionSelection({
														quizId: id,
														optionId: option.id,
														isMultipleSelection:
															false,
													})
												);
												dispatch(
													updateTrueFalseOption({
														quizId: id,
														optionId: option.id,
														type: "isSelected",
														value: true,
													})
												);
											}}
											className="w-6 h-6"
										/>
										<span className="text-[0.875rem] font-medium">
											{option.text}
										</span>
									</div>
								</div>
							)
						)}
					</div>
				</div>

				<div className="md:col-span-3 shadow-md p-3 bg-[#fff] rounded-[15px] min-h-screen">
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
							{ label: "Standard (1 point)", value: "1" },
							{ label: "Double (2 points)", value: "2" },
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

export default TrueFalseComponend;
