"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	Bold,
	Code,
	Italic,
	Link2,
	List,
	ListOrdered,
	Minus,
	Quote,
	Redo2,
	SquareCode,
	Strikethrough,
	Underline as UnderlineIcon,
	Undo2,
	type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RichTextDoc } from "@/features/deck/types";
import type { EditorProps } from "../types";
import { CharCount, SegmentedField } from "../shared";
import { SlideTitleField, fieldError } from "../shared/contentKit";
import { MAX_BODY_TEXT, bodyLimitProblem, bodyStats, canonicalBody, isSafeHref, normaliseBody, type BodyStats } from "./body";

// Paragraph Editor: a TipTap editor whose schema is EXACTLY what
// ParagraphSlideType::validateBody() accepts: StarterKit's paragraph,
// heading (1–3), blockquote, bullet / ordered list, code block, horizontal
// rule and hard break; marks bold, italic, underline, strike, code and link
// (http(s) / mailto only); textAlign on paragraphs / headings. Anything else
// pasted in is dropped by the schema. The JSON is normalised like the server
// does (body.ts) and sent as `body` in a debounced PATCH, flushed on blur and
// on unmount. Over-limit text is not sent (it would only come back as a 422).

const SAVE_DEBOUNCE_MS = 600;

const BLOCK_STYLES = [
	{ value: "paragraph", label: "Paragraph" },
	{ value: "h1", label: "Heading 1" },
	{ value: "h2", label: "Heading 2" },
	{ value: "h3", label: "Heading 3" },
] as const;

type BlockStyle = (typeof BLOCK_STYLES)[number]["value"];

/** "example.com" → "https://example.com", "me@example.com" → "mailto:me@example.com". */
function completeHref(input: string): string {
	const value = input.trim();
	if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
	if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value)) return `mailto:${value}`;
	return `https://${value}`;
}

