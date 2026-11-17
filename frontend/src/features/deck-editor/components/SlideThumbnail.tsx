"use client";

import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, CornerDownRight, HelpCircle, Trash2 } from "lucide-react";
import { Podium } from "../slides/leaderboard/PodiumIcon";
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
	/** Quiz decks: whether a Leaderboard slide follows this one (the podium toggle); undefined hides it. */
	leaderboardAfter?: boolean;
	/** The podium toggle's change is being saved. */
	leaderboardBusy?: boolean;
	onToggleLeaderboard?(slideId: number): void;
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

/**
 * A Leaderboard slide in the rail: a slim bar tucked under the slide it follows
 * instead of a full thumbnail, so the scores read as a pause between questions.
 */
function LeaderboardBar({ slide, index, total, selected, onSelect, onDelete, onNavigate, registerButton }: SlideThumbnailProps) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
	const title = slide.title?.trim() || "Leaderboard";
	const config = slide.config as { top_n?: number; show_all_participants?: boolean };
	const shown = config.show_all_participants ? "Everyone" : `Top ${config.top_n ?? 10}`;

	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={cn("group relative flex items-center gap-2 py-1 pl-1 pr-2", isDragging && "z-10 opacity-80")}
		>
			<span className="w-7 shrink-0 text-center text-xs font-semibold text-dark-5 dark:text-dark-6" aria-hidden>
				{index + 1}
			</span>
			<CornerDownRight className="-ml-1 h-4 w-4 shrink-0 text-secondary-300 dark:text-secondary-600" aria-hidden />
			<button
				type="button"
				ref={(element) => registerButton(slide.id, element)}
				{...attributes}
				{...listeners}
				aria-roledescription="slide"
				aria-current={selected ? "true" : undefined}
				aria-label={`Slide ${index + 1} of ${total}: Leaderboard${title !== "Leaderboard" ? `, ${title}` : ""}`}
				onClick={() => onSelect(slide.id)}
				onKeyDown={(event) => onNavigate(slide.id, event)}
				className={cn(
					"flex h-9 min-w-0 flex-1 cursor-pointer touch-none select-none items-center gap-2 rounded-full border-2 px-3 text-left text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-dark",
					selected
						? "border-secondary bg-secondary-50 text-secondary-700 shadow-sm dark:bg-secondary-900/40 dark:text-secondary-100"
						: "border-secondary-100 bg-secondary-50/60 text-secondary-600 hover:border-secondary-200 dark:border-secondary-800 dark:bg-secondary-900/20 dark:text-secondary-200"
				)}
			>
				<Podium className="h-4 w-4 shrink-0" aria-hidden />
				<span className="min-w-0 flex-1 truncate">{title}</span>
				<span className="shrink-0 font-medium text-secondary-500 group-hover:hidden dark:text-secondary-300">{shown}</span>
			</button>
			<button
				type="button"
				tabIndex={-1}
				aria-hidden
				title="Remove this leaderboard"
				onClick={() => onDelete(slide.id)}
				className="absolute right-3.5 top-1/2 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-red-dark hover:bg-red-light-5 group-hover:flex"
			>
				<Trash2 className="h-3.5 w-3.5" />
			</button>
		</li>
	);
}

function SlideThumbnailImpl(props: SlideThumbnailProps) {
	if (props.slide.type === "leaderboard") return <LeaderboardBar {...props} />;
	return <SlideCard {...props} />;
}

function SlideCard({
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
	leaderboardAfter,
	leaderboardBusy = false,
	onToggleLeaderboard,
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
			<div className="flex w-7 shrink-0 flex-col items-center gap-1 pt-1 text-xs font-semibold text-dark-5 dark:text-dark-6">
				<span className={cn(selected && "text-primary-600 dark:text-primary-light")} aria-hidden>
					{index + 1}
				</span>
				<Icon className="h-3.5 w-3.5" aria-hidden />
				{onToggleLeaderboard && leaderboardAfter !== undefined ? (
					<button
						type="button"
						aria-pressed={leaderboardAfter}
						aria-label={`Show the leaderboard after slide ${index + 1}`}
						title={leaderboardAfter ? "Leaderboard after this slide (click to remove)" : "Show the leaderboard after this slide"}
						disabled={leaderboardBusy}
						onClick={() => onToggleLeaderboard(slide.id)}
						className={cn(
							"mt-1 flex h-6 w-6 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/50 disabled:cursor-wait disabled:opacity-50",
							leaderboardAfter
								? "bg-secondary-500 text-white shadow-sm hover:bg-secondary-600"
								: "text-gray-5 hover:bg-secondary-50 hover:text-secondary-500 dark:text-dark-5 dark:hover:bg-dark-3"
						)}
					>
						<Podium className="h-3.5 w-3.5" strokeWidth={leaderboardAfter ? 2.5 : 2} aria-hidden />
					</button>
				) : null}
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
