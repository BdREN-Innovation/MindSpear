"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Eye, MonitorSmartphone, RotateCcw, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeckTheme } from "@/features/deck/theme";
import { isScoredQuizSlideTypeKey, type DeckProduct, type RunState, type Slide } from "@/features/deck/types";
import { PhonePreview, type PhoneAnswer } from "./PhonePreview";
import { productCopy } from "./productCopy";
import { previewStateFor, ScaledSlide, SlidePresenterPreview } from "./SlidePreview";

export interface PreviewOverlayProps {
	/** Copy only; default quest. */
	product?: DeckProduct;
	slides: Slide[];
	startIndex: number;
	theme: DeckTheme;
	title: string;
	/** Extra buttons in the top bar, before Close (Discover: "Use this template"). */
	actions?: ReactNode;
	/** Called with the slide shown last, so the editor can select it. */
	onClose(lastSlideId: number | null): void;
}

const navButton =
	"flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30";

const stageButton =
	"inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white";

/** Keys typed into the phone (or any field) never move the slides. */
function typingIn(target: EventTarget | null): boolean {
	const element = target as HTMLElement | null;
	return !!element?.closest?.("input, textarea, select, [contenteditable='true'], [data-preview-phone]");
}

type Phase = "answering" | "results";

/**
 * Full-screen walkthrough of the deck (plan §5.3), like the session would
 * run it: the host's big screen and, beside it, a phone with the participant
 * view to answer on (nothing is sent). Quiz questions open for answers;
 * "Show results" reveals them on both. Arrows / Space navigate, Esc closes.
 */
export function PreviewOverlay({ product = "quest", slides, startIndex, theme, title, actions, onClose }: PreviewOverlayProps) {
	const [index, setIndex] = useState(() => Math.max(0, Math.min(slides.length - 1, startIndex)));
	const [withPhone, setWithPhone] = useState(true);
	// Per slide: the phase, the phone's answer, when the question opened and a remount key for "Answer again".
	const [phases, setPhases] = useState<Record<number, Phase>>({});
	const [answers, setAnswers] = useState<Record<number, PhoneAnswer>>({});
	const [openedAt, setOpenedAt] = useState<Record<number, string>>({});
	const [attempts, setAttempts] = useState<Record<number, number>>({});
	const dialogRef = useRef<HTMLDivElement>(null);
	const slide = slides[index] ?? null;
	const last = slides.length - 1;
	const scored = !!slide && isScoredQuizSlideTypeKey(slide.type);
	const phase: Phase = slide ? (phases[slide.id] ?? "answering") : "answering";
	const answer = slide ? (answers[slide.id] ?? null) : null;

	// A question opens (its points bar starts) the first time it is shown.
	const slideId = slide?.id ?? null;
	useEffect(() => {
		if (slideId === null) return;
		setOpenedAt((previous) => (previous[slideId] ? previous : { ...previous, [slideId]: new Date().toISOString() }));
	}, [slideId]);

	const hostState: RunState = !slide ? "waiting" : scored ? (phase === "results" ? "reveal" : "voting") : previewStateFor(slide);
	const phoneState: RunState = !slide ? "waiting" : scored ? hostState : slide.revealModel === "moderated_feed" ? "open" : slide.acceptsAnswers ? "voting" : "waiting";

	const recordAnswer = (payload: unknown) => {
		if (!slide) return;
		const opened = openedAt[slide.id] ? Date.parse(openedAt[slide.id]) : Date.now();
		setAnswers((previous) => ({ ...previous, [slide.id]: { payload, elapsedMs: Math.max(0, Date.now() - opened) } }));
	};
	const answerAgain = () => {
		if (!slide) return;
		const id = slide.id;
		setAnswers((previous) => {
			const next = { ...previous };
			delete next[id];
			return next;
		});
		setPhases((previous) => ({ ...previous, [id]: "answering" }));
		setOpenedAt((previous) => ({ ...previous, [id]: new Date().toISOString() }));
		setAttempts((previous) => ({ ...previous, [id]: (previous[id] ?? 0) + 1 }));
	};

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
			if (event.key !== "Escape" && event.key !== "Tab" && typingIn(event.target)) return;
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
					const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])");
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
				<div className="flex shrink-0 items-center gap-2">
					<button
						type="button"
						onClick={() => setWithPhone((on) => !on)}
						aria-pressed={withPhone}
						className={cn(stageButton, "hidden lg:inline-flex", withPhone ? "bg-white text-[#05080f]" : "bg-white/10 text-white hover:bg-white/20")}
						title={withPhone ? "Show the host screen only" : "Show the participant phone too"}
					>
						<MonitorSmartphone className="h-4 w-4" aria-hidden />
						{withPhone ? "Host + phone" : "Host only"}
					</button>
					{actions}
					<button type="button" onClick={close} className={navButton} aria-label="Close preview (Esc)">
						<X className="h-5 w-5" aria-hidden />
					</button>
				</div>
			</div>

			<div className="flex min-h-0 flex-1 gap-6 px-4 pb-2">
				<div className="relative h-full min-w-0 flex-1">
					{slide ? (
						<>
							<p className="sr-only">Host screen</p>
							<ScaledSlide fit="contain" frameClassName="rounded-lg">
								<SlidePresenterPreview slide={slide} theme={theme} totalSlides={slides.length} state={hostState} />
							</ScaledSlide>
						</>
					) : (
						<p className="flex h-full items-center justify-center text-white/70">This {productCopy(product).noun} has no slides.</p>
					)}
				</div>
				{slide && withPhone ? (
					<div data-preview-phone className="hidden h-full shrink-0 items-center lg:flex">
						<PhonePreview
							key={`${slide.id}-${attempts[slide.id] ?? 0}`}
							slide={slide}
							theme={theme}
							state={phoneState}
							answer={answer}
							onAnswer={recordAnswer}
							openedAt={openedAt[slide.id] ?? null}
							showResults={scored && phase === "results"}
						/>
					</div>
				) : null}
			</div>

			<div className="flex items-center justify-center gap-4 pb-4 text-white">
				<button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index <= 0} className={navButton} aria-label="Previous slide">
					<ChevronLeft className="h-6 w-6" aria-hidden />
				</button>
				{scored ? (
					<div className="flex items-center gap-2">
						{phase === "answering" ? (
							<button type="button" onClick={() => slide && setPhases((previous) => ({ ...previous, [slide.id]: "results" }))} className={cn(stageButton, "bg-primary text-white hover:bg-primary/90")}>
								<Eye className="h-4 w-4" aria-hidden />
								Show results
							</button>
						) : (
							<button type="button" onClick={() => slide && setPhases((previous) => ({ ...previous, [slide.id]: "answering" }))} className={cn(stageButton, "bg-white/10 text-white hover:bg-white/20")}>
								<Undo2 className="h-4 w-4" aria-hidden />
								Back to the question
							</button>
						)}
						{answer ? (
							<button type="button" onClick={answerAgain} className={cn(stageButton, "bg-white/10 text-white hover:bg-white/20")}>
								<RotateCcw className="h-4 w-4" aria-hidden />
								Answer again
							</button>
						) : null}
					</div>
				) : (
					<span className="text-xs text-white/60">{withPhone ? "Try the slide on the phone · " : ""}Use ← → to move, Esc to close</span>
				)}
				<button type="button" onClick={() => setIndex((i) => Math.min(last, i + 1))} disabled={index >= last} className={navButton} aria-label="Next slide">
					<ChevronRight className="h-6 w-6" aria-hidden />
				</button>
			</div>
		</div>,
		document.body
	);
}
