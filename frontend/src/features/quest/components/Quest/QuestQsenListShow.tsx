/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "next/navigation";
import { RootState } from "@/stores/store";
import { RiDeleteBin5Line } from "react-icons/ri";
import { HiOutlineDuplicate } from "react-icons/hi";

import {
	setSelectedItem,
	setMultipleSelectedItems,
	removeSelectedItem,
	duplicateItem,
} from "@/features/quiz/store/quizItems/quizSlice";
import { clearSelectedItem } from "@/features/quiz/store/quizItems/quizSlice";

import {
	DndContext,
	closestCenter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	DragEndEvent,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
// import SafeHTMLRenderer from "@/components/SafeHTMLRendererProps";
import axiosInstance from "@/utils/axiosInstance";
import ConfirmDialog from "@/utils/showConfirmDialog";
import { AxiosError } from "axios";
import Image from "next/image";
import { removeTask } from "@/features/live/store/quickFormSlice";
import { toast } from "react-toastify";
interface MenuItem {
	key: string;
	id: string;
	title?: string;
	quiz_id?: string;
	position?: number;
}

interface SortableItemProps {
	currentActiveItem: MenuItem | null;
	item: MenuItem;
	multypleselectedItem: MenuItem[];
	index: number;
	onClick: (item: MenuItem) => void;
	onDelete: (key: string) => void;
	onDuplicate: (key: string) => void;
}

/** Two lines of the question (it was cut to 15 letters), or a placeholder when it has none yet. */
function CardTitle({ text }: { text: string }) {
	return (
		<span className={`line-clamp-2 w-full break-words px-1 text-center text-[13px] leading-snug ${text ? "text-[#333]" : "italic text-[#999]"}`}>
			{text || "Untitled question"}
		</span>
	);
}

function SortableItem({
	currentActiveItem,
	item,
	multypleselectedItem,
	onClick,
	onDelete,
	onDuplicate,
}: SortableItemProps) {
	const dispatch = useDispatch();

	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: item.id });

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	const itemList = multypleselectedItem.find((i) => i.id === item.id);
	const isActive = itemList?.id === currentActiveItem?.id;

	console.log(multypleselectedItem, "itemList");
	console.log(item.key, "itemList");

	const questionsRemove = async (id: string) => {
		await ConfirmDialog.show(
			{
				title: "Are you sure you want to delete this quest?",
				text: "This action cannot be undone.",
				confirmButtonText: "Yes, delete it!",
			},
			async () => {
				try {
					const response = await axiosInstance.delete(
						`/quest-tasks/delete/${id}`,
					);
					if (id) {
						onDelete(id);
					}
					console.log(response, "transformedData");
				} catch (error) {
					const axiosError = error as AxiosError<{
						message?: string;
					}>;
					if (axiosError.response) {
						console.error(
							"Error verifying token:",
							axiosError.response.data,
						);
						toast.error(
							`Error: ${
								axiosError.response.data?.message ||
								"Verification failed."
							}`,
						);
					} else {
						console.error("Unexpected error:", axiosError.message);
						toast.error(
							"Unexpected error occurred. Please try again.",
						);
					}
				} finally {
				}
			},
		);
	};

	const htmlToText = (html?: string) => {
		if (!html) return "";
		const stripped = html.replace(/<[^>]*>/g, " ");
		if (typeof window !== "undefined") {
			const div = document.createElement("div");
			div.innerHTML = stripped;
			const text = div.textContent || div.innerText || "";
			return text
				.replace(/\u00a0/g, " ")
				.replace(/\s+/g, " ")
				.trim();
		}
		return stripped
			.replace(/\u00a0/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	};

	console.log(item, "itemitemitemitemitemitemitemitemitem");

	return (
		<div className="relative">
			<div
				ref={setNodeRef}
				style={style}
				{...attributes}
				{...listeners}
				className=""
			>
				<div
					className={`flex  bg-white justify-center group w-full items-center px-5 py-3 mb-3 flex-col rounded-[10px] h-[132px] cursor-grab active:cursor-grabbing
          border-2 ${isActive ? "border-[#BC5EB3]" : "border-[#2222] py-2"}
          hover:border-[#BC5EB3] transition`}
					onClick={() => onClick(item)}
				>
					{item.key === "qsenchoice" && (
						<>
							<Image
								src="/images/icons/Icon-01.svg"
								alt="Yes / No"
								width={60}
								height={60}
								className="mr-2"
							/>
							<CardTitle text={htmlToText(item?.title || "").trim()} />
						</>
					)}
					{item.key === "sorting" && (
						<>
							<Image
								src="/images/icons/sorting.svg"
								alt="True / False"
								width={60}
								height={60}
								className="mr-2"
							/>
							<CardTitle text={htmlToText(item?.title || "").trim()} />
						</>
					)}

					{item.key === "truefalse" && (
						<>
							<Image
								src="/images/icons/yes-no.svg"
								alt="Yes / No"
								width={60}
								height={60}
								className="mr-2"
							/>
							<CardTitle text={htmlToText(item?.title || "").trim()} />
						</>
					)}

					{item.key === "wordcloud" && (
						<>
							<Image
								src="/images/icons/word-cloud.svg"
								alt="Word Cloud"
								width={60}
								height={60}
								className="mr-2"
							/>

							<CardTitle text={htmlToText(item?.title || "").trim()} />
						</>
					)}

					{item.key === "scales" && (
						<>
							<Image
								src="/images/icons/scales.svg"
								alt="Scales"
								width={60}
								height={60}
								className="mr-2"
							/>
							<CardTitle text={htmlToText(item?.title || "").trim()} />
						</>
					)}

					{item.key === "ranking" && (
						<>
							<Image
								src="/images/icons/ranking.svg"
								alt="Ranking"
								width={60}
								height={60}
								className="mr-2"
							/>
							<CardTitle text={htmlToText(item?.title || "").trim()} />
						</>
					)}

					{item.key === "shortanswer" && (
						<>
							<Image
								src="/images/icons/Icon-03.svg"
								alt="Short Answer"
								width={60}
								height={60}
								className="mr-2"
							/>
							<CardTitle text={htmlToText(item?.title || "").trim()} />
						</>
					)}

					{item.key === "longanswer" && (
						<>
							<Image
								src="/images/icons/long-answer.svg"
								alt="Fill In The Blanks"
								width={60}
								height={60}
								className="mr-2"
							/>
							<CardTitle text={htmlToText(item?.title || "").trim()} />
						</>
					)}

					{item.key === "quick_form" && (
						<>
							<Image
								src="/images/icons/quick-form.svg"
								alt="Quick Form"
								width={60}
								height={60}
								className="mr-2"
							/>
							<CardTitle text={htmlToText(item?.title || "").trim()} />
						</>
					)}

					{item.key === "content" && (
						<>
							<Image
								src="/images/icons/content.svg"
								alt="Quick Form"
								width={60}
								height={60}
								className="mr-2"
							/>
							<CardTitle text={htmlToText(item?.title || "").trim()} />
						</>
					)}

					<div
						className={` absolute left-0 w-[20px] h-5 top-0 rounded-tl-[7px] rounded-br-[7px] text-[12px] items-center flex text-[#fff] justify-center group-hover:bg-[#BC5EB3] bg-[#BC5EB3] ${
							isActive ? "" : ""
						}`}
					>
						{itemList?.position}
					</div>
				</div>
			</div>
			<div className="absolute z-10 right-3 bottom-3 space-y-14">
				<div className="w-[25px] mb-[3px] h-[25px] bg-orange-500 rounded-full justify-center flex items-center hidden">
					<HiOutlineDuplicate
						className=" hover:text-[#333] cursor-pointer text-[#fff]"
						size={12}
						onClick={(e) => {
							e.stopPropagation();

							onDuplicate(item.id);
						}}
					/>
				</div>
				<div className="w-[25px] h-[25px] bg-red-500 hover:bg-red-600 rounded-full justify-center flex items-center ">
					<RiDeleteBin5Line
						className=" hover:text-[#333] cursor-pointer text-[#fff]"
						size={12}
						onClick={(e) => {
							e.stopPropagation();
							questionsRemove(item.id);
							if (item.key === "quick_form" && item.quiz_id) {
								dispatch(
									removeTask({
										quest_id: String(item.quiz_id),
										taskId: item.id,
									}),
								);
							}
						}}
					/>
				</div>
			</div>
		</div>
	);
}

