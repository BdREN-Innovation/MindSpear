"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { IoIosCheckmark } from "react-icons/io";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/stores/store";
import ConfirmDialog from "@/utils/showConfirmDialog";

// import {
//   toggleSelectionMode,
// } from '@/services/redux/features/optionsSlice';
import {
	updateOptionText,
	updateOptionColor,
	toggleOptionSelection,
	addQuizOption,
	removeQuizOption,
	toggleSwitchSelectionMode,
	updateLimitedTimeTitle,
	updateQuizImages,
	removeSelectedItem,
	updatePoints,
} from "@/features/quiz/store/quizItems/quizSlice";
import StylableInput from "@/lib/StylableInput";
import StylableInputFile from "@/lib/StylableInputFile";
import { Select } from "@/components/FormElements/select";
import { FaRegClock } from "react-icons/fa";
import { MdStars } from "react-icons/md";
import { IoMdCloseCircle } from "react-icons/io";
import { Bookmark } from "lucide-react";
import axiosInstance from "@/utils/axiosInstance";
import { AxiosError } from "axios";
import { VscActivateBreakpoints } from "react-icons/vsc";
import AddQuestionToBankModal from "@/features/dashboard/question-bank/components/QuestionBank/AddQuestionToBankModal";
import { toast } from "react-toastify";

interface QuizCreatorPreviewProps {
	id: string;
}

