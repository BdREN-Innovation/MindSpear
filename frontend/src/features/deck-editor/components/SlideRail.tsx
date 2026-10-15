"use client";

import { useCallback, useMemo, useRef, type KeyboardEvent, type Ref } from "react";
import {
	closestCenter,
	DndContext,
	PointerSensor,
	useSensor,
	useSensors,
	type Announcements,
	type DragEndEvent,
	type ScreenReaderInstructions,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { Plus } from "lucide-react";
import type { DeckTheme } from "@/features/deck/theme";
import type { Slide } from "@/features/deck/types";
import { SlideThumbnail } from "./SlideThumbnail";

export interface SlideRailProps {
	slides: Slide[];
	selectedId: number | null;
	theme: DeckTheme;
	onSelect(slideId: number): void;
	/** Select + move keyboard focus to that thumbnail. */
	onFocusSlide(slideId: number): void;
	onMove(slideId: number, toIndex: number): void;
	onDuplicate(slideId: number): void;
	onDelete(slideId: number): void;
	onAdd(): void;
	registerButton(slideId: number, element: HTMLButtonElement | null): void;
	/** Focus lands here after the last slide is deleted. */
	addButtonRef?: Ref<HTMLButtonElement>;
}

const MODIFIERS = [restrictToVerticalAxis, restrictToFirstScrollableAncestor];

// Thumbnails are dragged with a pointer only; keyboard users move slides with Ctrl/Cmd + arrows.
const INSTRUCTIONS: ScreenReaderInstructions = {
	draggable: "Press Control or Command with the up or down arrow to move this slide. Use the up and down arrows to go to other slides.",
};

/** Left column: numbered thumbnails, drag to reorder (one batched reorder call on drop), "New slide". */
export function SlideRail({
	slides,
	selectedId,
	theme,
	onSelect,
	onFocusSlide,
	onMove,
	onDuplicate,
	onDelete,
	onAdd,
	registerButton,
	addButtonRef,
}: SlideRailProps) {
	// A small distance keeps a plain click a click.
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
	// Stable while only slide contents change, so memoised thumbnails skip re-rendering.
	const idsKey = slides.map((slide) => slide.id).join(",");
	const ids = useMemo(() => (idsKey ? idsKey.split(",").map(Number) : []), [idsKey]);
	const idsRef = useRef(ids);
	idsRef.current = ids;

	const position = (id: string | number | undefined) => ids.indexOf(Number(id)) + 1;
	const announcements: Announcements = {
		onDragStart: ({ active }) => `Picked up slide ${position(active.id)}.`,
		onDragOver: ({ over }) => (over ? `Over position ${position(over.id)}.` : undefined),
		onDragEnd: ({ over }) => (over ? `Slide dropped at position ${position(over.id)}.` : "Slide dropped."),
		onDragCancel: () => "Moving cancelled.",
	};

	const onDragEnd = ({ active, over }: DragEndEvent) => {
		if (!over || active.id === over.id) return;
		const to = ids.indexOf(Number(over.id));
		if (to >= 0) onMove(Number(active.id), to);
	};

	// Plain arrows walk the list; Ctrl/Cmd + arrows (move) are handled by the shell.
	const onNavigate = useCallback(
		(slideId: number, event: KeyboardEvent<HTMLButtonElement>) => {
			if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
			const list = idsRef.current;
			const index = list.indexOf(slideId);
			let target: number | null = null;
			if (event.key === "ArrowDown") target = Math.min(list.length - 1, index + 1);
			else if (event.key === "ArrowUp") target = Math.max(0, index - 1);
			else if (event.key === "Home") target = 0;
			else if (event.key === "End") target = list.length - 1;
			if (target === null) return;
			event.preventDefault();
			if (list[target] !== undefined) onFocusSlide(list[target]);
		},
		[onFocusSlide]
	);

	return (
		<nav
			aria-label="Slides"
			className="flex h-full w-60 shrink-0 flex-col border-r border-stroke bg-white dark:border-stroke-dark dark:bg-gray-dark"
		>
			<div className="flex items-center justify-between gap-2 border-b border-stroke p-3 dark:border-stroke-dark">
				<h2 className="text-sm font-semibold text-dark dark:text-white">
					Slides <span className="font-normal text-dark-5 dark:text-dark-6">({slides.length})</span>
				</h2>
			</div>
			<div className="p-3 pb-1">
				<button
					ref={addButtonRef}
					type="button"
					onClick={onAdd}
					aria-keyshortcuts="N"
					className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-dark transition hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-dark"
				>
					<Plus className="h-4 w-4" aria-hidden />
					New slide
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
				{slides.length === 0 ? (
					<p className="px-3 py-6 text-center text-sm text-dark-5 dark:text-dark-6">No slides yet.</p>
				) : (
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						modifiers={MODIFIERS}
						accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS }}
						onDragEnd={onDragEnd}
					>
						<SortableContext items={ids} strategy={verticalListSortingStrategy}>
							<ol className="flex flex-col" aria-label="Slide order">
								{slides.map((slide, index) => (
									<SlideThumbnail
										key={slide.id}
										slide={slide}
										index={index}
										total={slides.length}
										selected={slide.id === selectedId}
										theme={theme}
										onSelect={onSelect}
										onDuplicate={onDuplicate}
										onDelete={onDelete}
										onNavigate={onNavigate}
										registerButton={registerButton}
									/>
								))}
							</ol>
						</SortableContext>
					</DndContext>
				)}
			</div>
		</nav>
	);
}