function QuestQsenListShow() {
	const dispatch = useDispatch();
	const params = useParams();
	const qId = params?.id as string;
	const quesentList = useSelector(
		(state: RootState) => state.quiz.multypleselectedItem,
	);

	const multypleselectedItem = quesentList?.filter(
		(list) => `${list?.quiz_id}` === `${qId}`,
	);
	useEffect(() => {
		dispatch(clearSelectedItem());
	}, [qId]);
	// console.log(quesentList, "quesentList quesentList ");
	// console.log(multypleselectedItem, "quesentList quesentList ");

	const selectedItem = useSelector(
		(state: RootState) => state.quiz.selectedItem,
	);
	// console.log(multypleselectedItem, "multypleselectedItem");
	// console.log(qId, "multypleselectedItem");

	const handleItemClick = (item: MenuItem) => {
		console.log(item, "9999999999999999999999999");

		dispatch(
			setSelectedItem({
				key: item.key,
				id: item.id,
				title: "Untitled question",
				options: [],
				maxOptions: 0,
				minOptions: 0,
				allowDuplicates: false,
				isMultipleSelection: false,
				timeLimit: "",
			}),
		);
	};


	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		const currentActive = multypleselectedItem.find(
			(item) => item.id === active.id,
		);
		if (currentActive) dispatch(setSelectedItem(currentActive));
		if (!over || active.id === over.id) return;

		const oldIndex = multypleselectedItem.findIndex(
			(item) => item.id === active.id,
		);
		const newIndex = multypleselectedItem.findIndex(
			(item) => item.id === over.id,
		);

		if (oldIndex !== -1 && newIndex !== -1) {
			const newItems = arrayMove(
				multypleselectedItem,
				oldIndex,
				newIndex,
			);
			const itemsWithUpdatedPositions = newItems.map((item, index) => ({
				...item,
				position: index + 1,
			}));

			dispatch(setMultipleSelectedItems(itemsWithUpdatedPositions));
			const droppedItem = itemsWithUpdatedPositions[newIndex];
			dispatch(setSelectedItem(droppedItem));
		}
	};

	const duplicateFunctionCall = async (id: string) => {
		if (!selectedItem) return;
		const response = await axiosInstance.post(`/quiz/questions/store`, {
			quiz_id: selectedItem.quiz_id,
			question_text: ".",
			visibility: "public",
		});
		console.log(response, "currentActive");

		dispatch(
			duplicateItem({
				id: id,
				qid: response?.data?.data.question.id,
			}),
		);
	};

	// useEffect(() => {
	// 	if (multypleselectedItem.length > 0) {
	// 		const normalized = [...multypleselectedItem]
	// 			.sort((a, b) => (a.position || 0) - (b.position || 0))
	// 			.map((item, index) => ({
	// 				...item,
	// 				position: index + 1,
	// 			}));

	// 		dispatch(setMultipleSelectedItems(normalized));

	// 		if (!selectedItem) {
	// 			dispatch(setSelectedItem(normalized[0]));
	// 		}
	// 	}
	// }, [qId]);
	useEffect(() => {
		if (multypleselectedItem.length > 0) {
			const normalized = [...multypleselectedItem]
				.sort((a, b) => (a.position || 0) - (b.position || 0))
				.map((item, index) => ({
					...item,
					position: index + 1,
				}));

			dispatch(setMultipleSelectedItems(normalized));

			// Preserve current selection when possible. Only set a selection
			// if there is no selectedItem or the selectedItem no longer exists
			// for this quiz. In that case pick the last item (assumed newly
			// added). This avoids always forcing the first item active on reload
			// or when adding new questions.
			if (
				!selectedItem ||
				!normalized.some((i) => i.id === selectedItem.id)
			) {
				dispatch(setSelectedItem(normalized[normalized.length - 1]));
			}
		}
	}, [multypleselectedItem.length, qId, selectedItem?.id]);

	return (
		<div className="h-[calc(90vh-80px)]  overflow-y-auto scrollbar-hidden">
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={handleDragEnd}
				modifiers={[restrictToVerticalAxis]}
			>
				<SortableContext
					items={multypleselectedItem}
					strategy={verticalListSortingStrategy}
				>
					<div>
						{multypleselectedItem
							.sort(
								(a, b) => (a.position || 0) - (b.position || 0),
							)
							.map((item, index) => (
								<SortableItem
									key={item.id}
									item={item}
									index={index}
									multypleselectedItem={multypleselectedItem}
									onClick={handleItemClick}
									currentActiveItem={selectedItem}
									onDelete={() =>
										dispatch(removeSelectedItem(item))
									}
									onDuplicate={() =>
										duplicateFunctionCall(item.id)
									}
								/>
							))}
					</div>
				</SortableContext>
			</DndContext>
		</div>
	);
}

export default QuestQsenListShow;
