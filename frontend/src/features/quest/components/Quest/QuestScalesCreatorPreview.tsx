/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
// import { RootState } from "@/services/redux/store";
import {
	addQuestOption,
	removeQuizOption,
	updateLimitedTimeTitle,
	scalesMaxMinData,
	removeSelectedItem,
	// updatePoints,
	reorderOptions,
} from "@/features/quiz/store/quizItems/quizSlice";
import StylableInput from "@/lib/StylableInput";
import { FaRegClock } from "react-icons/fa";
// import { VscActivateBreakpoints } from "react-icons/vsc";
import axiosInstance from "@/utils/axiosInstance";
import ConfirmDialog from "@/utils/showConfirmDialog";
import OptionList from "./OptionList";

import dynamic from "next/dynamic";
import { CustomSelect } from "@/components/FormElements/CustomSelect";
import { Trash2 } from "lucide-react";
const HorizontalProgressBars = dynamic(
	() =>
		import("@/components/charts").then((m) => m.HorizontalProgressBars),
	{ ssr: false, loading: () => <div>Loading word cloud…</div> }
);

const QuestChoiceCreatorPreview: React.FC<{ id: string }> = ({ id }) => {
	const dispatch = useDispatch();
	const { selectedItem, multypleselectedItem } = useSelector(
		(state: any) => state.quiz
	);

	// console.log(selectedItem, "selectedItemselectedItemselectedItemselectedItemselectedItem");


	const currentItem = multypleselectedItem.find(
		(item: { id: string }) => item.id === id
	);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const allOptions: any = currentItem?.options || [];

	const [editingId, setEditingId] = useState<string | null>(null);
	const [editText, setEditText] = useState("");
	const [series, setSeries] = useState<number[]>([]);
	const [labels, setLabels] = useState<string[]>([]);

	useEffect(() => {
		if (allOptions.length > 0) {
			const newLabels = allOptions.map(
				(opt: { text: string; placeholder: string }) =>
					opt.text?.trim() || opt.placeholder || ""
			);
			setLabels(newLabels);

			// An empty preview: it flashed random numbers for 1.5s (which read as real results), and that
			// uncancelled timer reset the bars to the old option count after one was removed.
			setSeries(allOptions.map(() => 0));
		}
	}, [allOptions]);

	const questionsRemove = async () => {
		await ConfirmDialog.show(
			{
				title: "Are you sure you want to delete this quest?",
				text: "This action cannot be undone.",
				confirmButtonText: "Yes, delete it!",
			},
			async () => {
				const response = await axiosInstance.delete(
					`/quest-tasks/delete/${currentItem?.id}`
				);
				if (currentItem) dispatch(removeSelectedItem(currentItem));
				console.log(response);
			}
		);
	};
	const handleReorder = (fromId: string, toId: string) => {
		dispatch(
			reorderOptions({
				quizId: id,
				fromId,
				toId,
			})
		);
	};

	// console.log(selectedItem, "selectedItem");
	console.log(currentItem, "selectedItem");

	return (
		<div className="grid grid-cols-1 md:grid-cols-12 gap-5">
			<div className="md:col-span-9">
				<div className="flex-1 p-4 bg-white relative border-2 border-[#bc5eb3] rounded-[10px] h-[calc(90vh-80px)] flex flex-col  overflow-y-auto scrollbar-hidden">
					<StylableInput style="quest" />
					<HorizontalProgressBars
						data={series}
						labels={labels}
						colors={allOptions.map(
							(opt: { color: string }) => opt.color || ""
						)}
					/>

					<div className="flex bg-white justify-between absolute bottom-5 w-full left-0 px-[20px]">
						<p> {selectedItem?.task_data?.minText}</p>
						<p> {selectedItem?.task_data?.maxText} </p>
					</div>
				</div>
			</div>

			<div className="md:col-span-3 p-4 bg-white rounded-lg h-[calc(90vh-80px)] overflow-y-auto scrollbar-hidden">

				<div className="flex gap-3 mb-6">
					<h3 className="block text-sm font-medium"> Question type : {currentItem?.key === "scales" ? "Scales" : ""}  </h3>
				</div>

				<div className="flex gap-3 mb-6">
					<button
						onClick={questionsRemove}
						className="bg-[#f2f1f0] hover:bg-red-500 hover:text-white transition-colors duration-300 flex items-center justify-center gap-2 w-full py-2 rounded-md font-medium"
					>
						<Trash2 size={16} /> <span>Delete</span>
					</button>
				</div>

				<OptionList
					allOptions={allOptions}
					quizId={id}
					editingId={editingId}
					setEditingId={setEditingId}
					editText={editText}
					setEditText={setEditText}
					handleAddOption={() => dispatch(addQuestOption())}
					handleRemoveOption={() => dispatch(removeQuizOption())}
					onReorder={handleReorder}
				/>

				<CustomSelect
					className="mt-4 text-sm"
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
					value={`${selectedItem?.timeLimit || "30"}`}
					prefixIcon={<FaRegClock />}
					onChange={(value) =>
						dispatch(
							updateLimitedTimeTitle({ id, timeLimit: value })
						)
					}
				/>

				<div className="pt-[10px]">
					<div className="flex justify-between gap-5 mb-[10px]">
						<div className="block text-[#313030] text-[1rem] font-medium dark:text-white pb-[10px]">
							<h5 className="block text-[#313030] text-[0.875rem] font-medium  dark:text-white">
								Bottom of the scale
							</h5>
							<input
								type="text"
								value={
									selectedItem?.task_data?.minText ??
									"Strongly disagree"
								}
								onChange={(e) => {
									dispatch(
										scalesMaxMinData({
											id,
											minText: e.target.value,
											maxText:
												selectedItem?.task_data
													?.maxText,
										})
									);
								}}
								className="border border-[#2222] px-4 py-2 rounded-[10px] mt-[10px] text-dark-5 w-full"
							/>
						</div>
						<div className="block text-[#313030] text-[1rem] font-medium dark:text-white pb-[10px]">
							<h5 className="block text-[#313030] text-[0.875rem] font-medium  dark:text-white">
								Value
							</h5>
							<input
								type="number"
								value={selectedItem?.task_data?.minNumber || 1}
								onChange={(e) => {
									const newMin = Number(e.target.value);
									const currentMax =
										selectedItem?.task_data?.maxNumber ?? 5;
									dispatch(
										scalesMaxMinData({
											id,
											minNumber: newMin,
											maxNumber: currentMax,
										})
									);
								}}
								className="w-[75px] bg-[#f2f1f0] px-4 py-2 rounded-[10px] mt-[10px]"
							/>
						</div>
					</div>
					<div className="flex justify-between gap-5 mb-[10px]">
						<div className="block text-[#313030] text-[1rem] font-medium dark:text-white pb-[10px]">
							<h5 className="block text-[#313030] text-[0.875rem] font-medium  dark:text-white">
								Top of the scale
							</h5>
							<input
								type="text"
								value={
									selectedItem?.task_data?.maxText ??
									"Strongly agree"
								}
								onChange={(e) => {
									dispatch(
										scalesMaxMinData({
											id,
											minText:
												selectedItem?.task_data
													?.minText,
											maxText: e.target.value,
										})
									);
								}}
								className="border border-[#2222] px-4 py-2 rounded-[10px] mt-[10px] text-dark-5 w-full"
							/>
						</div>
						<div className="block text-[#313030] text-[1rem] font-medium dark:text-white pb-[10px]">
							<h5 className="block text-[#313030] text-[0.875rem] font-medium  dark:text-white">
								Value
							</h5>
							<input
								type="number"
								value={selectedItem?.task_data?.maxNumber || 5}
								onChange={(e) => {
									const newMax = Number(e.target.value);
									const currentMin =
										selectedItem?.task_data?.minNumber ?? 1;
									dispatch(
										scalesMaxMinData({
											id,
											minNumber: currentMin,
											maxNumber: newMax,
										})
									);
								}}
								className="w-[75px] bg-[#f2f1f0] px-4 py-2 rounded-[10px] mt-[10px]"
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

export default QuestChoiceCreatorPreview;
