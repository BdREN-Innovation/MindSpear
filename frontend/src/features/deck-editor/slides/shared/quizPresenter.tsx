/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import type { CSSProperties, ReactNode } from "react";
import { motion, type Transition } from "framer-motion";
import { Check, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { chartColor, type DeckTheme } from "@/features/deck/theme";
import type { RunState } from "@/features/deck/types";
import type { PresenterQuizInfo } from "../types";
import { usePrefersReducedMotion } from "./hooks";
import { optionLetter } from "./quizLabels";
import { TIMER_CHIP_CLEARANCE } from "./stageLayout";
import { SlideTitle } from "./presenter";

// Big-screen pieces of the Quiz v2 Presenters (plan §3.2 / §3.3). Everything
// sizes in cqw (PresenterStage is the container) so the editor canvas and the
// projector match. Reveal choreography: bars / rows slide up first, then the
// ✅ / ❌ badges fade in REVEAL_BADGE_GAP_S later; reduced motion shows the
// end state at once.

/** Bar / row entrance length (s). */
export const REVEAL_BAR_S = 0.6;
/** Per-item stagger (s). */
export const REVEAL_STAGGER_S = 0.06;
/** Badges fade in this long after the bars finished (plan §3.3: 400 ms). */
export const REVEAL_BADGE_GAP_S = 0.4;

export interface RevealTiming {
	reduced: boolean;
	/** Entrance of item `index` (slide up + fade). */
	item: (index: number) => Transition;
	/** Delay (s) of the ✅ / ❌ badges for `count` staggered items. */
	badgeDelay: (count: number) => number;
	/** Badge transition for `count` staggered items. */
	badge: (count: number) => Transition;
}

export function useRevealTiming(): RevealTiming {
	const reduced = usePrefersReducedMotion();
	const badgeDelay = (count: number) => (reduced ? 0 : REVEAL_BAR_S + Math.max(0, count - 1) * REVEAL_STAGGER_S + REVEAL_BADGE_GAP_S);
	return {
		reduced,
		item: (index) => (reduced ? { duration: 0 } : { duration: REVEAL_BAR_S, delay: index * REVEAL_STAGGER_S, ease: [0.22, 1, 0.36, 1] }),
		badgeDelay,
		badge: (count) => (reduced ? { duration: 0 } : { duration: 0.3, delay: badgeDelay(count), ease: "easeOut" }),
	};
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

/** Question row; keeps the shell's top-right timer chip area (≈ 220 × 56 px) free. */
export function QuizHeader({ title, fallback, aside }: { title: string | null | undefined; fallback: string; aside?: ReactNode }) {
	return (
		<header className="flex shrink-0 items-start justify-between gap-[2cqw]" style={TIMER_CHIP_CLEARANCE}>
			<SlideTitle title={title} fallback={fallback} size="md" />
			{aside ? <div className="flex shrink-0 items-center gap-[1cqw] pt-[0.4cqw]">{aside}</div> : null}
		</header>
	);
}

/** "12 / 30 answered" while answering (public submitted count); nothing without live info. */
export function SubmittedCount({ quiz, className }: { quiz: PresenterQuizInfo | null | undefined; className?: string }) {
	if (!quiz) return null;
	const count = quiz.submitted_count ?? 0;
	const total = quiz.participant_count;
	return (
		<p
			aria-live="polite"
			aria-atomic="true"
			className={cn("m-0 inline-flex items-center gap-[0.6cqw] rounded-full px-[1.2cqw] py-[0.5cqw] font-semibold tabular-nums", className)}
			style={{ background: "var(--deck-surface-muted)", color: "var(--deck-text)", fontSize: "clamp(0.875rem, 1.6cqw, 1.4rem)" }}
		>
			<Users className="h-[1.1em] w-[1.1em]" aria-hidden />
			{total !== null && total !== undefined ? `${count} / ${total}` : count} answered
		</p>
	);
}

/** One-line instruction under the question (waiting / answering). */
export function StageHint({ children }: { children: ReactNode }) {
	return (
		<p className="m-0 shrink-0 font-medium" style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.9rem, 1.7cqw, 1.4rem)" }}>
			{children}
		</p>
	);
}

/** Short status line for a run state (screen readers + the canvas). */
export function quizStageHint(state: RunState, answering: string): string {
	switch (state) {
		case "waiting":
			return "Get your phones ready — the question starts soon.";
		case "get_ready":
			return "Get ready…";
		case "voting":
			return answering;
		default:
			return "";
	}
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

/** ✅ / ❌ disc, faded in after the bars (pass the badge transition). */
export function RevealMark({
	correct,
	transition,
	reduced,
	size = "2.6cqw",
	label,
}: {
	correct: boolean;
	transition: Transition;
	reduced: boolean;
	size?: string;
	/** Screen reader text (default "correct" / "incorrect"). */
	label?: string;
}) {
	const Icon = correct ? Check : X;
	return (
		<motion.span
			initial={reduced ? false : { opacity: 0, scale: 0.6 }}
			animate={{ opacity: 1, scale: 1 }}
			transition={transition}
			className="inline-flex shrink-0 items-center justify-center rounded-full"
			style={{
				width: size,
				height: size,
				minWidth: 20,
				minHeight: 20,
				background: correct ? "var(--deck-success)" : "var(--deck-danger)",
				color: "#fff",
			}}
		>
			<Icon className="h-[62%] w-[62%]" strokeWidth={3} aria-hidden />
			<span className="sr-only">{label ?? (correct ? "correct" : "incorrect")}</span>
		</motion.span>
	);
}

/** A letter badge in the option's chart colour. */
export function LetterBadge({ index, theme, size = "3.4cqw", muted = false }: { index: number; theme: DeckTheme; size?: string; muted?: boolean }) {
	return (
		<span
			aria-hidden
			className="flex shrink-0 items-center justify-center rounded-[0.7cqw] font-bold"
			style={{
				width: size,
				height: size,
				fontSize: `calc(${size} * 0.5)`,
				background: muted ? "var(--deck-surface-muted)" : chartColor(theme, index),
				color: muted ? "var(--deck-text-muted)" : "#fff",
			}}
		>
			{optionLetter(index)}
		</span>
	);
}

/* ------------------------------------------------------------------ */
/* Choice tiles (waiting / answering)                                  */
/* ------------------------------------------------------------------ */

export interface ChoiceTile {
	id: string | number;
	label: string;
	imageUrl?: string | null;
}

/** Options as tiles with letter badges — never a correct-answer hint. */
export function ChoiceTiles({ items, theme, ariaLabel }: { items: ChoiceTile[]; theme: DeckTheme; ariaLabel: string }) {
	const n = items.length;
	const columns = n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 5;
	const rows = Math.ceil(n / columns);
	const big = rows <= 2 && columns <= 2;
	return (
		<ul
			aria-label={ariaLabel}
			className="m-0 grid min-h-0 flex-1 list-none content-center gap-[1.4cqw] p-0"
			style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
		>
			{items.map((item, index) => (
				<li
					key={item.id}
					className="flex min-h-0 items-center gap-[1.2cqw] overflow-hidden rounded-[1.2cqw] border-2 p-[1.2cqw]"
					style={{ borderColor: "var(--deck-border)", background: "var(--deck-surface)", borderLeft: `0.6cqw solid ${chartColor(theme, index)}` }}
				>
					<LetterBadge index={index} theme={theme} size={big ? "4cqw" : "3.2cqw"} />
					{item.imageUrl ? (
						<img
							src={item.imageUrl}
							alt=""
							draggable={false}
							className="shrink-0 rounded-[0.8cqw] object-cover"
							style={{ width: big ? "9cqw" : "6cqw", height: big ? "9cqw" : "6cqw" }}
						/>
					) : null}
					<span
						className="line-clamp-3 min-w-0 break-words font-semibold leading-tight"
						style={{ fontSize: big ? "clamp(1rem, 2.6cqw, 2.4rem)" : n > 8 ? "clamp(0.8rem, 1.5cqw, 1.3rem)" : "clamp(0.9rem, 1.9cqw, 1.7rem)" }}
					>
						{item.label}
					</span>
				</li>
			))}
		</ul>
	);
}

/* ------------------------------------------------------------------ */
/* Reveal bars                                                         */
/* ------------------------------------------------------------------ */

export interface RevealBarItem {
	id: string | number;
	label: string;
	imageUrl?: string | null;
	/** Bar length driver (e.g. count). */
	value: number;
	/** Text above the bar, e.g. "42%". */
	display: string;
	/** Extra muted line under the label, e.g. "12 players". */
	detail?: string;
	correct: boolean;
}

/**
 * Reveal column chart: bars slide up (staggered), then the ✅ / ❌ badges
 * fade in and the wrong options dim. Bars keep the option's chart colour so
 * they match the answering tiles; a hidden table carries the numbers.
 */
export function RevealBars({ items, theme, ariaLabel }: { items: RevealBarItem[]; theme: DeckTheme; ariaLabel: string }) {
	const timing = useRevealTiming();
	const max = Math.max(1, ...items.map((item) => item.value));
	const hasImages = items.some((item) => !!item.imageUrl);
	const dense = items.length > 6;
	const badge = timing.badge(items.length);

	return (
		<figure aria-label={ariaLabel} className="m-0 flex min-h-0 flex-1 flex-col">
			<div className="flex min-h-0 flex-1 items-stretch gap-[1.6cqw]" aria-hidden>
				{items.map((item, index) => {
					// Up to 86% so the value label above the tallest bar stays on the stage.
					const height = Math.max(1.5, (item.value / max) * 86);
					return (
						<div key={item.id} className="relative flex min-w-0 flex-1 flex-col justify-end">
							<motion.div
								className="absolute inset-x-[10%] bottom-0 flex flex-col items-center"
								style={{ height: `${height}%`, transformOrigin: "bottom" }}
								initial={timing.reduced ? false : { scaleY: 0, opacity: 1 }}
								animate={{ scaleY: 1, opacity: item.correct ? 1 : 0.42 }}
								transition={{ scaleY: timing.item(index), opacity: timing.reduced ? { duration: 0 } : { duration: 0.35, delay: timing.badgeDelay(items.length) } }}
							>
								<div className="h-full w-full rounded-t-[0.9cqw]" style={{ background: chartColor(theme, index) }} />
							</motion.div>
							<motion.span
								className="absolute inset-x-0 text-center font-bold tabular-nums"
								style={{ bottom: `calc(${height}% + 0.5cqw)`, fontSize: dense ? "clamp(0.85rem, 1.6cqw, 1.4rem)" : "clamp(1rem, 2.2cqw, 2rem)" }}
								initial={timing.reduced ? false : { opacity: 0, y: 8 }}
								animate={{ opacity: 1, y: 0 }}
								transition={timing.reduced ? { duration: 0 } : { duration: 0.3, delay: REVEAL_BAR_S * 0.7 + index * REVEAL_STAGGER_S }}
							>
								{item.display}
							</motion.span>
						</div>
					);
				})}
			</div>
			<div className="flex shrink-0 gap-[1.6cqw] pt-[1cqw]" style={{ minHeight: hasImages ? "13cqw" : "7cqw" }} aria-hidden>
				{items.map((item, index) => (
					<div key={item.id} className="flex min-w-0 flex-1 flex-col items-center gap-[0.6cqw] text-center">
						<div className="flex items-center gap-[0.6cqw]">
							<LetterBadge index={index} theme={theme} size={dense ? "2.4cqw" : "2.8cqw"} />
							<RevealMark correct={item.correct} transition={badge} reduced={timing.reduced} size={dense ? "2.4cqw" : "2.8cqw"} />
						</div>
						{item.imageUrl ? (
							<img src={item.imageUrl} alt="" draggable={false} className="rounded-[0.6cqw] object-cover" style={{ width: "6cqw", height: "6cqw" }} />
						) : null}
						<span
							className={cn("line-clamp-2 w-full break-words font-semibold leading-tight", !item.correct && "opacity-80")}
							style={{ fontSize: dense ? "clamp(0.75rem, 1.3cqw, 1.1rem)" : "clamp(0.85rem, 1.7cqw, 1.5rem)" }}
						>
							{item.label}
						</span>
						{item.detail ? (
							<span style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.7rem, 1.1cqw, 0.95rem)" }}>{item.detail}</span>
						) : null}
					</div>
				))}
			</div>
			<table className="sr-only">
				<caption>{ariaLabel}</caption>
				<tbody>
					{items.map((item) => (
						<tr key={item.id}>
							<th scope="row">{item.label}</th>
							<td>
								{item.display}
								{item.detail ? `, ${item.detail}` : ""}
							</td>
							<td>{item.correct ? "correct" : "incorrect"}</td>
						</tr>
					))}
				</tbody>
			</table>
		</figure>
	);
}

/* ------------------------------------------------------------------ */
/* Rows and summary                                                    */
/* ------------------------------------------------------------------ */

/** A thin 0..100 % bar (per-pair / per-item correctness). */
export function PercentBar({ value, tone = "success", delay = 0, reduced }: { value: number; tone?: "success" | "primary" | "muted"; delay?: number; reduced: boolean }) {
	const width = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
	const color = tone === "success" ? "var(--deck-success)" : tone === "primary" ? "var(--deck-primary)" : "var(--deck-text-muted)";
	return (
		<span className="block h-[0.8cqw] min-h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--deck-surface-muted)" }} aria-hidden>
			<motion.span
				className="block h-full rounded-full"
				style={{ background: color, transformOrigin: "left", width: `${width}%` }}
				initial={reduced ? false : { scaleX: 0 }}
				animate={{ scaleX: 1 }}
				transition={reduced ? { duration: 0 } : { duration: REVEAL_BAR_S, delay, ease: [0.22, 1, 0.36, 1] }}
			/>
		</span>
	);
}

