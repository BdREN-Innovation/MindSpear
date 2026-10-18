/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
// import { RootState } from "@/services/redux/store";
import {
	addQuestOption,
	removeQuizOption,
	// toggleSwitchSelectionMode,
	updateLimitedTimeTitle,
	removeSelectedItem,
	// updatePoints,
	reorderOptions,
} from "@/features/quiz/store/quizItems/quizSlice";
import StylableInput from "@/lib/StylableInput";
// import { Select } from "@/components/FormElements/select";
import { FaRegClock } from "react-icons/fa";
// import { VscActivateBreakpoints } from "react-icons/vsc";
import axiosInstance from "@/utils/axiosInstance";
import ConfirmDialog from "@/utils/showConfirmDialog";
import { WordCloud as D3WordCloud, type Word } from "@/components/charts";
import OptionList from "./OptionList";
import { CustomSelect } from "@/components/FormElements/CustomSelect";
import { Trash2 } from "lucide-react";

const QuestWordCloudCreatorPreview: React.FC<{ id: string }> = ({ id }) => {
	const dispatch = useDispatch();
	const { selectedItem, multypleselectedItem } = useSelector(
		(state: any) => state.quiz
	);

	const currentItem = multypleselectedItem.find(
		(item: { id: string }) => item.id === id
	);
	const allOptions: any = currentItem?.options || [];
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editText, setEditText] = useState("");

	const questionsRemove = async () => {
		await ConfirmDialog.show(
			{
				title: "Are you sure you want to delete this question?",
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

	if (currentItem === undefined) return null;
	// Sample words for the preview (players' words replace them live).
	const values: Word[] = [
		{ text: "Creative", value: 60 },
		{ text: "Bold", value: 50 },
		{ text: "Inspiring", value: 45 },
		{ text: "Focused", value: 40 },
		{ text: "Growth", value: 25 },
		{ text: "Fast", value: 20 },
	];

	const handleReorder = (fromId: string, toId: string) => {
		dispatch(
			reorderOptions({
				quizId: id,
				fromId,
				toId,
			})
		);
	};

	console.log(currentItem, "currentItem");

	return (
		<div className="grid grid-cols-1 md:grid-cols-12 gap-5">
			<div className="md:col-span-9">
				<div className="p-4 flex flex-col bg-white border-2 border-[#bc5eb3] rounded-[10px] h-[calc(90vh-80px)]  overflow-y-auto scrollbar-hidden">
					<div className="">
						<StylableInput style="quest" />
					</div>
					<div className="flex-grow flex flex-col justify-center ">
						{/* <div className="min-h-[450px] w-full flex items-center justify-center"> */}
						<D3WordCloud
							words={values}
							width={1000}
							height={450}
							minFont={12} // even if small, it’ll render >= 24px
							maxFont={72}
							rotate={() => (Math.random() > 0.85 ? 90 : 0)}
							// onWordClick={(w) => console.log("Clicked:", w)}
						/>

						{/* </div> */}
						<p className="text-center text-xs text-[#999]">Sample preview: players&apos; words appear here live.</p>
					</div>
				</div>
			</div>

			<div className="md:col-span-3 p-6 bg-white rounded-lg h-[calc(90vh-80px)] overflow-y-auto scrollbar-hidden">
				<div className="flex gap-3 mb-6">
					<h3 className="block text-sm font-medium">
						{" "}
						Question type :{" "}
						{currentItem?.key === "wordcloud"
							? "Wordcloud"
							: ""}{" "}
					</h3>
				</div>

				<div className="flex gap-3 mb-6">
					<button
						onClick={questionsRemove}
						className="bg-[#f2f1f0] hover:bg-red-500 hover:text-white transition-colors duration-300 flex items-center justify-center gap-2 w-full py-2 rounded-md font-medium"
					>
						<Trash2 size={16} /> <span>Delete</span>
					</button>
				</div>

				{/* These are suggestions players can tap; it only said "Option 1" / "Add Word". */}
				<h4 className="text-sm font-semibold text-[#222]">Suggested words (optional)</h4>
				<p className="mb-3 text-xs text-[#888]">
					Players can tap one of these or type their own word.
				</p>
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
					qsenkey={currentItem?.key}
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

				{/* <Select
					className="mt-4 text-sm"
					label="Points"
					items={[
						{ label: "Single Points", value: "1" },
						{ label: "Multiple Points", value: "2" },
					]}
					prefixIcon={<VscActivateBreakpoints />}
					value={`${selectedItem?.points ?? "1"}`}
					onChange={(e) => dispatch(updatePoints({ id, points: e }))}
				/> */}
			</div>
		</div>
	);
};

export default QuestWordCloudCreatorPreview;
