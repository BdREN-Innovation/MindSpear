"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
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
import { toDeckApiError } from "@/features/deck/api/errors";
import { DECK_LIMITS, type Slide, type SlideOption } from "@/features/deck/types";
import type { OptionsApi } from "../types";
import { CharCount } from "./fields";
import { useDebouncedValue } from "./hooks";
import { ImageSlot } from "./media";

// The option / statement / item list of a slide's Editor: inline labels
// (debounced PATCH, flushed on blur), add / remove within the type's limits,
// drag (or keyboard: Space, arrows, Space) reorder through OptionsApi.reorder
// with an optimistic order that rolls back on failure, and an optional image
// per option. The shell replaces `slide` from each API response, so the list
// always re-renders from server truth.

export interface OptionListEditorProps {
	slide: Slide;
	options: OptionsApi;
	/** Defaults to options.min / options.max. */
	min?: number;
	max?: number;
	/** Placeholder per row, e.g. (i) => `Option ${i + 1}`. */
	labelPlaceholder?: string | ((index: number) => string);
	/** Per-option image slot (poll options). */
	allowImages?: boolean;
	/** Group label, e.g. "Options", "Statements", "Items". */
	label?: string;
	/** Singular noun for buttons and screen readers (default "option"). */
	itemNoun?: string;
	/** Slide 422 errors from the editor (shows errors.options). */
	errors?: Record<string, string[]>;
	disabled?: boolean;
	/** Default 200 (backend option label cap). */
	maxLabelLength?: number;
	/** Label save debounce (default 500 ms). */
	debounceMs?: number;
	/** Show 1, 2, 3 before each row (ranking / numbered lists). */
	numbered?: boolean;
}

function capitalise(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

export function OptionListEditor({
	slide,
	options: api,
	min = api.min,
	max = api.max,
	labelPlaceholder,
	allowImages = false,
	label = "Options",
	itemNoun = "option",
	errors,
	disabled = false,
	maxLabelLength = DECK_LIMITS.maxOptionLabel,
	debounceMs = 500,
	numbered = false,
}: OptionListEditorProps) {
	const serverOrder = useMemo(() => slide.options.map((option) => option.id), [slide.options]);
	const [pendingOrder, setPendingOrder] = useState<number[] | null>(null);
	const [adding, setAdding] = useState(false);
	const [removingId, setRemovingId] = useState<number | null>(null);
	const [focusId, setFocusId] = useState<number | null>(null);
	const [listError, setListError] = useState<string | null>(null);

	const byId = useMemo(() => new Map(slide.options.map((option) => [option.id, option])), [slide.options]);
	// A pending order only lists ids that still exist (an option may be gone after a refetch).
	const order = (pendingOrder ?? serverOrder).filter((id) => byId.has(id));
	const count = order.length;
	const canAdd = !disabled && !adding && count < max;
	const canRemove = !disabled && count > min;
	const canReorder = !disabled && count > 1;

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	);

	const add = async () => {
		if (!canAdd) return;
		setAdding(true);
		setListError(null);
		try {
			const option = await api.add({});
			setFocusId(option.id);
		} catch (reason) {
			const error = toDeckApiError(reason);
			setListError(error.fieldError("options") ?? error.message);
		} finally {
			setAdding(false);
		}
	};

	const remove = async (id: number) => {
		if (!canRemove) return;
		setRemovingId(id);
		setListError(null);
		try {
			await api.remove(id);
		} catch (reason) {
			const error = toDeckApiError(reason);
			setListError(error.fieldError("options") ?? error.message);
		} finally {
			setRemovingId(null);
		}
	};

	const onDragEnd = async ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		const from = order.indexOf(Number(active.id));
		const to = order.indexOf(Number(over.id));
		if (from < 0 || to < 0) return;
		const next = arrayMove(order, from, to);
		setPendingOrder(next);
		try {
			await api.reorder(next);
		} catch (reason) {
			const error = toDeckApiError(reason);
			toast.error(
				error.status === 409
					? `The ${itemNoun}s changed somewhere else, so the latest order was loaded.`
					: (error.fieldError("options") ?? error.message)
			);
		} finally {
			// Success: the shell has replaced `slide` with the server order. Failure: back to it.
			setPendingOrder(null);
		}
	};

	const placeholderFor = (index: number) =>
		typeof labelPlaceholder === "function"
			? labelPlaceholder(index)
			: (labelPlaceholder ?? `${capitalise(itemNoun)} ${index + 1}`);

	const groupError = errors?.options?.[0] ?? listError;

	return (
		<section className="flex flex-col gap-2" aria-label={label}>
			<div className="flex items-baseline justify-between">
				<h3 className="text-sm font-medium text-dark dark:text-white">{label}</h3>
				<span className="text-xs text-dark-5 dark:text-dark-6">
					{count} / {max}
				</span>
			</div>

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				modifiers={[restrictToVerticalAxis, restrictToParentElement]}
				onDragEnd={onDragEnd}
				accessibility={{
					screenReaderInstructions: {
						draggable: `To reorder, press Space on the handle, move with the arrow keys, then press Space to drop or Escape to cancel.`,
					},
				}}
			>
				<SortableContext items={order} strategy={verticalListSortingStrategy}>
					<ol className="flex flex-col gap-2">
						{order.map((id, index) => {
							const option = byId.get(id)!;
							return (
								<OptionRow
									key={id}
									option={option}
									index={index}
									api={api}
									noun={itemNoun}
									placeholder={placeholderFor(index)}
									maxLength={maxLabelLength}
									debounceMs={debounceMs}
									allowImages={allowImages}
									numbered={numbered}
									disabled={disabled}
									canRemove={canRemove}
									min={min}
									canReorder={canReorder}
									removing={removingId === id}
									autoFocus={focusId === id}
									onFocused={() => setFocusId(null)}
									onRemove={() => remove(id)}
									onEnter={() => {
										// Enter on the last row adds the next one (fast typing of options).
										if (index === count - 1) void add();
									}}
								/>
							);
						})}
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
				onClick={add}
				disabled={!canAdd}
				className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-gray-5 text-sm font-medium text-dark-4 outline-none transition hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-4 dark:text-dark-6"
			>
				{adding ? (
					<span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden />
				) : (
					<Plus className="h-4 w-4" aria-hidden />
				)}
				Add {itemNoun}
				{count >= max ? <span className="text-xs">(maximum {max})</span> : null}
			</button>
		</section>
	);
}