/** "18 of 30 fully correct" summary chip of a revealed run. */
export function CorrectSummary({ correct, total, partial }: { correct: number; total: number; partial?: number }) {
	const style: CSSProperties = { background: "var(--deck-surface-muted)", color: "var(--deck-text)", fontSize: "clamp(0.875rem, 1.5cqw, 1.3rem)" };
	return (
		<p aria-live="polite" className="m-0 inline-flex items-center gap-[0.6cqw] rounded-full px-[1.2cqw] py-[0.5cqw] font-semibold tabular-nums" style={style}>
			<Check className="h-[1.1em] w-[1.1em]" style={{ color: "var(--deck-success)" }} aria-hidden />
			{total > 0 ? `${correct} / ${total} correct` : "No answers"}
			{partial ? <span style={{ color: "var(--deck-text-muted)" }}> · {partial} partly</span> : null}
		</p>
	);
}

/** Centered message on the stage (e.g. "Revealing…" while a slim reveal refetches). */
export function StageMessage({ children }: { children: ReactNode }) {
	return (
		<div role="status" className="flex min-h-0 flex-1 items-center justify-center text-center font-medium" style={{ color: "var(--deck-text-muted)", fontSize: "clamp(1rem, 2.2cqw, 1.75rem)" }}>
			{children}
		</div>
	);
}
