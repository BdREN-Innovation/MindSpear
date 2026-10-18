"use client";

import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import { Keyboard } from "lucide-react";
import type { PresenterProps } from "../types";
import { PresenterStage } from "../shared";
import { formatPercent } from "../shared/labels";
import { quizFallbackTitle } from "../shared/quizLabels";
import { CorrectSummary, PercentBar, QuizHeader, RevealMark, StageHint, StageMessage, useRevealTiming } from "../shared/quizPresenter";

// short_answer on the big screen: waiting / answering show the question and
// a "type on your phone" card; the reveal shows the accepted answers
// prominently, then the most common submitted answers with ✅ / ❌.

export function ShortAnswerPresenter({ run, aggregate, state, theme }: PresenterProps<"short_answer">) {
	const fallback = quizFallbackTitle("short_answer");
	const revealed = state === "reveal" || state === "closed";
	const timing = useRevealTiming();

	let aside: ReactNode = null;
	let body: ReactNode;
	if (!revealed) {
		body = (
			<>
				<StageHint>{state === "voting" ? "Type your answer on your phone." : "Answer on your phone when the question starts."}</StageHint>
				<div className="flex min-h-0 flex-1 items-center justify-center">
					<div
						className="flex w-[70%] items-center gap-[1.6cqw] rounded-[1.4cqw] border-2 border-dashed px-[2.4cqw] py-[2cqw]"
						style={{ borderColor: "var(--deck-border)", background: "var(--deck-surface)", color: "var(--deck-text-muted)" }}
					>
						<Keyboard className="h-[4cqw] w-[4cqw] shrink-0" aria-hidden />
						<span className="font-medium" style={{ fontSize: "clamp(1rem, 2.6cqw, 2.2rem)" }}>
							Type your answer…
						</span>
					</div>
				</div>
			</>
		);
	} else if (!aggregate) {
		body = <StageMessage>Revealing the answer…</StageMessage>;
	} else {
		const accepted = aggregate.correct?.accepted_answers ?? [];
		const rows = aggregate.answers ?? [];
		const max = Math.max(1, ...rows.map((row) => row.count));
		const badge = timing.badge(rows.length);
		aside = <CorrectSummary correct={aggregate.correct_responses} total={aggregate.total_responses} />;
		body = (
			<div className="flex min-h-0 flex-1 flex-col gap-[2cqw]">
				<section aria-label="Accepted answers" className="flex shrink-0 flex-wrap items-center gap-[1cqw]">
					<span className="font-semibold uppercase tracking-wide" style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.75rem, 1.3cqw, 1.1rem)" }}>
						{accepted.length === 1 ? "Correct answer" : "Accepted answers"}
					</span>
					{accepted.length === 0 ? <span style={{ color: "var(--deck-text-muted)" }}>None set</span> : null}
					{accepted.map((answer, index) => (
						<motion.span
							key={`${answer}-${index}`}
							className="rounded-full px-[1.6cqw] py-[0.6cqw] font-bold"
							style={{ background: "var(--deck-success)", color: "#fff", fontSize: "clamp(1rem, 2.4cqw, 2.2rem)" }}
							initial={timing.reduced ? false : { opacity: 0, scale: 0.8 }}
							animate={{ opacity: 1, scale: 1 }}
							transition={timing.reduced ? { duration: 0 } : { duration: 0.35, delay: index * 0.08 }}
						>
							{answer}
						</motion.span>
					))}
				</section>

				{rows.length === 0 ? (
					<StageMessage>Nobody answered this one.</StageMessage>
				) : (
					<ol aria-label="Most common answers" className="m-0 flex min-h-0 flex-1 list-none flex-col gap-[0.9cqw] overflow-hidden p-0">
						{rows.map((row, index) => (
							<motion.li
								key={`${row.text}-${index}`}
								className="flex items-center gap-[1.4cqw] rounded-[1cqw] px-[1.4cqw] py-[0.7cqw]"
								style={{
									background: row.is_correct ? "color-mix(in srgb, var(--deck-success) 14%, var(--deck-surface))" : "var(--deck-surface)",
									border: `1px solid ${row.is_correct ? "var(--deck-success)" : "var(--deck-border)"}`,
								}}
								initial={timing.reduced ? false : { opacity: 0, y: 16 }}
								animate={{ opacity: 1, y: 0 }}
								transition={timing.item(index)}
							>
								<span className="w-[26%] min-w-0 truncate font-semibold" style={{ fontSize: "clamp(0.9rem, 1.8cqw, 1.6rem)" }} title={row.text}>
									{row.text}
								</span>
								<span className="flex min-w-0 flex-1">
									<PercentBar value={(row.count / max) * 100} tone={row.is_correct ? "success" : "muted"} delay={index * 0.06} reduced={timing.reduced} />
								</span>
								<span className="w-[9cqw] shrink-0 text-right font-bold tabular-nums" style={{ fontSize: "clamp(0.85rem, 1.6cqw, 1.4rem)" }}>
									{row.count} · {formatPercent(row.percentage)}
								</span>
								<RevealMark correct={row.is_correct} transition={badge} reduced={timing.reduced} size="2.4cqw" />
							</motion.li>
						))}
					</ol>
				)}
				{aggregate.answers_truncated || aggregate.distinct_answers > rows.length ? (
					<p className="m-0 shrink-0" style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.75rem, 1.2cqw, 1rem)" }}>
						Top {rows.length} of {aggregate.distinct_answers} different answers
					</p>
				) : null}
			</div>
		);
	}

	return (
		<PresenterStage style={theme.cssVars as CSSProperties}>
			<QuizHeader title={run.title} fallback={fallback} aside={aside} />
			{body}
		</PresenterStage>
	);
}
