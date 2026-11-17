"use client";

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import {
	DndContext,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { cn } from "@/lib/utils";
import { CharCount } from "../shared";
import { fieldError } from "../shared/contentKit";

// Editor for config.items of bullets / numbered slides. These items are a
// plain string list in config (BulletsSlideType: 1..20 entries, single line
// ≤ 200, '' allowed), NOT slide options, so OptionListEditor (which calls the
// options API) does not apply. The whole list is sent as one config PATCH
// (lists replace on merge): typing is debounced, add / remove / reorder
// commit at once. Rows keep client-side keys so focus and drag survive edits.

export const LIST_MIN_ITEMS = 1;
export const LIST_MAX_ITEMS = 20;
export const LIST_MAX_ITEM_LENGTH = 200;

const TYPING_DEBOUNCE_MS = 400;

interface Row {
	key: string;
	text: string;
}

/** How the server stores an item (single line, trimmed), for "is this our own echo?" checks. */
function normaliseItem(text: string): string {
	return text.replace(/[\r\n\t]+/g, " ").trim();
}

function canonical(items: string[]): string {
	return JSON.stringify(items.map(normaliseItem));
}

export interface ListItemsEditorProps {
	items: string[];
	onCommit(items: string[]): void;
	ordered: boolean;
	/** "point" / "step": button and screen reader wording. */
	noun: string;
	errors?: Record<string, string[]>;
	disabled?: boolean;
}

export function ListItemsEditor({ items, onCommit, ordered, noun, errors, disabled = false }: ListItemsEditorProps) {
	const nextKey = useRef(0);
	const makeKey = () => `item-${++nextKey.current}`;
	const [rows, setRows] = useState<Row[]>(() =>
		(items.length > 0 ? items : [""]).map((text) => ({ key: `item-${++nextKey.current}`, text }))
	);
	const [focusKey, setFocusKey] = useState<string | null>(null);

	const timer = useRef<number | null>(null);
	const latest = useRef<string[]>(rows.map((row) => row.text));
	const lastSent = useRef(canonical(items));
	const onCommitRef = useRef(onCommit);
	onCommitRef.current = onCommit;

	const flush = useCallback(() => {
		if (timer.current === null) return;
		window.clearTimeout(timer.current);
		timer.current = null;
		onCommitRef.current(latest.current);
	}, []);

	const commit = useCallback(
		(next: Row[], immediate: boolean) => {
			setRows(next);
			const texts = next.map((row) => row.text);
			latest.current = texts;
			lastSent.current = canonical(texts);
			if (timer.current !== null) window.clearTimeout(timer.current);
			timer.current = null;
			if (immediate) {
				onCommitRef.current(texts);
				return;
			}
			timer.current = window.setTimeout(() => {
				timer.current = null;
				onCommitRef.current(latest.current);
			}, TYPING_DEBOUNCE_MS);
		},
		[]
	);

	// Outside changes (server normalisation, another tab, undo) replace the
	// rows unless the author is mid-edit; our own echo is ignored.
	useEffect(() => {
		const incoming = canonical(items);
		if (incoming === lastSent.current || timer.current !== null) return;
		lastSent.current = incoming;
		latest.current = items;
		setRows((previous) =>
			(items.length > 0 ? items : [""]).map((text, index) => ({ key: previous[index]?.key ?? `item-${++nextKey.current}`, text }))
		);
	}, [items]);

	// Save what was typed if the editor unmounts mid-debounce (switching slides).
	useEffect(() => () => flush(), [flush]);

	const count = rows.length;
	const canAdd = !disabled && count < LIST_MAX_ITEMS;
	const canRemove = !disabled && count > LIST_MIN_ITEMS;
	const canReorder = !disabled && count > 1;
	const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);

	const insertAfter = (index: number, texts: string[] = [""]) => {
		const room = LIST_MAX_ITEMS - count;
		if (room <= 0 || disabled) return;
		const added = texts.slice(0, room).map((text) => ({ key: makeKey(), text: text.slice(0, LIST_MAX_ITEM_LENGTH) }));
		const next = [...rows.slice(0, index + 1), ...added, ...rows.slice(index + 1)];
		commit(next, true);
		setFocusKey(added[added.length - 1].key);
	};

	const removeAt = (index: number) => {
		if (!canRemove) return;
		const next = rows.filter((_, i) => i !== index);
		commit(next, true);
		setFocusKey(next[Math.max(0, index - 1)]?.key ?? null);
	};

	const updateAt = (index: number, text: string) => {
		commit(
			rows.map((row, i) => (i === index ? { ...row, text } : row)),
			false
		);
	};

	const onPaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
		// Pasting several lines fills several items (handy for lists copied from notes).
		const text = event.clipboardData.getData("text/plain");
		const lines = text
			.split(/\r?\n/)
			.map((line) => line.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, "").trim())
			.filter((line) => line !== "");
		if (lines.length < 2) return;
		event.preventDefault();
		const current = rows[index];
		if (current.text.trim() === "") {
			const [first, ...rest] = lines;
			const replaced = rows.map((row, i) => (i === index ? { ...row, text: first.slice(0, LIST_MAX_ITEM_LENGTH) } : row));
			const room = LIST_MAX_ITEMS - count;
			const added = rest.slice(0, room).map((line) => ({ key: makeKey(), text: line.slice(0, LIST_MAX_ITEM_LENGTH) }));
			commit([...replaced.slice(0, index + 1), ...added, ...replaced.slice(index + 1)], true);
			if (added.length > 0) setFocusKey(added[added.length - 1].key);
		} else {
			insertAfter(index, lines);
		}
	};

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	);

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		const from = rows.findIndex((row) => row.key === active.id);
		const to = rows.findIndex((row) => row.key === over.id);
		if (from < 0 || to < 0) return;
		commit(arrayMove(rows, from, to), true);
	};

	const groupError = fieldError(errors, "items");

	return (
		<section className="flex flex-col gap-2" aria-label={`${Noun}s`}>
			<div className="flex items-baseline justify-between">
				<h3 className="text-sm font-medium text-dark dark:text-white">{Noun}s</h3>
				<span className="text-xs text-dark-5 dark:text-dark-6">
					{count} / {LIST_MAX_ITEMS}
				</span>
			</div>

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				modifiers={[restrictToVerticalAxis, restrictToParentElement]}
				onDragEnd={onDragEnd}
				accessibility={{
					screenReaderInstructions: {
						draggable: "To reorder, press Space on the handle, move with the arrow keys, then press Space to drop or Escape to cancel.",
					},
				}}
			>
				<SortableContext items={rows.map((row) => row.key)} strategy={verticalListSortingStrategy}>
					<ol className="flex flex-col gap-2">
						{rows.map((row, index) => (
							<ItemRow
								key={row.key}
								row={row}
								index={index}
								ordered={ordered}
								noun={Noun}
								error={fieldError(errors, `items.${index}`)}
								disabled={disabled}
								canRemove={canRemove}
								canReorder={canReorder}
								autoFocus={focusKey === row.key}
								onFocused={() => setFocusKey(null)}
								onChange={(text) => updateAt(index, text)}
								onBlur={flush}
								onEnter={() => insertAfter(index)}
								onBackspaceEmpty={() => removeAt(index)}
								onPaste={(event) => onPaste(index, event)}
								onRemove={() => removeAt(index)}
							/>
						))}
					</ol>
				</SortableContext>
			</DndContext>

			{groupError ? (
				<p role="alert" className="text-xs font-medium text-[#B42318] dark:text-red-light">
					{groupError}
				</p>
			) : null}

			<button
				type="button"
				onClick={() => insertAfter(count - 1)}
				disabled={!canAdd}
				className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-gray-5 text-sm font-medium text-dark-4 outline-none transition hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-4 dark:text-dark-6"
			>
				<Plus className="h-4 w-4" aria-hidden />
				Add {noun}
				{count >= LIST_MAX_ITEMS ? <span className="text-xs">(maximum {LIST_MAX_ITEMS})</span> : null}
			</button>
			<p className="text-xs text-dark-5 dark:text-dark-6">Enter adds the next {noun}; pasting several lines adds one {noun} per line.</p>
		</section>
	);
}