const FillInTheBlanksCreatorPreview: React.FC<QuizCreatorPreviewProps> = ({
	id,
}) => {
	const dispatch = useDispatch();
	const { selectedItem } = useSelector((state: RootState) => state.quiz);
	const isMultipleSelection = selectedItem?.isMultipleSelection ?? false;

	console.log(isMultipleSelection, "isMultipleSelection");

	const multypleselectedItem = useSelector(
		(state: RootState) => state.quiz.multypleselectedItem
	);
	const currentItem = multypleselectedItem.find((item) => item.id === id);

	const allOptions = currentItem?.options || [];
	const [showAddToBankModal, setShowAddToBankModal] = useState(false);

	const handleAddToQuestionBank = () => {
		setShowAddToBankModal(true);
	};

	// Get the current question text for the modal
	const currentQuestionText = selectedItem?.title || "Question";

	const handleAddOption = () => {
		dispatch(addQuizOption());
	};

	const handleRemoveOption = () => {
		dispatch(removeQuizOption());
	};

	const [editingId, setEditingId] = useState<string | null>(null);
	const [editText, setEditText] = useState("");
	const editRef = useRef<HTMLDivElement | null>(null);

	const handleOptionClick = (option: { id: string; text: string }) => {
		setEditingId(option.id);
		setEditText(option.text);
	};

	const saveTextChange = useCallback(
		(optionId: string) => {
			// Also when emptied: clearing an answer's text used to be ignored.
			dispatch(
				updateOptionText({
					quizId: id,
					optionId,
					text: editText.trim(),
				})
			);
			setEditingId(null);
			setEditText("");
		},
		[dispatch, editText, id]
	);

	const handleKeyDown = (
		e: React.KeyboardEvent<HTMLInputElement>,
		id: string
	) => {
		if (e.key === "Enter") {
			saveTextChange(id);
		}
	};

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				editingId &&
				editRef.current &&
				!editRef.current.contains(event.target as Node)
			) {
				saveTextChange(editingId);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [editingId, editText, saveTextChange]);

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
			<div className="grid grid-cols-1 md:grid-cols-12 gap-5">
				<div className="md:col-span-9 p-4 bg-[#fff] rounded-[15px]">
					<StylableInput />
					{/* How to make the blank was never explained. */}
					<p className="mb-3 mt-1 text-xs text-[#888]">
						Type four underscores <span className="rounded bg-[#f2f2f2] px-1 font-mono">____</span> where the
						missing word goes, e.g. &ldquo;The capital of Japan is ____.&rdquo; Then add the answers and mark
						the right one.
					</p>
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
						{allOptions.map((option) => (
							<div
								key={option.id}
								className={`px-4 py-6 border rounded shadow flex flex-col justify-between cursor-pointer relative ${option.isSelected
									? "bg-[#bdffd8]"
									: "bg-white"
									}`}
								onClick={() => handleOptionClick(option)}
							>
								<div
									className="w-full h-[5px] rounded-full absolute top-0 left-0"
									style={{ backgroundColor: option.color }}
								></div>

								{(editingId === option.id
									? editText.trim()
									: option.text?.trim()) && (
										<div className="absolute right-[10px] z-999">
											<label
												className={`relative border-4 font-bold w-[35px] h-[35px] rounded-full cursor-pointer flex items-center justify-center`}
												onClick={(e) => e.stopPropagation()}
												style={{
													backgroundColor:
														option.isSelected
															? "#51d683"
															: "#fff",
													borderColor: option.isSelected
														? "#fff"
														: option.color,
												}}
											>
												{option.isSelected && (
													<IoIosCheckmark
														size={20}
														className="text-white ml-1"
													/>
												)}
												<input
													type="checkbox"
													checked={!!option.isSelected}
													onChange={(e) => {
														e.stopPropagation();
														dispatch(
															toggleOptionSelection({
																quizId: id,
																optionId: option.id,
																isMultipleSelection,
															})
														);
													}}
													className="absolute opacity-0 w-0 h-0 peer"
												/>
											</label>
										</div>
									)}

								{editingId === option.id ? (
									<div
										className="relative flex items-center gap-3"
										ref={editRef}
									>
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
											className="h-5 w-5 cursor-pointer absolute left-0 top-2 border-[#fff]"
										/>
										<input
											type="text"
											placeholder={option?.placeholder}
											value={editText}
											onChange={(e) =>
												setEditText(e.target.value)
											}
											onKeyDown={(e) =>
												handleKeyDown(e, option.id)
											}
											onClick={(e) => e.stopPropagation()}
											className={`${option.isSelected
												? "bg-[#bdffd8]"
												: "bg-white"
												} text-[.875rem] w-full p-2 rounded pl-8 text-black  focus:ring-[#fff]  focus:outline-none`}
											autoFocus
											maxLength={70}
										/>
									</div>
								) : (
									<p className="text-[0.875rem] pt-[10px] text-[#111111] font-medium">
										{option.text?.trim()
											? option.text
											: option.placeholder}
									</p>
								)}
							</div>
						))}
					</div>

					<div className="flex justify-center items-center gap-4">
						{allOptions.length < 6 && (
							<div className="flex justify-center items-center gap-4 mt-4">
								<button
									onClick={handleAddOption}
									className="py-[10px] px-[20px] bg-[#f2f1f0] rounded-[10px] font-bold hover:bg-primary hover:text-white"
								>
									<div className="flex items-center gap-3">
										<MdStars size={20} /> Add more answer
									</div>
								</button>
							</div>
						)}

						{allOptions.length === 5 || allOptions.length === 6 ? (
							<div className="flex justify-center items-center gap-4 mt-4">
								<button
									onClick={handleRemoveOption}
									className="py-[10px] px-[20px] bg-red-100 text-red-600 rounded-[10px] font-bold hover:bg-red-500 hover:text-white"
								>
									<div className="flex items-center gap-3">
										<IoMdCloseCircle size={20} /> Remove
										last answer
									</div>
								</button>
							</div>
						) : (
							""
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

					<div className="mb-6 hidden">
						<label className="flex items-center cursor-pointer justify-between">
							<div className="text-gray-700 font-medium text-[0.875rem]">
								{isMultipleSelection
									? "Select Multiple Answer"
									: "Select Single Answer"}
							</div>

							<div className="relative">
								<input
									type="checkbox"
									className="sr-only"
									checked={!!isMultipleSelection}
									onChange={() =>
										dispatch(toggleSwitchSelectionMode())
									}
								/>
								<div
									className={`block w-14 h-8 rounded-full ${isMultipleSelection
										? "bg-primary"
										: "bg-gray-400"
										}`}
								></div>
								<div
									className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition ${isMultipleSelection
										? "transform translate-x-6"
										: ""
										}`}
								></div>
							</div>
						</label>
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
							{ label: "1  Minute ", value: "60" },
							{ label: "1  Min 30 Sec", value: "90" },
							{ label: "2  Minute ", value: "120" },
							{ label: "2  Min 30 Sec", value: "150" },
							{ label: "3  Minute", value: "180" },
							{ label: "3  Min 30 Sec", value: "210" },
							{ label: "4  Minute", value: "240" },
							{ label: "4  Min 30 Sec", value: "270" },
							{ label: "5  Minute", value: "300" },
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
						value={
							selectedItem?.points !== undefined ||
								selectedItem?.points !== null
								? `${selectedItem?.points}`
								: "1"
						}
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

export default FillInTheBlanksCreatorPreview;