export function ParagraphEditor({ slide, onChange, errors, disabled }: EditorProps<"paragraph">) {
	const ids = useId();
	const counterId = `${ids}-count`;
	const errorId = `${ids}-error`;

	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const timer = useRef<number | null>(null);
	const pendingDoc = useRef<RichTextDoc | null>(null);
	const lastSynced = useRef(canonicalBody(normaliseBody(slide.body)));
	const [stats, setStats] = useState<BodyStats>(() => bodyStats(normaliseBody(slide.body)));

	const flush = useCallback(() => {
		if (timer.current !== null) {
			window.clearTimeout(timer.current);
			timer.current = null;
		}
		const doc = pendingDoc.current;
		pendingDoc.current = null;
		if (doc) onChangeRef.current({ body: doc });
	}, []);

	const cancelPending = () => {
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = null;
		pendingDoc.current = null;
	};

	const onEditorUpdate = (editor: Editor) => {
		const doc = normaliseBody(editor.getJSON());
		const next = bodyStats(doc);
		setStats(next);
		const key = canonicalBody(doc);
		if (key === lastSynced.current || bodyLimitProblem(next)) {
			cancelPending();
			return;
		}
		lastSynced.current = key;
		pendingDoc.current = doc;
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
	};
	const onEditorUpdateRef = useRef(onEditorUpdate);
	onEditorUpdateRef.current = onEditorUpdate;

	const editor = useEditor(
		{
			immediatelyRender: false,
			editable: !disabled,
			extensions: [
				StarterKit.configure({
					heading: { levels: [1, 2, 3] },
					link: {
						openOnClick: false,
						autolink: true,
						linkOnPaste: true,
						defaultProtocol: "https",
						isAllowedUri: (url) => isSafeHref(url),
						shouldAutoLink: (url) => isSafeHref(completeHref(url)),
					},
					// It would append an empty paragraph after a trailing list, i.e. a PATCH nobody typed.
					trailingNode: false,
				}),
				TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
			],
			content: normaliseBody(slide.body) as JSONContent,
			onUpdate: ({ editor: instance }) => onEditorUpdateRef.current(instance),
			onBlur: () => flush(),
			editorProps: {
				attributes: {
					"aria-label": "Paragraph text",
					"aria-multiline": "true",
					"aria-describedby": `${counterId} ${errorId}`,
					class: cn(
						"min-h-40 max-h-[26rem] overflow-y-auto px-3 py-2 text-sm leading-relaxed text-dark outline-none dark:text-white",
						"[&_p]:my-1 [&_h1]:my-1.5 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:my-1.5 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:my-1 [&_h3]:font-semibold",
						"[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5",
						"[&_blockquote]:my-1 [&_blockquote]:border-l-4 [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_blockquote]:italic",
						"[&_pre]:my-1 [&_pre]:whitespace-pre-wrap [&_pre]:rounded [&_pre]:bg-gray-2 [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-xs dark:[&_pre]:bg-dark-3",
						"[&_code]:font-mono [&_a]:text-primary-700 [&_a]:underline dark:[&_a]:text-primary-light [&_hr]:my-3 [&_hr]:border-stroke dark:[&_hr]:border-dark-3"
					),
				},
			},
		},
		[]
	);

	// Outside changes (another tab, AI rewrite, server normalisation) replace
	// the content unless the author is typing; our own echo is ignored.
	useEffect(() => {
		if (!editor || editor.isDestroyed) return;
		const doc = normaliseBody(slide.body);
		const key = canonicalBody(doc);
		if (key === lastSynced.current || editor.isFocused || timer.current !== null) return;
		lastSynced.current = key;
		editor.commands.setContent(doc as JSONContent, { emitUpdate: false });
		setStats(bodyStats(doc));
	}, [editor, slide.body]);

	useEffect(() => {
		if (editor && !editor.isDestroyed) editor.setEditable(!disabled, false);
	}, [editor, disabled]);

	// Save what was typed when switching slides mid-debounce.
	useEffect(() => () => flush(), [flush]);

	const limitProblem = bodyLimitProblem(stats);
	const serverError = fieldError(errors, "body");
	const message = limitProblem ?? serverError;

	return (
		<div className="flex flex-col gap-4">
			<SlideTitleField<"paragraph">
				label="Title (optional)"
				placeholder="Shown above the text"
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
			/>

			<div className="flex flex-col gap-1.5">
				<div className="flex items-baseline justify-between gap-2">
					<span className="text-sm font-medium text-dark dark:text-white">Text</span>
					<span id={counterId}>
						<CharCount length={stats.chars} max={MAX_BODY_TEXT} />
					</span>
				</div>
				<div
					className={cn(
						"overflow-hidden rounded-lg border bg-white transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40 dark:bg-dark-2",
						message ? "border-red" : "border-stroke dark:border-dark-3",
						disabled && "opacity-60"
					)}
				>
					<Toolbar editor={editor} disabled={!!disabled} />
					<div className="relative">
						<EditorContent editor={editor} />
						<EmptyHint editor={editor} />
					</div>
				</div>
				{message ? (
					<p id={errorId} role="alert" className="text-xs font-medium text-[#B42318] dark:text-red-light">
						{message}
					</p>
				) : (
					<p id={errorId} className="text-xs text-dark-5 dark:text-dark-6">
						Paste or type; links must start with http(s):// or mailto:.
					</p>
				)}
			</div>

			<SegmentedField<"left" | "center" | "right">
				label="Alignment"
				value={slide.config.align ?? "left"}
				options={[
					{ value: "left", label: "Left", icon: AlignLeft },
					{ value: "center", label: "Center", icon: AlignCenter },
					{ value: "right", label: "Right", icon: AlignRight },
				]}
				onChange={(align) => onChange({ config: { align } })}
				error={fieldError(errors, "align")}
				disabled={disabled}
			/>
			<SegmentedField<"small" | "medium" | "large">
				label="Text size"
				value={slide.config.text_size ?? "medium"}
				options={[
					{ value: "small", label: "Small" },
					{ value: "medium", label: "Medium" },
					{ value: "large", label: "Large" },
				]}
				onChange={(text_size) => onChange({ config: { text_size } })}
				error={fieldError(errors, "text_size")}
				disabled={disabled}
			/>
		</div>
	);
}

/* ------------------------------------------------------------------ */

