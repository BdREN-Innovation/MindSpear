/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import { chartColor } from "@/features/deck/theme";
import type { OpaqueOptionId, RunOption } from "@/features/deck/types";
import type { PresenterProps } from "../types";
import { PresenterStage } from "../shared";
import { formatPercent, numberedLabel } from "../shared/labels";
import { majorityVerdict, quizFallbackTitle } from "../shared/quizLabels";
import { CorrectSummary, PercentBar, QuizHeader, RevealMark, StageHint, StageMessage, useRevealTiming } from "../shared/quizPresenter";
import { runSides } from "./pairs";

// match_pairs on the big screen. Waiting / answering: the two columns (right
// in the players' shuffled order), no lines. Reveal: every correct pair with
// a line drawn between its cells, then ✅ / ❌ (more than half of the players
// connected it correctly) and that share. The editor canvas shows only what a
// live run would: complete pairs (no lone halves or duplicate cells).

type Cell = RunOption<OpaqueOptionId, { side: "left" | "right" }>;

function CellBox({ label, imageUrl, accent, dense }: { label: string; imageUrl: string | null; accent?: string; dense: boolean }) {
	return (
		<div
			className="flex min-w-0 items-center gap-[1cqw] rounded-[1cqw] border-2 px-[1.2cqw]"
			style={{
				borderColor: accent ?? "var(--deck-border)",
				background: accent ? `color-mix(in srgb, ${accent} 10%, var(--deck-surface))` : "var(--deck-surface)",
				paddingBlock: dense ? "0.5cqw" : "0.9cqw",
			}}
		>
			{imageUrl ? (
				<img src={imageUrl} alt="" draggable={false} className="shrink-0 rounded-[0.6cqw] object-cover" style={{ width: dense ? "3.4cqw" : "4.6cqw", height: dense ? "3.4cqw" : "4.6cqw" }} />
			) : null}
			<span className="line-clamp-2 min-w-0 break-words font-semibold leading-tight" style={{ fontSize: dense ? "clamp(0.8rem, 1.5cqw, 1.3rem)" : "clamp(0.95rem, 2cqw, 1.8rem)" }}>
				{label}
			</span>
		</div>
	);
}

export function MatchPairsPresenter({ run, aggregate, state, theme, mode }: PresenterProps<"match_pairs">) {
	const timing = useRevealTiming();
	// The preview run view has every authoring cell; keep the sample answer key's pairs, like a session's snapshot.
	const paired = mode === "preview" && aggregate?.correct ? new Set(aggregate.correct.pairs.flatMap((pair) => [pair.left_id, pair.right_id])) : null;
	const cells = paired ? (run.options as Cell[]).filter((cell) => paired.has(cell.id)) : (run.options as Cell[]);
	const { lefts, rights } = runSides(cells);
	const labels = new Map<OpaqueOptionId, { label: string; imageUrl: string | null }>([
		...lefts.map((cell, index) => [cell.id, { label: numberedLabel(cell, index, "Item"), imageUrl: cell.image_url }] as const),
		...rights.map((cell, index) => [cell.id, { label: numberedLabel(cell, index, "Match"), imageUrl: cell.image_url }] as const),
	]);
	const dense = lefts.length > 5;
	const revealed = state === "reveal" || state === "closed";

	let aside: ReactNode = null;
	let body: ReactNode;
	if (!revealed) {
		body = (
			<>
				<StageHint>{state === "voting" ? "Connect each item to its match on your phone." : "Answer on your phone when the question starts."}</StageHint>
				<div className="grid min-h-0 flex-1 grid-cols-2 content-center gap-x-[8cqw] gap-y-[1cqw]">
					<ul aria-label="Items" className="m-0 flex list-none flex-col gap-[1cqw] p-0">
						{lefts.map((cell) => (
							<li key={cell.id}>
								<CellBox label={labels.get(cell.id)!.label} imageUrl={cell.image_url} dense={dense} />
							</li>
						))}
					</ul>
					<ul aria-label="Matches" className="m-0 flex list-none flex-col gap-[1cqw] p-0">
						{rights.map((cell) => (
							<li key={cell.id}>
								<CellBox label={labels.get(cell.id)!.label} imageUrl={cell.image_url} dense={dense} />
							</li>
						))}
					</ul>
				</div>
			</>
		);
	} else if (!aggregate) {
		body = <StageMessage>Revealing the answer…</StageMessage>;
	} else {
		const pairs = aggregate.pairs ?? [];
		const badge = timing.badge(pairs.length);
		aside = (
			<CorrectSummary correct={aggregate.correct_responses} total={aggregate.total_responses} partial={aggregate.partially_correct_responses} />
		);
		body = (
			<ol aria-label="Correct pairs" className="m-0 flex min-h-0 flex-1 list-none flex-col justify-center gap-[1cqw] p-0">
				{pairs.map((pair, index) => {
					const left = labels.get(pair.left_id);
					const right = labels.get(pair.right_id);
					const color = chartColor(theme, index);
					const verdict = majorityVerdict(pair.correct_percentage, aggregate.total_responses);
					const mostlyRight = verdict?.mostlyRight ?? false;
					return (
						<motion.li
							key={`${pair.left_id}-${pair.right_id}`}
							className="grid items-center gap-[1.2cqw]"
							style={{ gridTemplateColumns: "minmax(0, 1fr) 6cqw minmax(0, 1fr) 18cqw" }}
							initial={timing.reduced ? false : { opacity: 0, y: 16 }}
							animate={{ opacity: 1, y: 0 }}
							transition={timing.item(index)}
						>
							<CellBox label={left?.label ?? "Item"} imageUrl={left?.imageUrl ?? null} accent={color} dense={dense} />
							<motion.span
								aria-hidden
								className="block h-[0.5cqw] min-h-1 rounded-full"
								style={{ background: color, transformOrigin: "left" }}
								initial={timing.reduced ? false : { scaleX: 0 }}
								animate={{ scaleX: 1 }}
								transition={timing.reduced ? { duration: 0 } : { duration: 0.4, delay: 0.3 + index * 0.06 }}
							/>
							<CellBox label={right?.label ?? "Match"} imageUrl={right?.imageUrl ?? null} accent={color} dense={dense} />
							<div className="flex items-center gap-[1cqw]">
								{verdict ? <RevealMark correct={mostlyRight} transition={badge} reduced={timing.reduced} size="2.4cqw" label={verdict.label} /> : null}
								<div className="flex min-w-0 flex-1 flex-col gap-[0.4cqw]">
									<span className="font-bold tabular-nums" style={{ fontSize: "clamp(0.85rem, 1.6cqw, 1.4rem)" }}>
										{formatPercent(pair.correct_percentage)}
										<span className="sr-only"> of players matched {left?.label} with {right?.label}</span>
									</span>
									<PercentBar value={pair.correct_percentage} tone={mostlyRight ? "success" : "muted"} delay={0.3 + index * 0.06} reduced={timing.reduced} />
								</div>
							</div>
						</motion.li>
					);
				})}
				{pairs.length === 0 ? <StageMessage>This slide has no complete pairs.</StageMessage> : null}
			</ol>
		);
	}

	return (
		<PresenterStage style={theme.cssVars as CSSProperties}>
			<QuizHeader title={run.title} fallback={quizFallbackTitle("match_pairs")} aside={aside} />
			{body}
		</PresenterStage>
	);
}