interface ItemRowProps {
	row: Row;
	index: number;
	ordered: boolean;
	noun: string;
	error: string | null;
	disabled: boolean;
	canRemove: boolean;
	canReorder: boolean;
	autoFocus: boolean;
	onFocused(): void;
	onChange(text: string): void;
	onBlur(): void;
	onEnter(): void;
	onBackspaceEmpty(): void;
	onPaste(event: ClipboardEvent<HTMLInputElement>): void;
	onRemove(): void;
}

function ItemRow({
	row,
	index,
	ordered,
	noun,
	error,
	disabled,
	canRemove,
	canReorder,
	autoFocus,
	onFocused,
	onChange,
	onBlur,
	onEnter,
	onBackspaceEmpty,
	onPaste,
	onRemove,
}: ItemRowProps) {
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
		id: row.key,
		disabled: !canReorder,
	});
	const inputRef = useRef<HTMLInputElement>(null);
	const name = `${noun} ${index + 1}`;
	const errorId = `${row.key}-error`;

	useEffect(() => {
		if (!autoFocus) return;
		inputRef.current?.focus();
		onFocused();
	}, [autoFocus, onFocused]);

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter" && !event.nativeEvent.isComposing) {
			event.preventDefault();
			onEnter();
		} else if (event.key === "Backspace" && row.text === "" && canRemove) {
			event.preventDefault();
			onBackspaceEmpty();
		}
	};

	return (
		<li
			ref={setNodeRef}
			style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
			className={cn("flex flex-col gap-1 rounded-lg", isDragging && "relative z-10 shadow-lg")}
		>
			<div className="flex items-center gap-2 rounded-lg bg-white dark:bg-dark-2">
				<button
					type="button"
					ref={setActivatorNodeRef}
					{...attributes}
					{...listeners}
					disabled={!canReorder}
					aria-label={`Reorder ${name.toLowerCase()}`}
					className="flex h-11 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-dark-5 outline-none hover:text-dark focus-visible:ring-2 focus-visible:ring-primary/40 active:cursor-grabbing disabled:cursor-default disabled:opacity-30 dark:text-dark-6"
				>
					<GripVertical className="h-4 w-4" aria-hidden />
				</button>
				<span aria-hidden className="w-5 shrink-0 text-right text-sm tabular-nums text-dark-5">
					{ordered ? `${index + 1}.` : "•"}
				</span>
				<div className="relative min-w-0 flex-1">
					<input
						ref={inputRef}
						value={row.text}
						onChange={(event) => onChange(event.target.value)}
						onBlur={onBlur}
						onKeyDown={onKeyDown}
						onPaste={onPaste}
						maxLength={LIST_MAX_ITEM_LENGTH}
						placeholder={name}
						disabled={disabled}
						aria-label={name}
						aria-invalid={error ? true : undefined}
						aria-describedby={error ? errorId : undefined}
						className={cn(
							"min-h-11 w-full rounded-lg border border-stroke bg-white py-2 pl-3 pr-16 text-sm text-dark outline-none transition placeholder:text-dark-6 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 dark:border-dark-3 dark:bg-dark-2 dark:text-white",
							error && "border-red"
						)}
					/>
					<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
						{row.text.length >= LIST_MAX_ITEM_LENGTH * 0.8 ? <CharCount length={row.text.length} max={LIST_MAX_ITEM_LENGTH} /> : null}
					</span>
				</div>
				<button
					type="button"
					onClick={onRemove}
					disabled={!canRemove}
					aria-label={`Remove ${name.toLowerCase()}`}
					title={canRemove ? `Remove ${noun.toLowerCase()}` : `A list needs at least ${LIST_MIN_ITEMS} ${noun.toLowerCase()}`}
					className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-dark-5 outline-none transition hover:bg-red-light-6 hover:text-red focus-visible:ring-2 focus-visible:ring-red/40 disabled:cursor-not-allowed disabled:opacity-30 dark:text-dark-6 dark:hover:bg-red/10"
				>
					<Trash2 className="h-4 w-4" aria-hidden />
				</button>
			</div>
			{error ? (
				<p id={errorId} role="alert" className="pl-[4.5rem] text-xs font-medium text-[#B42318] dark:text-red-light">
					{error}
				</p>
			) : null}
		</li>
	);
}