function EmptyHint({ editor }: { editor: Editor | null }) {
	const empty = useEditorState({ editor, selector: ({ editor: instance }) => instance?.isEmpty ?? true });
	if (!empty) return null;
	return (
		<span aria-hidden className="pointer-events-none absolute left-3 top-3 text-sm text-dark-6">
			Write your text…
		</span>
	);
}

function Toolbar({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
	const [linkOpen, setLinkOpen] = useState(false);
	const state = useEditorState({
		editor,
		selector: ({ editor: instance }) =>
			instance
				? {
						bold: instance.isActive("bold"),
						italic: instance.isActive("italic"),
						underline: instance.isActive("underline"),
						strike: instance.isActive("strike"),
						code: instance.isActive("code"),
						link: instance.isActive("link"),
						bulletList: instance.isActive("bulletList"),
						orderedList: instance.isActive("orderedList"),
						blockquote: instance.isActive("blockquote"),
						codeBlock: instance.isActive("codeBlock"),
						block: (instance.isActive("heading", { level: 1 })
							? "h1"
							: instance.isActive("heading", { level: 2 })
								? "h2"
								: instance.isActive("heading", { level: 3 })
									? "h3"
									: "paragraph") as BlockStyle,
						canUndo: instance.can().undo(),
						canRedo: instance.can().redo(),
					}
				: null,
	});

	const off = disabled || !editor || !state;
	const run = (command: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => {
		if (!editor) return;
		command(editor.chain().focus()).run();
	};

	const setBlock = (value: BlockStyle) => {
		if (value === "paragraph") run((chain) => chain.setParagraph());
		else run((chain) => chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }));
	};

	return (
		<div className="border-b border-stroke bg-gray-1 dark:border-dark-3 dark:bg-dark-3/40">
			<div role="toolbar" aria-label="Text formatting" className="flex flex-wrap items-center gap-0.5 p-1">
				<select
					aria-label="Text style"
					value={state?.block ?? "paragraph"}
					disabled={off || !!state?.codeBlock}
					onChange={(event) => setBlock(event.target.value as BlockStyle)}
					className="mr-1 min-h-11 rounded-md border border-stroke bg-white px-2 text-sm text-dark outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
				>
					{BLOCK_STYLES.map((style) => (
						<option key={style.value} value={style.value}>
							{style.label}
						</option>
					))}
				</select>
				<ToolButton icon={Bold} label="Bold" shortcut="Ctrl+B" active={state?.bold} disabled={off} onClick={() => run((c) => c.toggleBold())} />
				<ToolButton icon={Italic} label="Italic" shortcut="Ctrl+I" active={state?.italic} disabled={off} onClick={() => run((c) => c.toggleItalic())} />
				<ToolButton icon={UnderlineIcon} label="Underline" shortcut="Ctrl+U" active={state?.underline} disabled={off} onClick={() => run((c) => c.toggleUnderline())} />
				<ToolButton icon={Strikethrough} label="Strikethrough" active={state?.strike} disabled={off} onClick={() => run((c) => c.toggleStrike())} />
				<ToolButton icon={Code} label="Inline code" active={state?.code} disabled={off} onClick={() => run((c) => c.toggleCode())} />
				<ToolButton
					icon={Link2}
					label="Link"
					active={state?.link || linkOpen}
					expanded={linkOpen}
					disabled={off || !!state?.codeBlock}
					onClick={() => setLinkOpen((open) => !open)}
				/>
				<Divider />
				<ToolButton icon={List} label="Bulleted list" active={state?.bulletList} disabled={off} onClick={() => run((c) => c.toggleBulletList())} />
				<ToolButton icon={ListOrdered} label="Numbered list" active={state?.orderedList} disabled={off} onClick={() => run((c) => c.toggleOrderedList())} />
				<ToolButton icon={Quote} label="Quote" active={state?.blockquote} disabled={off} onClick={() => run((c) => c.toggleBlockquote())} />
				<ToolButton icon={SquareCode} label="Code block" active={state?.codeBlock} disabled={off} onClick={() => run((c) => c.toggleCodeBlock())} />
				<ToolButton icon={Minus} label="Divider" disabled={off} onClick={() => run((c) => c.setHorizontalRule())} />
				<Divider />
				<ToolButton icon={Undo2} label="Undo" shortcut="Ctrl+Z" disabled={off || !state?.canUndo} onClick={() => run((c) => c.undo())} />
				<ToolButton icon={Redo2} label="Redo" shortcut="Ctrl+Shift+Z" disabled={off || !state?.canRedo} onClick={() => run((c) => c.redo())} />
			</div>
			{linkOpen && editor ? <LinkForm editor={editor} onClose={() => setLinkOpen(false)} /> : null}
		</div>
	);
}

