/* eslint-disable @typescript-eslint/no-explicit-any */
// components/editor/TextImageBlock.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ContentBlock } from "@/types/content";
import { FileLibraryPicker } from "@/features/file-library/components/FileLibraryPicker";
import { emitLibraryChange } from "@/features/file-library/lib/events";
import {
	FolderOpen,
	Upload,
	X,
	Bold,
	Italic,
	Underline as UnderlineIcon,
	// Heading1,
	// Heading2,
	// Heading3,
	List,
	ListOrdered,
	Quote,
	Code,
	AlignLeft,
	AlignCenter,
	AlignRight,
	// Pilcrow,
} from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Heading from "@tiptap/extension-heading";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import Blockquote from "@tiptap/extension-blockquote";
import CodeBlock from "@tiptap/extension-code-block";
import axiosInstance from "@/utils/axiosInstance";
import { useDispatch, useSelector } from "react-redux";
import {
	// updateLimitedTimeTitle,
	contantData,
} from "@/features/quiz/store/quizItems/quizSlice";

interface TextImageBlockProps {
	block: ContentBlock;
	isActive: boolean;
	onUpdate: (updates: Partial<ContentBlock>) => void;
	onImageUpload: (file: File) => void;
	onRemoveImage: () => void;
}

export function TextImageBlock({
	block,
	isActive,
	onUpdate,
}: // onImageUpload,
// onRemoveImage,
TextImageBlockProps) {
	const dispatch = useDispatch();

	const [uploading, setUploading] = useState(false);
	const [progress, setProgress] = useState<number>(0);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);

	const { selectedItem } = useSelector((s: any) => s.quiz);

	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				heading: false,
				codeBlock: false,
			}),
			Heading.configure({
				levels: [1, 2, 3],
			}),
			Underline,
			TextAlign.configure({
				types: ["heading", "paragraph"],
			}),
			BulletList.configure({
				HTMLAttributes: {
					class: "list-disc list-outside ml-6",
				},
			}),
			OrderedList.configure({
				HTMLAttributes: {
					class: "list-decimal list-outside ml-6",
				},
			}),
			Blockquote.configure({
				HTMLAttributes: {
					class: "border-l-4 border-gray-300 pl-4 italic my-4",
				},
			}),
			CodeBlock.configure({
				HTMLAttributes: {
					class: "bg-gray-100 dark:bg-gray-800 rounded p-4 font-mono text-sm my-4",
				},
			}),
			Placeholder.configure({
				placeholder: "Start writing...",
			}),
		],
		content: selectedItem?.contant_title,
		onUpdate: ({ editor }) => {
			const textdata = editor.getHTML();
			dispatch(
				contantData({
					id: selectedItem?.id,
					contant_title: textdata,
				})
			);

			onUpdate({ content: editor.getHTML() });
		},
		editorProps: {
			attributes: {
				class: "prose prose-lg dark:prose-invert max-w-none focus:outline-none min-h-[200px] p-4",
			},
		},
		immediatelyRender: false,
	});

	useEffect(() => {
		editor?.commands.setContent(selectedItem?.contant_title as string);
	}, [selectedItem?.contant_title, editor]);

	const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		setError(null);
		const file = e.target.files?.[0];
		if (!file) return;
		// Build form data as you described
		const formData = new FormData();
		formData.append("file", file);
		formData.append("name", file.name);

		try {
			setUploading(true);
			setProgress(0);

			const res = await axiosInstance.post("/files/store", formData, {
				headers: {
					"Content-Type": "multipart/form-data",
				},
				onUploadProgress: (evt) => {
					if (!evt.total) return;
					const pct = Math.round((evt.loaded * 100) / evt.total);
					setProgress(pct);
				},
			});
			const fileObj = res.data?.data?.file;
			emitLibraryChange();
			// setFileData(fileObj);
			dispatch(
				contantData({
					id: selectedItem?.id,
					image_url: fileObj,
				})
			);

			// //console.log("Uploaded:", res.data);
		} catch (err: any) {
			setError(err?.response?.data?.message || "Upload failed");
		} finally {
			setUploading(false);
			// If you want to allow selecting the same file again:
			if (inputRef.current) inputRef.current.value = "";
		}
	};

	const removeImages = async () => {
		// await axiosInstance.delete(
		// 	`/files/delete/${selectedItem?.image_url?.path}`
		// );
		dispatch(
			contantData({
				id: selectedItem?.id,
				image_url: "",
			})
		);
	};

	// Update editor content when block content changes externally
	useEffect(() => {
		if (editor && block.content !== editor.getHTML()) {
			editor.commands.setContent(block.content);
		}
	}, [block.content, editor]);

	if (!editor) {
		return null;
	}

	return (
		<div
			className={cn(
				"grid grid-cols-1 lg:grid-cols-2 gap-6 items-start",
				block.imagePosition === "right" ? "lg:[direction:rtl]" : ""
			)}
		>
			{/* Image Section */}
			<div
				className={cn(
					"w-full",
					block.imagePosition === "right" ? "lg:[direction:ltr]" : ""
				)}
			>
				{selectedItem?.image_url?.path ? (
					<div className="relative">
						<img
							src={selectedItem?.image_url?.path}
							alt="Content"
							className="w-[100px]  object-cover rounded-lg"
						/>
						{isActive && (
							<button
								onClick={removeImages}
								className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
							>
								<X className="h-4 w-4" />
							</button>
						)}
					</div>
				) : (
					<div className="relative">
						<label
							className={cn(
								"flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer transition-colors",
								isActive
									? "border-slate-300 dark:border-slate-600 hover:border-primary"
									: "border-transparent hover:border-slate-300 dark:hover:border-slate-600"
							)}
						>
							<Upload className="h-8 w-8 text-slate-400 mb-2" />
							<span className="text-sm text-slate-500 dark:text-slate-400">
								{uploading ? `Uploading… ${progress}%` : "Click to upload image"}
							</span>
							{error ? (
								<span role="alert" className="mt-2 max-w-xs px-3 text-center text-xs text-red-600">
									{error}
								</span>
							) : null}
							<input
								ref={inputRef}
								type="file"
								accept="image/png,image/jpeg,image/gif,image/webp"
								onChange={handleChange}
								className="hidden"
								disabled={uploading}
							/>
						</label>
						{isActive && !uploading ? (
							<button
								type="button"
								onClick={() => setPickerOpen(true)}
								className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-primary shadow-sm hover:border-primary"
							>
								<FolderOpen className="h-3.5 w-3.5" aria-hidden />
								Choose from My Files
							</button>
						) : null}
					</div>
				)}
				<FileLibraryPicker
					open={pickerOpen}
					onClose={() => setPickerOpen(false)}
					accept="image"
					confirmLabel="Use this image"
					onSelect={(file) => {
						setError(null);
						// Same shape as a /files/store upload, which this block stores whole.
						const picked: any = { id: file.id, name: file.name, path: file.url };
						dispatch(
							contantData({
								id: selectedItem?.id,
								image_url: picked,
							})
						);
						setPickerOpen(false);
					}}
				/>
			</div>

			{/* Text Section with Tiptap Editor */}
			<div
				className={cn(
					"w-full",
					block.imagePosition === "right" ? "lg:[direction:ltr]" : ""
				)}
			>
				{isActive && (
					<div className="flex flex-wrap items-center gap-1 mb-2 p-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
						{/* Text Type */}
						{/* <select
							value={
								editor.isActive("heading", { level: 1 })
									? "h1"
									: editor.isActive("heading", { level: 2 })
									? "h2"
									: editor.isActive("heading", { level: 3 })
									? "h3"
									: "p"
							}
							onChange={(e) => {
								const value = e.target.value;
								if (value === "p") {
									editor.chain().focus().setParagraph().run();
								} else if (value === "h1") {
									editor
										.chain()
										.focus()
										.setHeading({ level: 1 })
										.run();
								} else if (value === "h2") {
									editor
										.chain()
										.focus()
										.setHeading({ level: 2 })
										.run();
								} else if (value === "h3") {
									editor
										.chain()
										.focus()
										.setHeading({ level: 3 })
										.run();
								}
							}}
							className="p-1 border rounded bg-white dark:bg-slate-600 text-sm"
						>
							<option value="p">
								<div className="flex items-center gap-1">
									<Pilcrow className="h-3 w-3" />
									<span>Text</span>
								</div>
							</option>
							<option value="h1">
								<div className="flex items-center gap-1">
									<Heading1 className="h-3 w-3" />
									<span>H1</span>
								</div>
							</option>
							<option value="h2">
								<div className="flex items-center gap-1">
									<Heading2 className="h-3 w-3" />
									<span>H2</span>
								</div>
							</option>
							<option value="h3">
								<div className="flex items-center gap-1">
									<Heading3 className="h-3 w-3" />
									<span>H3</span>
								</div>
							</option>
						</select> */}
						,
						<select
							value={
								editor.isActive("heading", { level: 1 })
									? "h1"
									: editor.isActive("heading", { level: 2 })
									? "h2"
									: editor.isActive("heading", { level: 3 })
									? "h3"
									: "p"
							}
							onChange={(e) => {
								const value = e.target.value;
								if (value === "p") {
									editor.chain().focus().setParagraph().run();
								} else if (value === "h1") {
									editor
										.chain()
										.focus()
										.setHeading({ level: 1 })
										.run();
								} else if (value === "h2") {
									editor
										.chain()
										.focus()
										.setHeading({ level: 2 })
										.run();
								} else if (value === "h3") {
									editor
										.chain()
										.focus()
										.setHeading({ level: 3 })
										.run();
								}
							}}
							className="p-1 border rounded bg-white dark:bg-slate-600 text-sm"
						>
							{/* TEXT ONLY — no divs/icons inside <option> */}
							<option value="p">Text</option>
							<option value="h1">H1</option>
							<option value="h2">H2</option>
							<option value="h3">H3</option>
						</select>
						{/* Formatting Buttons */}
						<div className="flex items-center gap-1 border-l border-slate-300 dark:border-slate-600 pl-2 ml-2">
							<button
								onClick={() =>
									editor.chain().focus().toggleBold().run()
								}
								className={cn(
									"p-1 rounded transition-colors",
									editor.isActive("bold")
										? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white"
										: "hover:bg-white dark:hover:bg-slate-600 text-slate-600 dark:text-slate-400"
								)}
								title="Bold"
							>
								<Bold className="h-4 w-4" />
							</button>

							<button
								onClick={() =>
									editor.chain().focus().toggleItalic().run()
								}
								className={cn(
									"p-1 rounded transition-colors",
									editor.isActive("italic")
										? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white"
										: "hover:bg-white dark:hover:bg-slate-600 text-slate-600 dark:text-slate-400"
								)}
								title="Italic"
							>
								<Italic className="h-4 w-4" />
							</button>

							<button
								onClick={() =>
									editor
										.chain()
										.focus()
										.toggleUnderline()
										.run()
								}
								className={cn(
									"p-1 rounded transition-colors",
									editor.isActive("underline")
										? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white"
										: "hover:bg-white dark:hover:bg-slate-600 text-slate-600 dark:text-slate-400"
								)}
								title="Underline"
							>
								<UnderlineIcon className="h-4 w-4" />
							</button>
						</div>
						{/* List Buttons */}
						<div className="flex items-center gap-1 border-l border-slate-300 dark:border-slate-600 pl-2 ml-2">
							<button
								onClick={() =>
									editor
										.chain()
										.focus()
										.toggleBulletList()
										.run()
								}
								className={cn(
									"p-1 rounded transition-colors",
									editor.isActive("bulletList")
										? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white"
										: "hover:bg-white dark:hover:bg-slate-600 text-slate-600 dark:text-slate-400"
								)}
								title="Bullet List"
							>
								<List className="h-4 w-4" />
							</button>

							<button
								onClick={() =>
									editor
										.chain()
										.focus()
										.toggleOrderedList()
										.run()
								}
								className={cn(
									"p-1 rounded transition-colors",
									editor.isActive("orderedList")
										? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white"
										: "hover:bg-white dark:hover:bg-slate-600 text-slate-600 dark:text-slate-400"
								)}
								title="Numbered List"
							>
								<ListOrdered className="h-4 w-4" />
							</button>
						</div>
						{/* Block Elements */}
						<div className="flex items-center gap-1 border-l border-slate-300 dark:border-slate-600 pl-2 ml-2">
							<button
								onClick={() =>
									editor
										.chain()
										.focus()
										.toggleBlockquote()
										.run()
								}
								className={cn(
									"p-1 rounded transition-colors",
									editor.isActive("blockquote")
										? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white"
										: "hover:bg-white dark:hover:bg-slate-600 text-slate-600 dark:text-slate-400"
								)}
								title="Quote"
							>
								<Quote className="h-4 w-4" />
							</button>

							<button
								onClick={() =>
									editor
										.chain()
										.focus()
										.toggleCodeBlock()
										.run()
								}
								className={cn(
									"p-1 rounded transition-colors",
									editor.isActive("codeBlock")
										? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white"
										: "hover:bg-white dark:hover:bg-slate-600 text-slate-600 dark:text-slate-400"
								)}
								title="Code Block"
							>
								<Code className="h-4 w-4" />
							</button>
						</div>
						{/* Alignment Buttons */}
						<div className="flex items-center gap-1 border-l border-slate-300 dark:border-slate-600 pl-2 ml-2">
							<button
								onClick={() =>
									editor
										.chain()
										.focus()
										.setTextAlign("left")
										.run()
								}
								className={cn(
									"p-1 rounded transition-colors",
									editor.isActive({ textAlign: "left" })
										? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white"
										: "hover:bg-white dark:hover:bg-slate-600 text-slate-600 dark:text-slate-400"
								)}
								title="Align Left"
							>
								<AlignLeft className="h-4 w-4" />
							</button>
							<button
								onClick={() =>
									editor
										.chain()
										.focus()
										.setTextAlign("center")
										.run()
								}
								className={cn(
									"p-1 rounded transition-colors",
									editor.isActive({ textAlign: "center" })
										? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white"
										: "hover:bg-white dark:hover:bg-slate-600 text-slate-600 dark:text-slate-400"
								)}
								title="Align Center"
							>
								<AlignCenter className="h-4 w-4" />
							</button>
							<button
								onClick={() =>
									editor
										.chain()
										.focus()
										.setTextAlign("right")
										.run()
								}
								className={cn(
									"p-1 rounded transition-colors",
									editor.isActive({ textAlign: "right" })
										? "bg-white dark:bg-slate-600 text-slate-900 dark:text-white"
										: "hover:bg-white dark:hover:bg-slate-600 text-slate-600 dark:text-slate-400"
								)}
								title="Align Right"
							>
								<AlignRight className="h-4 w-4" />
							</button>
						</div>
					</div>
				)}

				<div
					className={cn(
						"rounded-lg transition-all",
						isActive
							? "border-2 border-slate-300 dark:border-slate-600"
							: "border border-transparent"
					)}
				>
					<EditorContent
						editor={editor}
						className={cn(
							"min-h-[200px]",
							!isActive && "cursor-pointer"
						)}
					/>
				</div>
			</div>
		</div>
	);
}
