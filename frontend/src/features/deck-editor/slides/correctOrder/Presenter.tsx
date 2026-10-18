/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import type { CorrectOrderAggregate, OpaqueOptionId } from "@/features/deck/types";
import type { PresenterProps } from "../types";
import { PresenterStage } from "../shared";
import { formatPercent, numberedLabel } from "../shared/labels";
import { plural, quizFallbackTitle } from "../shared/quizLabels";
import { CorrectSummary, PercentBar, QuizHeader, RevealMark, StageHint, StageMessage, useRevealTiming } from "../shared/quizPresenter";

// correct_order on the big screen. Waiting / answering: the items in the
// players' shuffled order. Reveal: the correct order with the share of players
// who put each item in its slot, next to the most common submitted order with
// ✅ / ❌ per position. "Most common" only when one order really is: a lone
// player's order is just "their answer", and when no order was given by more
// players than any other (every order different, or a reported tie) the
// column says so instead of showing an arbitrary one.

interface Row {
	label: string;
	imageUrl: string | null;
}

function ItemRow({ position, row, dense, children, tone }: { position?: number; row: Row; dense: boolean; children?: ReactNode; tone?: "success" | "danger" }) {
	const accent = tone === "success" ? "var(--deck-success)" : tone === "danger" ? "var(--deck-danger)" : "var(--deck-border)";
	return (
		<div
			className="flex min-w-0 items-center gap-[1.2cqw] rounded-[1cqw] border-2 px-[1.2cqw]"
			style={{ borderColor: accent, background: "var(--deck-surface)", paddingBlock: dense ? "0.45cqw" : "0.8cqw" }}
		>
			{position !== undefined ? (
				<span
					aria-hidden
					className="flex shrink-0 items-center justify-center rounded-full font-bold tabular-nums"
					style={{ width: "3cqw", height: "3cqw", fontSize: "clamp(0.8rem, 1.5cqw, 1.3rem)", background: "var(--deck-surface-muted)", color: "var(--deck-text-muted)" }}
				>
					{position}
				</span>
			) : null}
			{row.imageUrl ? <img src={row.imageUrl} alt="" draggable={false} className="shrink-0 rounded-[0.6cqw] object-cover" style={{ width: "3.6cqw", height: "3.6cqw" }} /> : null}
			<span className="line-clamp-1 min-w-0 flex-1 break-words font-semibold" style={{ fontSize: dense ? "clamp(0.8rem, 1.5cqw, 1.3rem)" : "clamp(0.95rem, 1.9cqw, 1.7rem)" }}>
				{row.label}
			</span>
			{children}
		</div>
	);
}

type CommonColumn =
	| { kind: "none" }
	| { kind: "tie"; message: string }
	| { kind: "order"; heading: string; order: OpaqueOptionId[] };

/** What the right-hand column shows (see the header comment). */
function commonColumn(aggregate: CorrectOrderAggregate): CommonColumn {
	const common = aggregate.most_common_order;
	if (!common || common.order.length === 0) return { kind: "none" };
	const total = aggregate.total_responses;
	// Optional tie flag, should the server ever report ties with a count above 1.
	const tied = (common as { tied?: unknown }).tied === true;
	if (total <= 1) return { kind: "order", heading: "Submitted answer · 1 player", order: common.order };
	if (common.count <= 1) return { kind: "tie", message: "Every player chose a different order." };
	if (tied) return { kind: "tie", message: "No single most common answer — several orders tied." };
	return { kind: "order", heading: `Most common answer · ${plural(common.count, "player")}`, order: common.order };
}

