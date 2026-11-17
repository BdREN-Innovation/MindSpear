"use client";

import { Fragment, type CSSProperties, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import type { DeckTheme } from "@/features/deck/theme";
import type { BlanksAggregate, RunState, SentencePart } from "@/features/deck/types";
import { blankCount, compareForm } from "@/features/deck/lib/blanks";
import { PresenterStage } from "./presenter";
import { formatPercent } from "./labels";
import { quizFallbackTitle } from "./quizLabels";
import { CorrectSummary, QuizHeader, StageHint, StageMessage, useRevealTiming } from "./quizPresenter";

// fill_blanks / drag_drop: the sentence with its blanks, shared by the big
// screen and phones. Text runs keep their line breaks; each blank is drawn by
// the caller (an input, a drop slot, a revealed answer…).

export type BlanksType = "fill_blanks" | "drag_drop";

/** The sentence in reading order with `renderBlank(i)` in each gap. */
export function SentenceText({
	parts,
	renderBlank,
	className,
	style,
}: {
	parts: readonly SentencePart[];
	renderBlank: (index: number) => ReactNode;
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<p className={className} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...style }}>
			{parts.map((part, index) => (
				<Fragment key={index}>{"blank" in part ? renderBlank(part.blank) : part.text}</Fragment>
			))}
		</p>
	);
}

/** Whether `value` is one of `answers` (the server's comparison: cleaned, NFC, case-folded unless case-sensitive). */
export function blankIsRight(value: string | null | undefined, answers: readonly string[] | undefined, caseSensitive: boolean): boolean {
	if (!value || !answers?.length) return false;
	const form = compareForm(value, caseSensitive);
	return form !== "" && answers.some((answer) => compareForm(answer, caseSensitive) === form);
}

/* ------------------------------------------------------------------ */
/* Big screen                                                          */
/* ------------------------------------------------------------------ */

function EmptySlot({ index }: { index: number }) {
	return (
		<span
			className="mx-[0.3cqw] inline-flex min-w-[9cqw] items-end justify-center rounded-[0.5cqw] border-b-[0.35cqw] px-[0.6cqw] align-baseline"
			style={{ borderColor: "var(--deck-primary)", background: "color-mix(in srgb, var(--deck-primary) 10%, transparent)" }}
		>
			<span className="font-bold tabular-nums" style={{ fontSize: "0.6em", color: "var(--deck-text-muted)" }}>
				{index + 1}
			</span>
			<span className="sr-only"> blank {index + 1}</span>
		</span>
	);
}

/**
 * fill_blanks / drag_drop on the presenter. Before the reveal: the sentence
 * with numbered empty blanks (drag_drop: the word bank under it). Reveal:
 * each blank filled with its answer and the share of players who got it.
 */
