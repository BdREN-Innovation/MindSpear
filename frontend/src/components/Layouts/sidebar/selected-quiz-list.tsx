"use client";

import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "next/navigation";
import { RootState } from "@/stores/store";
import { RiDeleteBin5Line } from "react-icons/ri";
import { HiOutlineDuplicate } from "react-icons/hi";
// import {
// 	MultypleQsenIcon,
// 	TrueFalseIcon,
// 	SortAnsIcon,
// 	FillInTheBlankIcon,
// } from "@/assets/icons";
import {
	setSelectedItem,
	setMultipleSelectedItems,
	removeSelectedItem,
	duplicateItem,
} from "@/features/quiz/store/quizItems/quizSlice";
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
import SafeHTMLRenderer from "@/components/SafeHTMLRendererProps";
import axiosInstance from "@/utils/axiosInstance";
import ConfirmDialog from "@/utils/showConfirmDialog";
import { AxiosError } from "axios";
import Image from "next/image";
import { toast } from "react-toastify";
const TYPE_ICONS: Record<string, { src: string; label: string }> = {
	quiz: { src: "/images/icons/Icon-01.svg", label: "Multiple choice" },
	truefalse: { src: "/images/icons/Icon-02.svg", label: "True / False" },
	sortanswer: { src: "/images/icons/Icon-03.svg", label: "Short answer" },
	fillintheblanks: { src: "/images/icons/Icon-04.svg", label: "Fill in the blanks" },
};

interface MenuItem {
	key: string;
	id: string;
	title?: string;
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

function SortableItem({
	currentActiveItem,
	item,
	multypleselectedItem,
	onClick,
	onDelete,
	onDuplicate,
}: SortableItemProps) {

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


	const questionsRemove = async (id: string) => {
		await ConfirmDialog.show(
			{
				title: "Are you sure you want to delete this questions?",
				text: "This action cannot be undone.",
				confirmButtonText: "Yes, delete it!",
			},
			async () => {
				try {
					const response = await axiosInstance.delete(
						`/quiz/questions/delete/${id}`
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
							axiosError.response.data
						);
						toast.error(
							`Error: ${
								axiosError.response.data?.message ||
								"Verification failed."
							}`
						);
					} else {
						console.error("Unexpected error:", axiosError.message);
						toast.error(
							"Unexpected error occurred. Please try again."
						);
					}
				} finally {
				}
			}
		);
	};

	return (
		<div className="relative">
			<div
				ref={setNodeRef}
				style={style}
				{...attributes}
				{...listeners}
			>
				<div
					className={`flex justify-center group mb-[15px] w-full items-center gap-2 pl-5 pr-9 py-3 flex-col rounded-[10px] h-[132px] cursor-grab active:cursor-grabbing border-2 transition ${
						isActive
							? "border-[#BC5EB3] bg-[#fbf3fa]"
							: "border-[#2222] hover:border-[#BC5EB3]/50 hover:bg-[#fcfafc]"
					}`}
					onClick={() => onClick(item)}
				>
					{TYPE_ICONS[item.key] && (
						<Image
							src={TYPE_ICONS[item.key].src}
							alt={TYPE_ICONS[item.key].label}
							width={48}
							height={48}
						/>
					)}
					{/* Two lines of the title (the old limit cut it to a few letters). */}
					<SafeHTMLRenderer
						html={item.title || "Untitled question"}
						className={`line-clamp-2 w-full break-words text-center text-[13px] leading-snug ${
							item.title ? "text-[#333]" : "italic text-[#999]"
						}`}
					/>

					<div
						className={`absolute left-0 w-[20px] h-5 top-0 rounded-tl-[7px] rounded-br-[7px] text-[12px] items-center flex text-[#fff] justify-center ${
							isActive ? "bg-[#BC5EB3]" : "bg-[#222]"
						}`}
					>
						{itemList?.position}
					</div>
				</div>
			</div>
			{/* The whole circle is the button (only the 12px icon used to react to clicks). */}
			<div className="absolute z-10 right-2 bottom-3 space-y-14">
				<div
					role="button"
					aria-label="Duplicate question"
					title="Duplicate"
					onClick={(e) => {
						e.stopPropagation();
						onDuplicate(item.id);
					}}
					className="w-[25px] mb-[3px] h-[25px] bg-orange-500 rounded-full justify-center flex items-center cursor-pointer"
				>
					<HiOutlineDuplicate
						className=" hover:text-[#333] cursor-pointer text-[#fff]"
						size={12}
					/>
				</div>
				<div
					role="button"
					aria-label="Delete question"
					title="Delete"
					onClick={(e) => {
						e.stopPropagation();
						questionsRemove(item.id);
					}}
					className="w-[25px] h-[25px] bg-red-500 hover:bg-red-600 rounded-full justify-center flex items-center cursor-pointer"
				>
					<RiDeleteBin5Line
						className=" hover:text-[#333] cursor-pointer text-[#fff]"
						size={12}
					/>
				</div>
			</div>
		</div>
	);
}

function SelectedQuizList() {
	const dispatch = useDispatch();
	const params = useParams();
	const qId = params?.quizId as string;
	const quesentList = useSelector(
		(state: RootState) => state.quiz.multypleselectedItem
	);
	// console.log(quesentList, "quesentList quesentList ");

	const multypleselectedItem = quesentList?.filter(
		(list) => `${list?.quiz_id}` === `${qId}`
	);

	const selectedItem = useSelector(
		(state: RootState) => state.quiz.selectedItem
	);

	const handleItemClick = (item: MenuItem) => {

		const fullItem = multypleselectedItem.find((i) => i.id === item.id);
		if (fullItem) dispatch(setSelectedItem(fullItem));
	};

	// Hovering a card only highlights it: the editor keeps showing the selected question
	// (a hover preview used to mix the hovered question's answers into the selected one).

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		})
	);

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		const currentActive = multypleselectedItem.find(
			(item) => item.id === active.id
		);
		if (currentActive) dispatch(setSelectedItem(currentActive));
		if (!over || active.id === over.id) return;

		const oldIndex = multypleselectedItem.findIndex(
			(item) => item.id === active.id
		);
		const newIndex = multypleselectedItem.findIndex(
			(item) => item.id === over.id
		);

		if (oldIndex !== -1 && newIndex !== -1) {
			const newItems = arrayMove(
				multypleselectedItem,
				oldIndex,
				newIndex
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
		// The quiz in the URL, so a duplicate works before any question has been selected.
		const response = await axiosInstance.post(`/quiz/questions/store`, {
			quiz_id: qId,
			question_text: ".",
			visibility: "public",
		});

		dispatch(
			duplicateItem({
				id: id,
				qid: response?.data?.data.question.id,
			})
		);
	};


	return (
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
						.sort((a, b) => (a.position || 0) - (b.position || 0))
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
	);
}

export default SelectedQuizList;
