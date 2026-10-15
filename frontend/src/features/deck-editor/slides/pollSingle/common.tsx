"use client";

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DeckTheme } from "@/features/deck/theme";
import { DECK_LIMITS, type RunOption, type RunState, type SlidePatch, type SlideTypeKey } from "@/features/deck/types";
import { TextField } from "../shared";

// Pieces the six poll type folders (pollSingle, pollMulti, wordCloud,
// openEnded, scales, ranking) share: the question field of every Editor, the
// phone layout of every Participant, the "my latest answer" bookkeeping and
// deterministic sample numbers for the editor canvas preview.

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

/** The slide question (slides.title ≤ 280), debounced like every inspector field. */
export function QuestionField<K extends SlideTypeKey>({
	title,
	onChange,
	errors,
	disabled,
	placeholder = "Ask your audience something…",
	label = "Question",
}: {
	title: string | null;
	onChange: (patch: SlidePatch<K>) => void;
	errors?: Record<string, string[]>;
	disabled?: boolean;
	placeholder?: string;
	label?: string;
}) {
	return (
		<TextField
			label={label}
			value={title ?? ""}
			onChange={(value) => onChange({ title: value.trim() === "" ? null : value } as SlidePatch<K>)}
			debounceMs={500}
			maxLength={DECK_LIMITS.maxSlideTitle}
			showCount
			placeholder={placeholder}
			error={errors?.title}
			disabled={disabled}
		/>
	);
}

/** A titled group of inspector fields. */
export function EditorGroup({ title, children }: { title: string; children: ReactNode }) {
	return (
		<fieldset className="flex min-w-0 flex-col gap-4 border-0 p-0">
			<legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">{title}</legend>
			{children}
		</fieldset>
	);
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

/** Option label with a readable fallback for empty options ("Option B"). */
export function optionLabel(option: Pick<RunOption, "label"> | undefined, index: number, noun = "Option"): string {
	const label = option?.label?.trim();
	if (label) return label;
	return `${noun} ${index < 26 ? String.fromCharCode(65 + index) : index + 1}`;
}

/** Statement / item label fallback with a number ("Statement 2"). */
export function numberedLabel(option: Pick<RunOption, "label"> | undefined, index: number, noun: string): string {
	const label = option?.label?.trim();
	return label || `${noun} ${index + 1}`;
}

/** Percentage text for chart labels: whole numbers, one decimal under 10 (e.g. "7.5%"). */
export function formatPercent(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return "0%";
	return value < 10 && Math.round(value) !== value ? `${value.toFixed(1)}%` : `${Math.round(value)}%`;
}

/* ------------------------------------------------------------------ */
/* Participant layout                                                  */
/* ------------------------------------------------------------------ */

/** Themed phone column: question on top, body, and an optional sticky footer (SubmitBar). */
export function ParticipantLayout({
	title,
	fallbackTitle,
	subtitle,
	children,
	footer,
	className,
	theme,
}: {
	/** Sets the --deck-* variables here too, so the screen is themed even outside a DeckThemeProvider. */
	theme?: DeckTheme;
	title: string | null;
	fallbackTitle: string;
	/** Instruction line under the question, e.g. "Pick up to 3". */
	subtitle?: ReactNode;
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
					<h2 className="m-0 break-words text-xl font-bold leading-snug sm:text-2xl">{title?.trim() || fallbackTitle}</h2>
					{subtitle ? (
						<p className="m-0 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
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

/** Small read-only answer summary card used inside SubmittedState. */
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

/* ------------------------------------------------------------------ */
/* Answer bookkeeping                                                  */
/* ------------------------------------------------------------------ */

interface LocalAnswers<S> {
	runId: number;
	/** The mySubmission these local answers were sent on top of. */
	base: S | null;
	values: S[];
}

/**
 * The participant's answers as the server holds them plus the ones sent from
 * this screen since. Answers return 204, so until the shell hands a fresher
 * `mySubmission` (state refetch / reconnect) the locally sent ones fill in;
 * once it changes, it is the truth again and the local list is dropped.
 */
export function useAnswerHistory<S>(runId: number, mySubmission: S | null) {
	const [local, setLocal] = useState<LocalAnswers<S> | null>(null);
	const sent = local && local.runId === runId && local.base === mySubmission ? local.values : [];

	const record = useCallback(
		(value: S) =>
			setLocal((previous) => {
				const keep = previous && previous.runId === runId && previous.base === mySubmission ? previous.values : [];
				return { runId, base: mySubmission, values: [...keep, value] };
			}),
		[runId, mySubmission]
	);

	/** The latest answer (replace semantics). */
	const latest: S | null = sent.length > 0 ? sent[sent.length - 1] : mySubmission;
	return { latest, sent, record };
}

/* ------------------------------------------------------------------ */
/* Preview samples                                                     */
/* ------------------------------------------------------------------ */

const SAMPLE_SEQUENCE = [14, 9, 21, 6, 17, 11, 4, 19, 8, 13, 5, 16];

/** A stable pseudo-random sample count for item `index` (no Math.random: previews must not flicker or mismatch on hydration). */
export function sampleCount(index: number, salt = 0): number {
	return SAMPLE_SEQUENCE[(index * 7 + salt * 5) % SAMPLE_SEQUENCE.length];
}

/** A fixed ISO time `minutesAgo` before a constant reference instant (stable across renders). */
export function sampleTime(minutesAgo: number): string {
	return new Date(Date.UTC(2026, 0, 1, 12, 0, 0) - minutesAgo * 60_000).toISOString();
}
