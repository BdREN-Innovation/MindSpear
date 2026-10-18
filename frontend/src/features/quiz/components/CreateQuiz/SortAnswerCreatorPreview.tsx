/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Bookmark, Plus, X } from "lucide-react";
import type { RootState } from "@/stores/store";
import {
	updateSortAnswerOption,
	addSortAnswerOption,
	updateQuizImages,
	updateLimitedTimeTitle,
	removeSelectedItem,
	updatePoints,
	removeSortAnswerOption,
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
					{/* One clear list (the old layout put extra answers under a button, with colour pickers). */}
					<div className="rounded-xl border border-[#eee] bg-white p-4">
						<h3 className="text-sm font-bold text-[#222]">Accepted answers</h3>
						<p className="mb-3 text-xs text-[#888]">
							Players type their answer. It counts when it matches any of these; capital letters and
							extra spaces don&apos;t matter.
						</p>
						<ul className="space-y-2">
							{options.map((option, index) => (
								<li key={option.id} className="flex items-center gap-2">
									<span className="w-5 flex-shrink-0 text-center text-xs font-semibold text-[#999]">
										{index + 1}
									</span>
									<input
										type="text"
										aria-label={`Accepted answer ${index + 1}`}
										placeholder={index === 0 ? "e.g. Paris" : "Another accepted answer"}
										value={option.text}
										onChange={(e) =>
											dispatch(
												updateSortAnswerOption({
													id: option.id,
													changes: { text: e.target.value },
												})
											)
										}
										className="min-w-0 flex-1 rounded-lg border border-[#e5e5e5] px-3 py-2 text-[0.875rem] text-black focus:border-primary focus:outline-none"
										maxLength={70}
									/>
									{options.length > 1 && (
										<button
											type="button"
											aria-label={`Remove accepted answer ${index + 1}`}
											title="Remove"
											onClick={() => dispatch(removeSortAnswerOption({ id: option.id }))}
											className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[#999] hover:bg-red-50 hover:text-red-500"
										>
											<X className="h-4 w-4" />
										</button>
									)}
								</li>
							))}
						</ul>
						<div className="mt-3 flex items-center gap-3">
							<button
								type="button"
								onClick={() => dispatch(addSortAnswerOption())}
								disabled={options.length >= 4}
								className="inline-flex items-center gap-1 rounded-lg bg-[#f2f1f0] px-3 py-2 text-sm font-semibold text-[#555] hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#f2f1f0] disabled:hover:text-[#555]"
							>
								<Plus className="h-4 w-4" aria-hidden />
								Add another accepted answer
							</button>
							{options.length >= 4 && <span className="text-xs text-[#999]">Up to 4 accepted answers.</span>}
						</div>
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

export default SortAnswerCreatorPreview;