export function CorrectOrderPresenter({ run, aggregate, state, theme }: PresenterProps<"correct_order">) {
	const timing = useRevealTiming();
	const rows = new Map<OpaqueOptionId, Row>(run.options.map((option, index) => [option.id, { label: numberedLabel(option, index, "Item"), imageUrl: option.image_url }]));
	const dense = run.options.length > 5;
	const revealed = state === "reveal" || state === "closed";
	const unknown: Row = { label: "Item", imageUrl: null };

	let aside: ReactNode = null;
	let body: ReactNode;
	if (!revealed) {
		body = (
			<>
				<StageHint>{state === "voting" ? "Put the items in the correct order on your phone." : "Answer on your phone when the question starts."}</StageHint>
				<ul aria-label="Items" className="m-0 flex min-h-0 flex-1 list-none flex-col justify-center gap-[1cqw] p-0 px-[10%]">
					{run.options.map((option) => (
						<li key={option.id}>
							<ItemRow row={rows.get(option.id) ?? unknown} dense={dense} />
						</li>
					))}
				</ul>
			</>
		);
	} else if (!aggregate) {
		body = <StageMessage>Revealing the answer…</StageMessage>;
	} else {
		const items = aggregate.items ?? [];
		const correct = aggregate.correct?.order ?? items.map((item) => item.id);
		const column = commonColumn(aggregate);
		const badge = timing.badge(correct.length);
		aside = <CorrectSummary correct={aggregate.correct_responses} total={aggregate.total_responses} partial={aggregate.partially_correct_responses} />;
		body = (
			<div className="grid min-h-0 flex-1 grid-cols-2 gap-[3cqw]">
				<section aria-label="Correct order" className="flex min-h-0 flex-col gap-[1cqw]">
					<h2 className="m-0 font-semibold uppercase tracking-wide" style={{ color: "var(--deck-success)", fontSize: "clamp(0.75rem, 1.3cqw, 1.1rem)" }}>
						Correct order
					</h2>
					<ol className="m-0 flex min-h-0 flex-1 list-none flex-col justify-center gap-[0.8cqw] p-0">
						{items.map((item, index) => (
							<motion.li
								key={item.id}
								initial={timing.reduced ? false : { opacity: 0, y: 16 }}
								animate={{ opacity: 1, y: 0 }}
								transition={timing.item(index)}
								className="flex flex-col gap-[0.4cqw]"
							>
								<ItemRow position={item.correct_position} row={rows.get(item.id) ?? unknown} dense={dense} tone="success">
									<span className="shrink-0 font-bold tabular-nums" style={{ fontSize: "clamp(0.8rem, 1.5cqw, 1.3rem)" }}>
										{formatPercent(item.correct_percentage)}
										<span className="sr-only"> placed it correctly</span>
									</span>
								</ItemRow>
								<PercentBar value={item.correct_percentage} delay={0.3 + index * 0.06} reduced={timing.reduced} />
							</motion.li>
						))}
					</ol>
				</section>
				<section aria-label={column.kind === "order" ? column.heading : "Players' answers"} className="flex min-h-0 flex-col gap-[1cqw]">
					<h2 className="m-0 font-semibold uppercase tracking-wide" style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.75rem, 1.3cqw, 1.1rem)" }}>
						{column.kind === "order" ? column.heading : "Players' answers"}
					</h2>
					{column.kind === "order" ? (
						<ol className="m-0 flex min-h-0 flex-1 list-none flex-col justify-center gap-[0.8cqw] p-0">
							{column.order.map((id, index) => {
								const ok = correct[index] === id;
								return (
									<motion.li
										key={id}
										initial={timing.reduced ? false : { opacity: 0, y: 16 }}
										animate={{ opacity: 1, y: 0 }}
										transition={timing.item(index + 1)}
										// Keep the rows aligned with the left column's (which have a bar under them).
										style={{ paddingBottom: "calc(0.4cqw + max(0.8cqw, 0.375rem))" }}
									>
										<ItemRow position={index + 1} row={rows.get(id) ?? unknown} dense={dense}>
											<RevealMark correct={ok} transition={badge} reduced={timing.reduced} size="2.4cqw" />
										</ItemRow>
									</motion.li>
								);
							})}
						</ol>
					) : (
						<StageMessage>{column.kind === "tie" ? column.message : "Nobody answered this one."}</StageMessage>
					)}
				</section>
			</div>
		);
	}

	return (
		<PresenterStage style={theme.cssVars as CSSProperties}>
			<QuizHeader title={run.title} fallback={quizFallbackTitle("correct_order")} aside={aside} />
			{body}
		</PresenterStage>
	);
}
