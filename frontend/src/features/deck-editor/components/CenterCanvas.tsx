"use client";

import { ArrowDown, ArrowUp, Copy, HelpCircle, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeckTheme } from "@/features/deck/theme";
import type { DeckProduct, Slide } from "@/features/deck/types";
import { getSlideType } from "../slideRegistry";
import { productCopy } from "./productCopy";
import { ScaledSlide, SlidePresenterPreview } from "./SlidePreview";

export interface CenterCanvasProps {
	/** Copy only; default quest. */
	product?: DeckProduct;
	slide: Slide | null;
	index: number;
	total: number;
	theme: DeckTheme;
	onAdd(): void;
	onDuplicate(slideId: number): void;
	onDelete(slideId: number): void;
	onMove(slideId: number, toIndex: number): void;
}

const toolButton =
	"inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-dark transition hover:bg-gray-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:pointer-events-none disabled:opacity-40 dark:text-white dark:hover:bg-dark-3";

/** Middle column: the selected slide exactly as the presenter will render it, scaled to fit 16:9. */
export function CenterCanvas({ product = "quest", slide, index, total, theme, onAdd, onDuplicate, onDelete, onMove }: CenterCanvasProps) {
	if (!slide) {
		return (
			<section aria-label="Slide preview" className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 bg-gray-2 p-6 dark:bg-dark">
				<p className="text-base font-medium text-dark dark:text-white">This {productCopy(product).noun} has no slides yet.</p>
				<button
					type="button"
					onClick={onAdd}
					className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-dark hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
				>
					<Plus className="h-4 w-4" aria-hidden />
					Add a slide
				</button>
			</section>
		);
	}

	const entry = getSlideType(slide.type);
	const Icon = entry?.icon ?? HelpCircle;

	return (
		<section aria-label="Slide preview" className="flex min-w-0 flex-1 flex-col bg-gray-2 dark:bg-dark">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-stroke bg-white px-4 py-1.5 dark:border-stroke-dark dark:bg-gray-dark">
				<p className="flex min-w-0 items-center gap-2 text-sm text-dark-5 dark:text-dark-6">
					<Icon className="h-4 w-4 shrink-0" aria-hidden />
					<span className="truncate">
						<span className="font-semibold text-dark dark:text-white">{entry?.label ?? slide.type}</span> · Slide {index + 1} of {total}
					</span>
				</p>
				<div className="flex items-center gap-0.5" role="toolbar" aria-label="Slide actions">
					<button
						type="button"
						className={toolButton}
						onClick={() => onMove(slide.id, index - 1)}
						disabled={index === 0}
						aria-label="Move slide up"
						title="Move up (Ctrl/Cmd + ↑)"
						aria-keyshortcuts="Control+ArrowUp Meta+ArrowUp"
					>
						<ArrowUp className="h-4 w-4" aria-hidden />
					</button>
					<button
						type="button"
						className={toolButton}
						onClick={() => onMove(slide.id, index + 1)}
						disabled={index >= total - 1}
						aria-label="Move slide down"
						title="Move down (Ctrl/Cmd + ↓)"
						aria-keyshortcuts="Control+ArrowDown Meta+ArrowDown"
					>
						<ArrowDown className="h-4 w-4" aria-hidden />
					</button>
					<button
						type="button"
						className={toolButton}
						onClick={() => onDuplicate(slide.id)}
						title="Duplicate (Ctrl/Cmd + D)"
						aria-keyshortcuts="Control+D Meta+D"
					>
						<Copy className="h-4 w-4" aria-hidden />
						<span className="hidden xl:inline">Duplicate</span>
						<span className="sr-only xl:hidden">Duplicate slide</span>
					</button>
					<button
						type="button"
						className={cn(toolButton, "text-red-dark dark:text-red-light")}
						onClick={() => onDelete(slide.id)}
						title="Delete (Delete key)"
						aria-keyshortcuts="Delete"
					>
						<Trash2 className="h-4 w-4" aria-hidden />
						<span className="hidden xl:inline">Delete</span>
						<span className="sr-only xl:hidden">Delete slide</span>
					</button>
				</div>
			</div>

			<div className="relative min-h-0 flex-1 p-4 lg:p-8">
				<ScaledSlide fit="contain" frameClassName="rounded-xl bg-white shadow-lg ring-1 ring-black/5 dark:ring-white/10">
					{/* Read-only preview: edits happen in the inspector. */}
					<div inert className="h-full w-full">
						<SlidePresenterPreview slide={slide} theme={theme} totalSlides={total} />
					</div>
				</ScaledSlide>
			</div>
		</section>
	);
}