function Divider() {
	return <span aria-hidden className="mx-0.5 h-6 w-px bg-stroke dark:bg-dark-3" />;
}

function ToolButton({
	icon: Icon,
	label,
	shortcut,
	active,
	expanded,
	disabled,
	onClick,
}: {
	icon: LucideIcon;
	label: string;
	shortcut?: string;
	active?: boolean;
	expanded?: boolean;
	disabled?: boolean;
	onClick(): void;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={expanded === undefined ? !!active : undefined}
			aria-expanded={expanded}
			title={shortcut ? `${label} (${shortcut})` : label}
			disabled={disabled}
			// Keep the editor selection: focus would otherwise move to the button first.
			onMouseDown={(event) => event.preventDefault()}
			onClick={onClick}
			className={cn(
				"flex h-11 w-11 items-center justify-center rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40",
				active ? "bg-primary/15 text-primary-700 dark:text-primary-light" : "text-dark-4 hover:bg-gray-2 hover:text-dark dark:text-dark-6 dark:hover:bg-dark-3 dark:hover:text-white"
			)}
		>
			<Icon className="h-4 w-4" aria-hidden />
		</button>
	);
}

function LinkForm({ editor, onClose }: { editor: Editor; onClose(): void }) {
	const initial = (editor.getAttributes("link").href as string | undefined) ?? "";
	const [value, setValue] = useState(initial);
	const [problem, setProblem] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const hasLink = initial !== "";

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const apply = () => {
		if (value.trim() === "") {
			remove();
			return;
		}
		const href = completeHref(value);
		if (!isSafeHref(href)) {
			setProblem("Use a web address (https://…) or an email address.");
			return;
		}
		const { empty } = editor.state.selection;
		if (empty && !editor.isActive("link")) {
			// No text selected: insert the address itself as the link text.
			editor.chain().focus().insertContent({ type: "text", text: value.trim(), marks: [{ type: "link", attrs: { href } }] }).run();
		} else {
			editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
		}
		onClose();
	};

	const remove = () => {
		editor.chain().focus().extendMarkRange("link").unsetLink().run();
		onClose();
	};

	return (
		// A div, not a <form>: the inspector may itself sit inside a form.
		<div role="group" aria-label="Link" className="flex flex-wrap items-start gap-2 border-t border-stroke p-2 dark:border-dark-3">
			<label className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="sr-only">Link address</span>
				<input
					ref={inputRef}
					type="text"
					inputMode="url"
					value={value}
					maxLength={2048}
					placeholder="https://example.com or name@example.com"
					aria-invalid={problem ? true : undefined}
					onChange={(event) => {
						setValue(event.target.value);
						setProblem(null);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							apply();
						} else if (event.key === "Escape") {
							event.preventDefault();
							onClose();
							editor.commands.focus();
						}
					}}
					className="min-h-11 w-full rounded-md border border-stroke bg-white px-3 text-sm text-dark outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
				/>
				{problem ? (
					<span role="alert" className="text-xs font-medium text-[#B42318] dark:text-red-light">
						{problem}
					</span>
				) : null}
			</label>
			<ActionButton onClick={apply} primary>
				Apply
			</ActionButton>
			{hasLink ? <ActionButton onClick={remove}>Remove</ActionButton> : null}
			<ActionButton onClick={onClose}>Cancel</ActionButton>
		</div>
	);
}

function ActionButton({ children, onClick, primary = false }: { children: ReactNode; onClick(): void; primary?: boolean }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"min-h-11 rounded-md px-3 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40",
				primary ? "bg-primary text-dark hover:bg-primary-500" : "text-dark-4 hover:bg-gray-2 dark:text-dark-6 dark:hover:bg-dark-3"
			)}
		>
			{children}
		</button>
	);
}
