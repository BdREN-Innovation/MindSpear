/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import { useMemo, type CSSProperties } from "react";
import { LayoutGroup, motion } from "framer-motion";
import type { RankingItemResult } from "@/features/deck/types";
import type { PresenterProps } from "../types";
import { PresenterStage, ResponseCount, ResultsEmpty, SlideTitle, usePrefersReducedMotion } from "../shared";
import { numberedLabel } from "../pollSingle/common";

// ranking presenter (plan §6.3): the items in the aggregate's order (average
// position ascending, ties share a rank), each with a bar for how close to
// first it averages and the average position itself. Rows glide to their new
// place when the order changes (framer-motion layout; none with reduced motion).

interface Row {
	id: number;
	label: string;
	imageUrl: string | null;
	result: RankingItemResult | null;
}

export function RankingPresenter({ run, aggregate, theme, mode }: PresenterProps<"ranking">) {
	const reducedMotion = usePrefersReducedMotion();
	const itemCount = run.options.length;

	const rows = useMemo<Row[]>(() => {
		const options = new Map(run.options.map((option, index) => [option.id, { option, index }]));
		const ordered: Row[] = [];
		for (const result of aggregate?.items ?? []) {
			const match = options.get(result.option_id);
			if (!match) continue;
			options.delete(result.option_id);
			ordered.push({ id: match.option.id, label: numberedLabel(match.option, match.index, "Item"), imageUrl: match.option.image_url, result });
		}
		// Items the aggregate doesn't list (none yet) keep their slide order.
		for (const { option, index } of options.values()) {
			ordered.push({ id: option.id, label: numberedLabel(option, index, "Item"), imageUrl: option.image_url, result: null });
		}
		return ordered;
	}, [aggregate, run.options]);

	const waiting = aggregate === null && mode === "live";
	const dense = rows.length > 7;
	const roomy = rows.length <= 4;
	const hasResults = (aggregate?.total_responses ?? 0) > 0;

	return (
		<PresenterStage style={theme.cssVars as CSSProperties}>
			<header className="flex items-start justify-between gap-[3cqw]">
				<SlideTitle title={run.title} fallback="Your question" />
				{aggregate ? <ResponseCount count={aggregate.total_responses} className="shrink-0 pt-[0.8cqw]" /> : null}
			</header>

			{waiting ? (
				<ResultsEmpty />
			) : (
				<LayoutGroup>
					<ol aria-label="Ranking, best first" className="m-0 flex min-h-0 flex-1 list-none flex-col justify-center gap-[1cqw] overflow-hidden p-0">
						{rows.map((row) => {
							const average = row.result?.average_position ?? null;
							// 100% for an average of 1st, a sliver for last.
							const score = average === null || itemCount <= 1 ? 0 : Math.max(0, Math.min(1, (itemCount - average) / (itemCount - 1)));
							const rank = row.result?.rank ?? null;
							const top = rank !== null && rank <= 3 && hasResults;
							return (
								<motion.li
									key={row.id}
									layout={reducedMotion ? false : "position"}
									transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }}
									className="flex min-h-0 items-center gap-[1.6cqw] rounded-[1cqw] px-[1.4cqw]"
									style={{
										background: "var(--deck-surface)",
										border: "1px solid var(--deck-border)",
										paddingBlock: dense ? "0.5cqw" : roomy ? "1.4cqw" : "0.9cqw",
									}}
								>
									<span
										aria-hidden
										className="flex shrink-0 items-center justify-center rounded-full font-bold tabular-nums"
										style={{
											width: dense ? "3cqw" : roomy ? "5cqw" : "4cqw",
											height: dense ? "3cqw" : roomy ? "5cqw" : "4cqw",
											fontSize: dense ? "clamp(0.8rem, 1.4cqw, 1.2rem)" : "clamp(0.9rem, 1.9cqw, 1.6rem)",
											background: top ? "var(--deck-primary)" : "var(--deck-surface-muted)",
											color: top ? "var(--deck-on-primary)" : "var(--deck-text-muted)",
										}}
									>
										{hasResults && rank !== null ? rank : "–"}
									</span>
									{row.imageUrl ? (
										<img
											src={row.imageUrl}
											alt=""
											draggable={false}
											className="shrink-0 rounded-md object-cover"
											style={{ width: dense ? "3cqw" : "4.4cqw", height: dense ? "3cqw" : "4.4cqw" }}
										/>
									) : null}
									<div className="flex min-w-0 flex-1 flex-col gap-[0.5cqw]">
										<span
											className="line-clamp-1 break-words font-semibold leading-tight"
											style={{ fontSize: dense ? "clamp(0.85rem, 1.5cqw, 1.25rem)" : roomy ? "clamp(1.1rem, 2.6cqw, 2.2rem)" : "clamp(1rem, 2cqw, 1.7rem)" }}
										>
											<span className="sr-only">{hasResults && rank !== null ? `Rank ${rank}: ` : ""}</span>
											{row.label}
											<span className="sr-only">
												{hasResults && average !== null ? `, average position ${average.toFixed(1)}` : ", no rankings yet"}
											</span>
										</span>
										<span className="block w-full overflow-hidden rounded-full" style={{ height: dense ? "0.6cqw" : "0.9cqw", background: "var(--deck-surface-muted)" }} aria-hidden>
											<span
												className="block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500"
												style={{ width: `${hasResults ? Math.max(3, score * 100) : 0}%`, background: top ? "var(--deck-primary)" : "var(--deck-accent)" }}
											/>
										</span>
									</div>
									<span className="flex shrink-0 flex-col items-end leading-none" aria-hidden>
										<span className="font-bold tabular-nums" style={{ fontSize: dense ? "clamp(0.85rem, 1.5cqw, 1.25rem)" : "clamp(1rem, 2.1cqw, 1.8rem)" }}>
											{hasResults && average !== null ? average.toFixed(1) : "–"}
										</span>
										<span className="mt-[0.2cqw]" style={{ fontSize: "clamp(0.65rem, 1cqw, 0.85rem)", color: "var(--deck-text-muted)" }}>
											avg. position
										</span>
									</span>
								</motion.li>
							);
						})}
					</ol>
				</LayoutGroup>
			)}
		</PresenterStage>
	);
}
