"use client";

import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, HelpCircle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeckTheme } from "@/features/deck/theme";
import type { Slide } from "@/features/deck/types";
import { getSlideType } from "../slideRegistry";
import { ScaledSlide, SlidePresenterPreview } from "./SlidePreview";

export interface SlideThumbnailProps {
	slide: Slide;
	index: number;
	total: number;
	selected: boolean;
	theme: DeckTheme;
	onSelect(slideId: number): void;
	onDuplicate(slideId: number): void;
	onDelete(slideId: number): void;
	/** Arrow keys / Home / End move between thumbnails. */
	onNavigate(slideId: number, event: KeyboardEvent<HTMLButtonElement>): void;
	registerButton(slideId: number, element: HTMLButtonElement | null): void;
}

/** Mounts the (possibly heavy) Presenter only once the thumbnail scrolls into view. */
function useSeen<T extends Element>() {
	const ref = useRef<T>(null);
	const [seen, setSeen] = useState(false);
	useEffect(() => {
		const element = ref.current;
		if (!element || seen) return;
		if (typeof IntersectionObserver === "undefined") {
			setSeen(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setSeen(true);
					observer.disconnect();
				}
			},
			{ rootMargin: "200px 0px" }
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [seen]);
	return { ref, seen };
}

function SlideThumbnailImpl({
	slide,
	index,
	total,
	selected,
	theme,
	onSelect,
	onDuplicate,
	onDelete,
	onNavigate,
	registerButton,
}: SlideThumbnailProps) {
	const entry = getSlideType(slide.type);
	const Icon = entry?.icon ?? HelpCircle;
	const typeLabel = entry?.label ?? slide.type;
	const title = slide.title?.trim() || "";
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
	const { ref: previewRef, seen } = useSeen<HTMLDivElement>();

	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={cn("group relative flex gap-2 py-1.5 pl-1 pr-2", isDragging && "z-10 opacity-80")}
		>
			<div className="flex w-7 shrink-0 flex-col items-center gap-1 pt-1 text-xs font-semibold text-dark-5 dark:text-dark-6" aria-hidden>
				<span className={cn(selected && "text-primary-600 dark:text-primary-light")}>{index + 1}</span>
				<Icon className="h-3.5 w-3.5" />
			</div>

			<div className="min-w-0 flex-1">
				<button
					type="button"
					ref={(element) => registerButton(slide.id, element)}
					{...attributes}
					{...listeners}
					// The thumbnail is a plain button: dnd-kit's role/description stay, but keyboard
					// reordering uses Ctrl/Cmd + arrow keys (plan §5.3), handled by the shell.
					aria-roledescription="slide"
					aria-current={selected ? "true" : undefined}
					aria-label={`Slide ${index + 1} of ${total}: ${typeLabel}${title ? `, ${title}` : ""}`}
					onClick={() => onSelect(slide.id)}
					onKeyDown={(event) => onNavigate(slide.id, event)}
					className={cn(
						"block w-full cursor-pointer touch-none select-none overflow-hidden rounded-lg border-2 bg-white text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 dark:bg-dark-2 dark:focus-visible:ring-offset-dark",
						selected ? "border-primary shadow-md" : "border-stroke hover:border-primary/60 dark:border-stroke-dark"
					)}
				>
					<div ref={previewRef} inert className="pointer-events-none">
						<ScaledSlide fit="width">
							{seen ? <SlidePresenterPreview slide={slide} theme={theme} totalSlides={total} /> : null}
						</ScaledSlide>
					</div>
				</button>
				<p
					className={cn(
						"mt-1 truncate text-xs",
						title ? "text-dark dark:text-white" : "italic text-dark-5 dark:text-dark-6"
					)}
					aria-hidden
				>
					{title || typeLabel}
				</p>
			</div>

			{/* Mouse shortcuts; keyboard users have the canvas toolbar and Ctrl/Cmd+D / Delete. */}
			<div
				className="absolute right-3 top-3 hidden gap-1 group-hover:flex"
				aria-hidden
			>
				<button
					type="button"
					tabIndex={-1}
					title="Duplicate slide"
					onClick={() => onDuplicate(slide.id)}
					className="flex h-8 w-8 items-center justify-center rounded-md bg-white/95 text-dark shadow ring-1 ring-black/10 hover:bg-gray-2 dark:bg-dark-2 dark:text-white"
				>
					<Copy className="h-4 w-4" />
				</button>
				<button
					type="button"
					tabIndex={-1}
					title="Delete slide"
					onClick={() => onDelete(slide.id)}
					className="flex h-8 w-8 items-center justify-center rounded-md bg-white/95 text-red-dark shadow ring-1 ring-black/10 hover:bg-red-light-5 dark:bg-dark-2"
				>
					<Trash2 className="h-4 w-4" />
				</button>
			</div>
		</li>
	);
}

/** Re-renders only when its slide (or selection / position) changes. */
export const SlideThumbnail = memo(SlideThumbnailImpl);