interface OptionRowProps {
	option: SlideOption;
	index: number;
	api: OptionsApi;
	noun: string;
	placeholder: string;
	maxLength: number;
	debounceMs: number;
	allowImages: boolean;
	numbered: boolean;
	disabled: boolean;
	canRemove: boolean;
	min: number;
	canReorder: boolean;
	removing: boolean;
	autoFocus: boolean;
	onFocused: () => void;
	onRemove: () => void;
	onEnter: () => void;
}

function OptionRow({
	option,
	index,
	api,
	noun,
	placeholder,
	maxLength,
	debounceMs,
	allowImages,
	numbered,
	disabled,
	canRemove,
	min,
	canReorder,
	removing,
	autoFocus,
	onFocused,
	onRemove,
	onEnter,
}: OptionRowProps) {
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
		id: option.id,
		disabled: !canReorder,
	});
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const name = `${capitalise(noun)} ${index + 1}`;

	const save = async (value: string) => {
		const label = value.trim() === "" ? null : value;
		if (label === (option.label ?? null)) return;
		setSaving(true);
		try {
			await api.update(option.id, { label });
			setError(null);
		} catch (reason) {
			const deckError = toDeckApiError(reason);
			setError(deckError.fieldError("label") ?? deckError.message);
		} finally {
			setSaving(false);
		}
	};
	const { local, setLocal, flush } = useDebouncedValue(option.label ?? "", (value) => void save(value), debounceMs);

	useEffect(() => {
		if (!autoFocus) return;
		inputRef.current?.focus();
		onFocused();
	}, [autoFocus, onFocused]);

	const errorId = `option-${option.id}-error`;

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
				{numbered ? <span className="w-5 shrink-0 text-right text-sm tabular-nums text-dark-5">{index + 1}.</span> : null}
				{allowImages ? (
					<ImageSlot
						imageUrl={option.image?.url}
						label={`Image for ${name.toLowerCase()}`}
						disabled={disabled}
						onPickFile={async (fileId) => {
							await api.setImage(option.id, fileId);
						}}
						onDetach={async () => {
							await api.setImage(option.id, null);
						}}
					/>
				) : null}
				<div className="relative min-w-0 flex-1">
					<input
						ref={inputRef}
						value={local}
						onChange={(event) => setLocal(event.target.value)}
						onBlur={flush}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								flush();
								onEnter();
							}
						}}
						maxLength={maxLength}
						placeholder={placeholder}
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
						{saving ? (
							<span className="sr-only" role="status">
								Saving
							</span>
						) : null}
						{local.length >= maxLength * 0.8 ? <CharCount length={local.length} max={maxLength} /> : null}
					</span>
				</div>
				<button
					type="button"
					onClick={onRemove}
					disabled={!canRemove || removing}
					aria-label={`Remove ${name.toLowerCase()}`}
					title={canRemove ? `Remove ${noun}` : `This slide needs at least ${min} ${noun}${min === 1 ? "" : "s"}`}
					className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-dark-5 outline-none transition hover:bg-red-light-6 hover:text-red focus-visible:ring-2 focus-visible:ring-red/40 disabled:cursor-not-allowed disabled:opacity-30 dark:text-dark-6 dark:hover:bg-red/10"
				>
					{removing ? (
						<span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden />
					) : (
						<Trash2 className="h-4 w-4" aria-hidden />
					)}
				</button>
			</div>
			{error ? (
				<p id={errorId} role="alert" className="pl-10 text-xs font-medium text-[#B42318] dark:text-red-light">
					{error}
				</p>
			) : null}
		</li>
	);
}
