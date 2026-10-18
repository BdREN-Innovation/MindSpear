"use client";

import { useState, useRef, useEffect } from "react";
import { FaBold, FaItalic, FaUnderline, FaLink } from "react-icons/fa";
import { RootState } from "@/stores/store";
import DOMPurify from "dompurify";
import { updateQuizTitle } from "@/features/quiz/store/quizItems/quizSlice";
import { useSurveyOptional } from "@/contexts/SurveyContext";
import { useDispatch, useSelector } from "react-redux";
import { BiDotsHorizontalRounded } from "react-icons/bi";
import SafeHTMLRenderer from "@/components/SafeHTMLRendererProps";
const FONT_SIZES = [
	{ value: "12px", label: "Small" },
	{ value: "14px", label: "Medium" },
	{ value: "16px", label: "Large" },
	{ value: "18px", label: "X-Large" },
	{ value: "20px", label: "XX-Large" },
] as const;

<style jsx>{`
	a {
		color: blue;
		text-decoration: underline;
		cursor: pointer;
	}
	a:hover {
		color: darkblue;
	}
`}</style>;

interface stypeType {
	style?: string;
}

// export default function StylableInput() {
const StylableInput: React.FC<stypeType> = ({ style }) => {
	const editorRef = useRef<HTMLDivElement>(null);
	const toolbarRef = useRef<HTMLDivElement>(null);
	const [isFocused, setIsFocused] = useState(false);
	const [showLinkInput, setShowLinkInput] = useState(false);
	const [palceholaderText, setPalceholaderText] = useState(false);

	const [linkUrl, setLinkUrl] = useState("");
	const [content, setContent] = useState("");
	const typingTimeout = useRef<NodeJS.Timeout | null>(null);
	const lastSavedContent = useRef<string>("");
	const dispatch = useDispatch();
	const surveyContext = useSurveyOptional();
	const quizSelectedItem = useSelector(
		(state: RootState) => state.quiz.selectedItem,
	);
	const selectedItem =
		style === "survey" && surveyContext
			? surveyContext.state.selectedItem
			: quizSelectedItem;
	const updateTitle = (id: string, title: string) => {
		if (style === "survey" && surveyContext) {
			surveyContext.actions.updateQuizTitle({ id, title });
			return;
		}
		dispatch(updateQuizTitle({ id, title }));
	};

	const applyStyle = (command: string, value: string = "") => {
		document.execCommand(command, false, value);
		editorRef.current?.focus();
	};

	const handleLink = () => {
		if (showLinkInput) {
			setShowLinkInput(false);
		} else {
			setShowLinkInput(true);
		}
	};

	useEffect(() => {
		if (selectedItem) {
			const initialTitle =
				selectedItem.title || (selectedItem as any).question_text || "";
			setContent(initialTitle);
		} else {
			setContent("");
		}
	}, [selectedItem]);

	useEffect(() => {
		if (style === "survey" && selectedItem) {
			setTimeout(() => {
				editorRef.current?.focus();
			}, 0);
		}
	}, [style, selectedItem?.id]);

	const applyLink = (): void => {
		if (!linkUrl.trim()) return;

		const fullUrl = linkUrl.match(/^https?:\/\//)
			? linkUrl
			: `https://${linkUrl}`;
		const selection: Selection | null = window.getSelection();

		if (!selection || selection.rangeCount === 0) return;

		const range: Range = selection.getRangeAt(0);
		const isCollapsed: boolean = selection.isCollapsed;
		const documentFragment: DocumentFragment = range.cloneContents();
		const tempDiv: HTMLDivElement = document.createElement("div");
		tempDiv.appendChild(documentFragment.cloneNode(true));
		const selectedHtml: string = tempDiv.innerHTML;

		const link: HTMLAnchorElement = document.createElement("a");
		link.href = fullUrl;
		link.style.color = "blue";
		link.style.textDecoration = "underline";
		link.target = "_blank";
		link.rel = "noopener noreferrer";

		if (isCollapsed || !selectedHtml) {
			link.textContent = fullUrl;
			range.insertNode(link);
		} else {
			link.innerHTML = selectedHtml;
			range.deleteContents();
			range.insertNode(link);
		}

		selection.removeAllRanges();
		const newRange: Range = document.createRange();
		newRange.selectNodeContents(link);
		selection.addRange(newRange);

		if (editorRef.current) {
			const updatedContent: string = editorRef.current.innerHTML;
			setContent(updatedContent);
			if (selectedItem) {
				updateTitle(selectedItem.id, updatedContent);
			}
		}

		setLinkUrl("");
		setShowLinkInput(false);
		editorRef.current?.focus();
	};

	const handleClickOutside = (event: MouseEvent) => {
		if (
			editorRef.current &&
			toolbarRef.current &&
			!editorRef.current.contains(event.target as Node) &&
			!toolbarRef.current.contains(event.target as Node)
		) {
			setIsFocused(false);
			setShowLinkInput(false);
		}
	};

	const insertBlankAtCursor = () => {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;

		const range = sel.getRangeAt(0);
		range.deleteContents();

		const blankNode = document.createTextNode(" _____ ");
		range.insertNode(blankNode);

		range.setStartAfter(blankNode);
		range.setEndAfter(blankNode);
		sel.removeAllRanges();
		sel.addRange(range);

		if (editorRef.current) {
			const updatedContent = editorRef.current.innerHTML;
			setContent(updatedContent);
			if (selectedItem) {
				updateTitle(selectedItem.id, updatedContent);
			}
		}

		editorRef.current?.focus();
	};

	useEffect(() => {
		document.addEventListener("mousedown", handleClickOutside);
		return () =>
			document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	useEffect(() => {
		const rawTitle =
			selectedItem?.title || (selectedItem as any)?.question_text || "";
		const cleanHtml = rawTitle ? DOMPurify.sanitize(rawTitle) : "";
		setContent(cleanHtml);
		lastSavedContent.current = cleanHtml || "";
		if (editorRef.current) {
			editorRef.current.innerHTML = cleanHtml || "";
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedItem?.id]);

	const stripHtml = (html: string) => {
		return html
			.replace(/<[^>]*>/g, "")
			.replace(/&nbsp;/g, "")
			.trim();
	};

	const persistSurveyTitle = async (newContent: string) => {
		if (!surveyContext || style !== "survey" || !selectedItem) return;

		const plainText = stripHtml(newContent);
		if (!plainText) return;
		if (newContent === lastSavedContent.current) return;

		try {
			const surveyQuestion = selectedItem as any;
			// Prepare options payload. For 'scales' include min/max inside each option.
			let optionsPayload = surveyQuestion.options || [];
			if (
				surveyQuestion.question_type === "scales" ||
				surveyQuestion.question_type === "rating"
			) {
				const minNumberVal =
					surveyQuestion.minNumber ??
					surveyQuestion.task_data?.minNumber ??
					1;
				const maxNumberVal =
					surveyQuestion.maxNumber ??
					surveyQuestion.task_data?.maxNumber ??
					5;
				// send only a single options object containing min/max
				optionsPayload = [
					{
						minNumber: minNumberVal,
						maxNumber: maxNumberVal,
					},
				];
			}

			await surveyContext.api.updateQuestion(selectedItem.id, {
				survey_id: parseInt(surveyQuestion.survey_id || "0"),
				page_id: surveyQuestion.page_id || 1,
				serial_number: surveyQuestion.serial_number,
				question_text: newContent,
				question_type: surveyQuestion.question_type,
				options: optionsPayload,
				is_required: surveyQuestion.is_required ?? false,
				has_conditional_logic:
					surveyQuestion.has_conditional_logic ?? false,
				conditional_parent_type:
					surveyQuestion.conditional_parent_type ?? null,
				conditional_question_id:
					surveyQuestion.conditional_question_id ?? null,
				conditional_page_id: surveyQuestion.conditional_page_id ?? null,
				conditional_value: surveyQuestion.conditional_value ?? null,
				conditional_operator:
					surveyQuestion.conditional_operator ?? "equals",
				display_type: surveyQuestion.display_type ?? "default",
				display_conditions: surveyQuestion.display_conditions ?? null,
			});
			await surveyContext.api.fetchSurveyDetails(
				surveyQuestion.survey_id || 0,
			);
			lastSavedContent.current = newContent;
		} catch (error) {
			console.error("Failed to update question title on server:", error);
		}
	};

	const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
		const newContent = (e.target as HTMLDivElement).innerHTML;
		setContent(newContent);

		if (typingTimeout.current) {
			clearTimeout(typingTimeout.current);
		}

		typingTimeout.current = setTimeout(async () => {
			if (selectedItem && newContent !== selectedItem.title) {
				updateTitle(selectedItem.id, newContent);
				await persistSurveyTitle(newContent);
			}
		}, 600);
	};

	const handleBlur = async () => {
		if (typingTimeout.current) {
			clearTimeout(typingTimeout.current);
		}
		const latestContent = editorRef.current?.innerHTML ?? content;
		if (selectedItem && latestContent !== selectedItem.title) {
			updateTitle(selectedItem.id, latestContent);
			await persistSurveyTitle(latestContent);
		}
	};
	<style jsx global>{`
		[contenteditable][data-placeholder]:empty:before {
			content: attr(data-placeholder);
			color: #9ca3af; /* slate-400 */
			pointer-events: none;
		}
	`}</style>;

	useEffect(() => {
		return () => {
			if (typingTimeout.current) {
				clearTimeout(typingTimeout.current);
			}
		};
	}, []);

	const hasTitleContent =
		stripHtml(selectedItem?.title || "") !== "" ||
		stripHtml((selectedItem as any)?.question_text || "") !== "";
	console.log(palceholaderText && style === "quest" && !hasTitleContent);

	// Add this helper in your component (outside of JSX)
	const insertPlainTextAtCursor = (text: string) => {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;

		// Normalize whitespace/newlines from Word/HTML pastes
		const normalized = text
			.replace(/\r\n|\n|\r/g, " ")
			.replace(/\s+/g, " ");

		const range = sel.getRangeAt(0);
		// Remove any selected content first
		range.deleteContents();

		const textNode = document.createTextNode(normalized);
		range.insertNode(textNode);

		// Move caret to the end of the inserted text
		range.setStartAfter(textNode);
		range.setEndAfter(textNode);
		sel.removeAllRanges();
		sel.addRange(range);

		if (editorRef.current) {
			const updatedContent = editorRef.current.innerHTML;
			setContent(updatedContent);
			if (selectedItem) {
				dispatch(
					updateQuizTitle({
						id: selectedItem.id,
						title: updatedContent,
					}),
				);
			}
		}
	};

	// Handle paste as plain text
	const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
		e.preventDefault();
		const plain = e.clipboardData.getData("text/plain") || "";
		insertPlainTextAtCursor(plain);
		// Ensure focus stays on editor
		editorRef.current?.focus();
	};

	return (
		<div className="relative">
			<div
				ref={editorRef}
				className={`${
					style === "quest"
						? " w-full min-h-[20px] p-3  border text-xl rounded-lg mb-2 focus:outline-none"
						: "w-full min-h-[20px] p-3 border border-primary bg-orange-100 text-xl rounded-lg mb-2 focus:outline-none"
				} empty:before:pointer-events-none empty:before:text-gray-400 empty:before:content-[attr(data-placeholder)]`}
				contentEditable
				onFocus={() => setIsFocused(true)}
				onBlur={handleBlur}
				// suppressContentEditableWarning={true}
				suppressContentEditableWarning
				onInput={handleInput}
				onPaste={handlePaste}
				data-placeholder="Enter question"
				onClick={(e) => {
					const target = e.target as HTMLElement;

					if (target.tagName === "A") {
						e.preventDefault();
						window.open(
							target.getAttribute("href") || "",
							"_blank",
						);
					}
				}}
			>
				<SafeHTMLRenderer
					html={
						selectedItem?.title ||
						(selectedItem as any)?.question_text ||
						""
					}
					wordLimit={70}
					className="text-inherit"
				/>
			</div>

			{/* Floats over the content below: an in-flow toolbar collapsing on blur moved
			    everything up under the pointer, so the next click (e.g. on an answer) was lost. */}
			{isFocused && (
				<div
					ref={toolbarRef}
					className="absolute left-0 right-0 top-full z-20 -mt-1 flex flex-wrap items-center gap-2 bg-white p-2 border rounded-md shadow"
				>
					{/* ######## Font Size ######## */}
					<select
						onChange={(e) => applyStyle("fontSize", e.target.value)}
						className="text-xs p-1 rounded bg-white"
					>
						{FONT_SIZES.map((option, index) => (
							<option
								key={option.value}
								value={(index + 1).toString()}
							>
								{option.label}
							</option>
						))}
					</select>

					{/* ######## Color ######## */}
					<input
						type="color"
						onChange={(e) =>
							applyStyle("foreColor", e.target.value)
						}
						className="w-6 h-6 border rounded-full cursor-pointer"
					/>

					{/* ######## Bold ######## */}
					<button
						onClick={() => applyStyle("bold")}
						className="p-2 border rounded-md hover:bg-blue-100"
					>
						<FaBold />
					</button>

					{/* ######## Italic ######## */}
					<button
						onClick={() => applyStyle("italic")}
						className="p-2 border rounded-md hover:bg-blue-100"
					>
						<FaItalic />
					</button>

					{/* ######## Underline ######## */}
					<button
						onClick={() => applyStyle("underline")}
						className="p-2 border rounded-md hover:bg-blue-100"
					>
						<FaUnderline />
					</button>

					{/* ######## Link ######## */}
					<button
						onClick={handleLink}
						className="p-2 border rounded-md hover:bg-blue-100 hidden"
					>
						<FaLink />
					</button>

					{/* ######## Insert Blank ######## */}
					{selectedItem?.key === "fillintheblanks" && (
						<button
							onClick={insertBlankAtCursor}
							className="p-2 border rounded-md hover:bg-blue-100"
						>
							<BiDotsHorizontalRounded />
						</button>
					)}

					{/* ######## Link Input  ######## */}
					{showLinkInput && (
						<div className="flex items-center gap-2">
							<input
								type="url"
								value={linkUrl}
								onChange={(e) => setLinkUrl(e.target.value)}
								onKeyDown={(e) =>
									e.key === "Enter" && applyLink()
								}
								placeholder="https://example.com"
								className="text-xs p-1 border rounded-md"
								autoFocus
							/>
							<button
								onClick={applyLink}
								className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
							>
								Apply
							</button>
							<button
								onClick={() => {
									setShowLinkInput(false);
									setLinkUrl("");
									editorRef.current?.focus();
								}}
								className="text-xs px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
							>
								Cancel
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
};
export default StylableInput;
