"use client";
import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/stores/store";
import {
	addQuestOption,
	removeQuizOption,
	toggleSwitchSelectionMode,
	updateLimitedTimeTitle,
	removeSelectedItem,
	// updatePoints,
	reorderOptions,
} from "@/features/quiz/store/quizItems/quizSlice";
import StylableInput from "@/lib/StylableInput";
import { FaRegClock } from "react-icons/fa";
// import { VscActivateBreakpoints } from "react-icons/vsc";
import axiosInstance from "@/utils/axiosInstance";
import ConfirmDialog from "@/utils/showConfirmDialog";
// import { convertDataToQuestions } from "@/utils/quizUtils";
// import QuestionChart from "./QuestionChart";
import ChartTypeSelector from "./ChartTypeSelector";
import OptionList from "./OptionList";
import { HorizontalBarChart as GlobalHorizantalBarChart } from "@/components/charts";
import { CustomSelect } from "@/components/FormElements/CustomSelect";
import { Trash2 } from "lucide-react";

const QuestRankingCreatorPreview: React.FC<{ id: string }> = ({ id }) => {
	const dispatch = useDispatch();
	const { selectedItem, multypleselectedItem } = useSelector(
		(state: RootState) => state.quiz
	);
	const isMultipleSelection = selectedItem?.isMultipleSelection ?? false;

	const currentItem = multypleselectedItem.find((item) => item.id === id);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const allOptions: any = currentItem?.options || [];

	//   const transformed = convertDataToQuestions(multypleselectedItem);
	//   const singleQsnUpdate = transformed?.questions.find(
	//     (item) => `${item?.question_id}` === `${selectedItem?.id}`
	//   );

	const [chartType, setChartType] = useState<"bar" | "pie" | "donut">("bar");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editText, setEditText] = useState("");
	const [series, setSeries] = useState<number[]>([]);
	const [labels, setLabels] = useState<string[]>([]);

	useEffect(() => {
		if (allOptions.length > 0) {

			const newLabels = allOptions.map(
				(opt: { text: string; placeholder: string; }) => opt.text?.trim() || opt.placeholder || ""
			);
			setLabels(newLabels);

			const randomValues = allOptions.map(() =>
				Math.floor(Math.random() * 100)
			);
			setLabels(newLabels);
			setSeries(randomValues);
			setTimeout(() => setSeries(allOptions.map(() => 0)), 1500);
		}
	}, [allOptions, chartType]);

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
	const handleReorder = (fromId: string, toId: string) => {
		dispatch(
			reorderOptions({
				quizId: id,
				fromId,
				toId,
			})
		);
	};

	return (
		<div className="grid grid-cols-1 md:grid-cols-12 gap-5">
			<div className="md:col-span-9">
				<div className=" p-4 bg-white border-2 border-[#bc5eb3] rounded-[10px] h-[calc(90vh-80px)] flex flex-col  overflow-y-auto scrollbar-hidden">
					<StylableInput style="quest" />
					<GlobalHorizantalBarChart
						data={series}
						categories={labels}
						colors={allOptions.map((opt: { color: string; }) => opt.color || "")}
						showEmptyChart
					/>
				</div>
			</div>

			<div className="md:col-span-3 p-6 bg-white rounded-lg h-[calc(90vh-80px)] overflow-y-auto scrollbar-hidden">

				<div className="flex gap-3 mb-6">
					<h3 className="block text-sm font-medium"> Question type : {currentItem?.key === "ranking" ? "Ranking" : ""}  </h3>
				</div>

				<div className="flex gap-3 mb-6">
					<button
						onClick={questionsRemove}
						className="bg-[#f2f1f0] hover:bg-red-500 hover:text-white transition-colors duration-300 flex items-center justify-center gap-2 w-full py-2 rounded-md font-medium"
					>
						<Trash2 size={16} /> <span>Delete</span>
					</button>
				</div>

				<div className="mb-6">
					<label className="flex items-center cursor-pointer justify-between">
						<div className="text-[#1a1a1a] font-medium text-[0.875rem]">
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

				<div className="mb-[20px] hidden">
					<h3 className="pb-4 text-[#1a1a1a] font-medium text-[0.875rem]">
						Visualization type
					</h3>
					<ChartTypeSelector
						chartType={chartType}
						setChartType={setChartType}
					/>
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

export default QuestRankingCreatorPreview;