export function BlanksPresenter({
	type,
	title,
	parts,
	words,
	aggregate,
	state,
	theme,
	mode,
}: {
	type: BlanksType;
	title: string | null;
	parts: readonly SentencePart[];
	/** drag_drop: the word bank (run option labels). */
	words?: readonly { id: string | number; label: string | null }[];
	aggregate: BlanksAggregate | null;
	state: RunState;
	theme: DeckTheme;
	mode: "live" | "preview";
}) {
	const timing = useRevealTiming();
	const revealed = state === "reveal" || state === "closed";
	const count = blankCount(parts);
	const long = parts.reduce((sum, part) => sum + ("text" in part ? part.text.length : 12), 0) > 220;
	const sentenceStyle: CSSProperties = { fontSize: long ? "clamp(1rem, 2.4cqw, 2.2rem)" : "clamp(1.2rem, 3.4cqw, 3.2rem)", lineHeight: 1.6 };

	let aside: ReactNode = null;
	let body: ReactNode;
	if (count === 0) {
		body = <StageMessage>{mode === "preview" ? "Type a sentence and put the missing words in [square brackets]." : "This slide has no blanks."}</StageMessage>;
	} else if (!revealed) {
		body = (
			<>
				<StageHint>
					{state === "voting"
						? type === "drag_drop"
							? "Drag the words into the blanks on your phone."
							: "Fill in the blanks on your phone."
						: "Answer on your phone when the question starts."}
				</StageHint>
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[2cqw]">
					<SentenceText parts={parts} renderBlank={(index) => <EmptySlot index={index} />} className="m-0 max-w-[90%] text-center font-semibold" style={sentenceStyle} />
					{type === "drag_drop" && words && words.length > 0 ? (
						<ul aria-label="Words" className="m-0 flex list-none flex-wrap justify-center gap-[0.8cqw] p-0">
							{words.map((word) => (
								<li
									key={word.id}
									className="rounded-[0.8cqw] border-2 px-[1.2cqw] py-[0.4cqw] font-semibold"
									style={{ borderColor: "var(--deck-border)", background: "var(--deck-surface)", fontSize: "clamp(0.85rem, 1.8cqw, 1.6rem)" }}
								>
									{word.label}
								</li>
							))}
						</ul>
					) : null}
				</div>
			</>
		);
	} else if (!aggregate) {
		body = <StageMessage>Revealing the answer…</StageMessage>;
	} else {
		const answers = aggregate.correct?.blanks ?? [];
		aside = <CorrectSummary correct={aggregate.correct_responses} total={aggregate.total_responses} partial={aggregate.partially_correct_responses} />;
		body = (
			<div className="flex min-h-0 flex-1 items-center justify-center">
				<SentenceText
					parts={parts}
					className="m-0 max-w-[90%] text-center font-semibold"
					style={sentenceStyle}
					renderBlank={(index) => {
						const result = aggregate.blanks?.[index];
						return (
							<motion.span
								className="mx-[0.3cqw] inline-flex flex-col items-center rounded-[0.6cqw] px-[0.8cqw] align-middle leading-tight"
								style={{ background: "color-mix(in srgb, var(--deck-success, #15803D) 16%, var(--deck-surface))", color: "var(--deck-text)" }}
								initial={timing.reduced ? false : { opacity: 0, y: 10 }}
								animate={{ opacity: 1, y: 0 }}
								transition={timing.item(index)}
							>
								<span style={{ color: "var(--deck-success, #15803D)" }}>{answers[index]?.answers[0] ?? "—"}</span>
								{result ? (
									<span className="font-bold tabular-nums" style={{ fontSize: "0.45em", color: "var(--deck-text-muted)" }}>
										{formatPercent(result.correct_percentage)}
										<span className="sr-only"> of players got blank {index + 1} right</span>
									</span>
								) : null}
							</motion.span>
						);
					}}
				/>
			</div>
		);
	}

	return (
		<PresenterStage style={theme.cssVars as CSSProperties}>
			<QuizHeader title={title} fallback={quizFallbackTitle(type)} aside={aside} />
			{body}
		</PresenterStage>
	);
}

/* ------------------------------------------------------------------ */
/* Phone: my answers in the sentence                                   */
/* ------------------------------------------------------------------ */

/**
 * The sentence with my answers in it: neutral before the reveal; after it,
 * right ones green and wrong or empty ones red with the answer beside them.
 */
export function SentenceWithAnswers({
	parts,
	mine,
	correct,
	caseSensitive,
}: {
	parts: readonly SentencePart[];
	mine: readonly (string | null)[];
	/** Accepted answers per blank; omit before the reveal. */
	correct?: readonly { answers: string[] }[];
	caseSensitive: boolean;
}) {
	return (
		<SentenceText
			parts={parts}
			className="m-0 text-lg leading-loose"
			renderBlank={(index) => {
				const value = mine[index] ?? null;
				const answers = correct?.[index]?.answers;
				if (!correct) {
					return (
						<span className="mx-0.5 rounded-md px-1.5 py-0.5 font-semibold" style={{ background: "var(--deck-surface-muted, #F3F4F6)" }}>
							{value ?? "____"}
						</span>
					);
				}
				const right = blankIsRight(value, answers, caseSensitive);
				return (
					<span className="mx-0.5 inline-flex flex-wrap items-center gap-1 align-middle">
						<span
							className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold"
							style={{
								background: right
									? "color-mix(in srgb, var(--deck-success, #15803D) 16%, var(--deck-surface, #fff))"
									: "color-mix(in srgb, var(--deck-danger, #B91C1C) 14%, var(--deck-surface, #fff))",
								textDecoration: right || value === null ? undefined : "line-through",
							}}
						>
							{right ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
							{value ?? "empty"}
							<span className="sr-only">{right ? " (right)" : " (wrong)"}</span>
						</span>
						{!right && answers?.[0] ? (
							<span className="rounded-md px-1.5 py-0.5 font-semibold" style={{ background: "color-mix(in srgb, var(--deck-success, #15803D) 16%, var(--deck-surface, #fff))" }}>
								<span className="sr-only">Answer: </span>
								{answers[0]}
							</span>
						) : null}
					</span>
				);
			}}
		/>
	);
}
