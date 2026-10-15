"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { DeckTheme } from "@/features/deck/theme";
import type { Slide } from "@/features/deck/types";
import { ScaledSlide, SlidePresenterPreview } from "./SlidePreview";

export interface PreviewOverlayProps {
	slides: Slide[];
	startIndex: number;
	theme: DeckTheme;
	title: string;
	/** Called with the slide shown last, so the editor can select it. */
	onClose(lastSlideId: number | null): void;
}

const navButton =
	"flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30";

/** Full-screen read-only walkthrough of the deck (plan §5.3): arrows / Space navigate, Esc closes. */
export function PreviewOverlay({ slides, startIndex, theme, title, onClose }: PreviewOverlayProps) {
	const [index, setIndex] = useState(() => Math.max(0, Math.min(slides.length - 1, startIndex)));
	const dialogRef = useRef<HTMLDivElement>(null);
	const slide = slides[index] ?? null;
	const last = slides.length - 1;

	const close = useCallback(() => onClose(slides[index]?.id ?? null), [index, onClose, slides]);

	// Focus moves into the dialog and returns to the opener afterwards.
	useEffect(() => {
		const opener = document.activeElement as HTMLElement | null;
		dialogRef.current?.focus();
		const { overflow } = document.body.style;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = overflow;
			opener?.focus?.();
		};
	}, []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			// Space on a focused button presses that button instead.
			if (event.key === " " && (event.target as HTMLElement | null)?.tagName === "BUTTON") return;
			switch (event.key) {
				case "ArrowRight":
				case "ArrowDown":
				case "PageDown":
				case " ":
					event.preventDefault();
					setIndex((i) => Math.min(last, i + 1));
					break;
				case "ArrowLeft":
				case "ArrowUp":
				case "PageUp":
					event.preventDefault();
					setIndex((i) => Math.max(0, i - 1));
					break;
				case "Home":
					event.preventDefault();
					setIndex(0);
					break;
				case "End":
					event.preventDefault();
					setIndex(last);
					break;
				case "Escape":
					event.preventDefault();
					close();
					break;
				case "Tab": {
					// Keep focus inside the dialog.
					const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
					if (!focusable?.length) break;
					const first = focusable[0];
					const final = focusable[focusable.length - 1];
					if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
						event.preventDefault();
						final.focus();
					} else if (!event.shiftKey && document.activeElement === final) {
						event.preventDefault();
						first.focus();
					}
					break;
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [close, last]);

	if (typeof document === "undefined") return null;

	return createPortal(
		<div
			ref={dialogRef}
			role="dialog"
			aria-modal="true"
			aria-label={`Preview of ${title}`}
			tabIndex={-1}
			className="fixed inset-0 z-[1100] flex flex-col bg-[#05080f] focus:outline-none"
		>
			<div className="flex items-center justify-between gap-4 px-4 py-2 text-white">
				<p className="min-w-0 truncate text-sm font-medium text-white/80">
					Preview · {title}
				</p>
				<p className="text-sm tabular-nums text-white/80" aria-live="polite" aria-atomic="true">
					Slide {slides.length ? index + 1 : 0} of {slides.length}
				</p>
				<button type="button" onClick={close} className={navButton} aria-label="Close preview (Esc)">
					<X className="h-5 w-5" aria-hidden />
				</button>
			</div>

			<div className="relative min-h-0 flex-1 px-4 pb-2">
				{slide ? (
					<ScaledSlide fit="contain" frameClassName="rounded-lg">
						<SlidePresenterPreview slide={slide} theme={theme} totalSlides={slides.length} />
					</ScaledSlide>
				) : (
					<p className="flex h-full items-center justify-center text-white/70">This quest has no slides.</p>
				)}
			</div>

			<div className="flex items-center justify-center gap-4 pb-4 text-white">
				<button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index <= 0} className={navButton} aria-label="Previous slide">
					<ChevronLeft className="h-6 w-6" aria-hidden />
				</button>
				<span className="text-xs text-white/60">Use ← → to move, Esc to close</span>
				<button type="button" onClick={() => setIndex((i) => Math.min(last, i + 1))} disabled={index >= last} className={navButton} aria-label="Next slide">
					<ChevronRight className="h-6 w-6" aria-hidden />
				</button>
			</div>
		</div>,
		document.body
	);
}
