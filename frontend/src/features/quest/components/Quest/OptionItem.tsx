import React, { useRef, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
	updateOptionText,
	updateOptionColor,
	removeQuestOption,
} from "@/features/quiz/store/quizItems/quizSlice";
import { IoClose, IoReorderTwo } from "react-icons/io5";
import { RootState } from "@/stores/store";
import { cn } from "@/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { addQuestOptionsFromPaste } from "@/features/quiz/store/quizItems/quizSlice";


interface OptionItemProps {
	option: {
		id: string;
		text: string;
		placeholder: string;
		color: string;
		isSelected: boolean;
	};
	quizId: string;
	editingId: string | null;
	setEditingId: (id: string | null) => void;
	editText: string;
	setEditText: (text: string) => void;
	handleRemoveOption?: () => void;
}

const OptionItem: React.FC<OptionItemProps> = ({
	option,
	quizId,
	editingId,
	setEditingId,
	editText,
	setEditText,
	// handleRemoveOption,
}) => {
	const dispatch = useDispatch();
	const editRef = useRef<HTMLDivElement | null>(null);

	const { multypleselectedItem } = useSelector(
		(state: RootState) => state.quiz
	);
	const currentItem = multypleselectedItem.find((item) => item.id === quizId);
	const placeholderText =
		currentItem?.key === "wordcloud" ? "Suggested word" : option.placeholder;

	const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
		const text = e.clipboardData.getData("text");
		if (/\r?\n/.test(text)) {
			e.preventDefault();
			dispatch(addQuestOptionsFromPaste(text));
		}
	};


	// Add drag and drop functionality
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: option.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	const inputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		if (editingId === option.id) {
			// wait for the input to mount, then focus + place cursor at end
			requestAnimationFrame(() => {
				if (inputRef.current) {
					inputRef.current.focus();
					const v = inputRef.current.value;
					inputRef.current.setSelectionRange(v.length, v.length);
				}
			});
		}
	}, [editingId, option.id]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				editingId &&
				editRef.current &&
				!editRef.current.contains(event.target as Node)
			) {
				if (editText.trim()) {
					dispatch(
						updateOptionText({
							quizId,
							optionId: option.id,
							text: editText.trim(),
						})
					);
				}
				setEditingId(null);
				setEditText("");
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () =>
			document.removeEventListener("mousedown", handleClickOutside);
	}, [
		editingId,
		editText,
		dispatch,
		quizId,
		option.id,
		setEditingId,
		setEditText,
	]);

	return (
		<div
			ref={setNodeRef}
			style={style}
			className="flex justify-between gap-3"
		>
			<div
				className={cn(
					`${currentItem?.key}` === "truefalse"
						? "w-full"
						: "w-[90%]",
					`px-4 py-2 border rounded flex items-center gap-3 relative ${option.isSelected ? "bg-[#bdffd8]" : "bg-[#f2f1f0]"
					}`,
					isDragging ? "shadow-lg" : ""
				)}
			>

				{editingId !== option.id && (
					<button
						type="button"
						{...attributes}
						{...listeners}
						className="hover:cursor-grab active:cursor-grabbing flex-shrink-0"
					>
						<IoReorderTwo
							size={20}
							className="text-gray-400 hover:text-gray-600"
						/>
					</button>
				)}

				{editingId === option.id ? (
					<div
						className="relative flex items-center gap-2 w-full"
						ref={editRef}
					>
						<input
							type="color"
							value={option.color}
							onChange={(e) =>
								dispatch(
									updateOptionColor({
										quizId,
										optionId: option.id,
										color: e.target.value,
									})
								)
							}
							className="w-[20px] h-[20px] rounded-full cursor-pointer"
						/>

						<input
							ref={inputRef}
							autoFocus
							type="text"
							placeholder={placeholderText}
							value={editText}
							onChange={(e) => setEditText(e.target.value)}
							onClick={(e) => e.stopPropagation()}
							onPaste={handlePaste}
							className="bg-[#f2f1f0] text-[.875rem] w-full p-2 rounded text-black focus:outline-none focus:ring-0"
							maxLength={70}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									const t = editText.trim();
									if (t) {
										dispatch(
											updateOptionText({
												quizId,
												optionId: option.id,
												text: t,
											})
										);
									}
									setEditingId(null);
									setEditText("");
								}
								if (e.key === "Escape") {
									setEditingId(null);
									setEditText("");
								}
							}}
						/>
					</div>
				) : (
					<div
						className="flex items-center gap-2 w-full cursor-pointer"
						onClick={() => {
							setEditingId(option.id);
							setEditText(option.text);
						}}
					>
						<input
							type="color"
							value={option.color}
							onChange={(e) =>
								dispatch(
									updateOptionColor({
										quizId,
										optionId: option.id,
										color: e.target.value,
									})
								)
							}
							className="w-[20px] h-[20px] rounded-full flex-shrink-0"
						/>
						<p className="flex-grow text-[14px]">
							{option.text.trim() || placeholderText}
						</p>
					</div>
				)}
			</div>
			{currentItem?.key !== "truefalse" && (
				<button
					type="button"
					onClick={() => {
						// handleRemoveOption();
						dispatch(removeQuestOption(option.id));
					}}
					className="flex-shrink-0"
				>
					<IoClose
						className="hover:text-[#bc5eb3] text-[#171717]"
						size={25}
					/>
				</button>
			)}
		</div>
	);
};

export default OptionItem;
