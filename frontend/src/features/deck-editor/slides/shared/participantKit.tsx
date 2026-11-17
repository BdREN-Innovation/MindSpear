"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DeckTheme } from "@/features/deck/theme";
import type { RunState } from "@/features/deck/types";

// Phone layout pieces every live type's Participant shares: the themed
// column, notices, the "your answer" card and the results block shown
// whenever the shell passes an aggregate (results are public).

/** Themed phone column: question on top, body, and an optional sticky footer (SubmitBar). */
export function ParticipantLayout({
	title,
	subtitle,
	subtitleId,
	children,
	footer,
	className,
	theme,
}: {
	/** Sets the --deck-* variables here too, so the screen is themed even outside a DeckThemeProvider. */
	theme?: DeckTheme;
	/** Already resolved (displayTitle): the question or the type's fallback. */
	title: string;
	/** Instruction line under the question, e.g. "Pick up to 3". */
	subtitle?: ReactNode;
	/** id for the subtitle, so a control can point aria-describedby at it. */
	subtitleId?: string;
	children: ReactNode;
	footer?: ReactNode;
	className?: string;
}) {
	const style: CSSProperties = {
		...(theme?.cssVars as CSSProperties | undefined),
		background: "var(--deck-bg, #fff)",
		color: "var(--deck-text, #111928)",
	};
	return (
		<div className={cn("flex min-h-full w-full flex-col", className)} style={style}>
			<div className="flex flex-1 flex-col gap-4 px-4 pb-6 pt-5">
				<header className="flex flex-col gap-1">
					<h2 className="m-0 break-words text-xl font-bold leading-snug sm:text-2xl">{title}</h2>
					{subtitle ? (
						<p id={subtitleId} className="m-0 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
							{subtitle}
						</p>
					) : null}
				</header>
				{children}
			</div>
			{footer}
		</div>
	);
}

/**
 * Read-only views: the review screen, and a closed run (the shell's
 * "Voting is closed" banner sits above, so no locked form underneath).
 */
export function isReadOnlyView(mode: "live" | "preview" | "review" | undefined, state: RunState): boolean {
	return mode === "review" || state === "closed";
}

/** Why the controls are locked, from the run state (null while voting). */
export function notVotingMessage(state: RunState): string | null {
	switch (state) {
		case "waiting":
		case "get_ready":
			return "Voting opens when the host starts this slide.";
		case "closed":
			return "Voting is closed for this slide.";
		default:
			return null;
	}
}

/** A polite one-line notice (locked controls, offline, …). */
export function ParticipantNotice({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
	return (
		<p
			role={tone === "danger" ? "alert" : "status"}
			className="m-0 rounded-xl px-3 py-2 text-sm"
			style={{
				background: "var(--deck-surface-muted, #F3F4F6)",
				color: tone === "danger" ? "var(--deck-danger, #B91C1C)" : "var(--deck-text-muted, #4B5563)",
			}}
		>
			{children}
		</p>
	);
}

/** Small read-only answer summary card (inside SubmittedState, or alone in read-only views). */
export function AnswerSummary({ children, label = "Your answer" }: { children: ReactNode; label?: string }) {
	return (
		<div
			className="flex w-full flex-col gap-2 rounded-xl border p-3 text-left"
			style={{ borderColor: "var(--deck-border, #E5E7EB)", background: "var(--deck-surface, #fff)" }}
		>
			<p className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
				{label}
			</p>
			{children}
		</div>
	);
}

/** "Final results" after the session, "Results" once voting closed, "Live results" while it runs. */
export function resultsTitle(mode: "live" | "preview" | "review" | undefined, state: RunState): string {
	if (mode === "review") return "Final results";
	return state === "closed" ? "Results" : "Live results";
}

/**
 * The compact results block of a Participant: a labelled section with an
 * optional "12 responses" line. Updates are announced politely, but only the
 * summary line (a full chart re-read on every vote would be noise).
 */
export function ResultsSection({
	title,
	summary,
	children,
	className,
}: {
	title: string;
	summary?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section aria-label={title} className={cn("flex w-full flex-col gap-2 text-left", className)}>
			<div className="flex items-baseline justify-between gap-3">
				<h3 className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					{title}
				</h3>
				{summary ? (
					<p aria-live="polite" className="m-0 text-xs tabular-nums" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
						{summary}
					</p>
				) : null}
			</div>
			{children}
		</section>
	);
}

/** "12 responses" / "1 vote" for a results summary line. */
export function countLabel(count: number, singular: string, plural: string): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

/** A labelled 0..100 % bar row for compact results (poll options, points, …). */
export function ResultBar({
	label,
	value,
	display,
	highlight = false,
	detail,
}: {
	label: ReactNode;
	/** 0..100 */
	value: number;
	display: string;
	highlight?: boolean;
	/** Extra muted text after the label (e.g. "you: 30"). */
	detail?: ReactNode;
}) {
	const width = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
	return (
		<li className="flex flex-col gap-1">
			<div className="flex items-baseline justify-between gap-2 text-sm">
				<span className={cn("min-w-0 break-words", highlight && "font-semibold")}>
					{label}
					{detail ? (
						<span className="ml-1.5 text-xs font-normal" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
							{detail}
						</span>
					) : null}
				</span>
				<span className="shrink-0 font-semibold tabular-nums">{display}</span>
			</div>
			<div className="h-2.5 w-full overflow-hidden rounded-full" style={{ background: "var(--deck-surface-muted, #F3F4F6)" }} aria-hidden>
				<div
					className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500"
					style={{
						width: `${width}%`,
						background: highlight ? "var(--deck-primary, #F79945)" : "var(--deck-text-muted, #9CA3AF)",
					}}
				/>
			</div>
		</li>
	);
}
