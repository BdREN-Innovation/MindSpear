"use client";
import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/stores/store";
import {
	updateLimitedTimeTitle,
	removeSelectedItem,
	// updatePoints,
} from "@/features/quiz/store/quizItems/quizSlice";
import StylableInput from "@/lib/StylableInput";
// import { Select } from "@/components/FormElements/select";
import { FaRegClock } from "react-icons/fa";
// import { VscActivateBreakpoints } from "react-icons/vsc";
import axiosInstance from "@/utils/axiosInstance";
import ConfirmDialog from "@/utils/showConfirmDialog";

import dynamic from "next/dynamic";
import { CustomSelect } from "@/components/FormElements/CustomSelect";
import { Trash2 } from "lucide-react";
const GlobalGridMapChart = dynamic(
	() =>
		import("@/components/charts").then((m) => m.TreemapChart),
	{ ssr: false, loading: () => <div>Loading word cloud…</div> }
);

const QuestShortAnswerCreatorPreview: React.FC<{ id: string }> = ({ id }) => {
	const dispatch = useDispatch();
	const [seriesData, setSeriesData] = useState([
		{ x: "User Answer", y: 150 },
		{ x: "User Answer", y: 150 },
		{ x: "User Answer", y: 150 },
		{ x: "User Answer", y: 150 },
		{ x: "User Answer", y: 150 },
		{ x: "User Answer", y: 150 },
	]);
	const { selectedItem, multypleselectedItem } = useSelector(
		(state: RootState) => state.quiz
	);
	const currentItem = multypleselectedItem.find((item) => item.id === id);
	useEffect(() => {
		const timer = setTimeout(() => {
			setSeriesData([]);
		}, 1500);

		return () => clearTimeout(timer);
	}, [currentItem?.key]);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any

	//   const [phrases, setPhrases] = useState<string[]>([]);

	//   useEffect(() => {
	//     if (allOptions.length > 0) {
	//       const newPhrases = allOptions.map(
	//         (opt) => opt.text?.trim() || opt.placeholder || "Sample"
	//       );
	//       setPhrases(newPhrases);
	//     }
	//   }, [allOptions]);

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
	console.log(currentItem, "selectedItem");
	return (
		<div className="grid grid-cols-1 md:grid-cols-12 gap-5">
			<div className="md:col-span-9">
				<div className="p-4 flex flex-col bg-white border-2 border-[#bc5eb3] rounded-[10px] h-[calc(90vh-80px)]  overflow-y-auto scrollbar-hidden">
					<div className="">
						<StylableInput style="quest" />
					</div>
					<div className="flex-grow flex flex-col justify-center">
						<GlobalGridMapChart seriesData={seriesData} />
						{/* The preview was blank, with nothing saying what players would see. */}
						<p className="mt-4 text-center text-sm text-[#888]">
							Players type their answer. During the live session each answer appears here as a card.
						</p>
					</div>
				</div>
			</div>

			<div className="md:col-span-3 p-6 bg-white rounded-lg h-[calc(90vh-80px)] overflow-y-auto scrollbar-hidden">
				<div className="flex gap-3 mb-6">
					<h3 className="block text-sm font-medium"> Question type : {currentItem?.key === "longanswer" ? "Long answer" : "Short Answer"}  </h3>
				</div>

				<div className="flex gap-3 mb-6">
					<button
						onClick={questionsRemove}
						className="bg-[#f2f1f0] hover:bg-red-500 hover:text-white transition-colors duration-300 flex items-center justify-center gap-2 w-full py-2 rounded-md font-medium"
					>
						<Trash2 size={16} /> <span>Delete</span>
					</button>
				</div>

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
			</div>
		</div>
	);
};

export default QuestShortAnswerCreatorPreview;
