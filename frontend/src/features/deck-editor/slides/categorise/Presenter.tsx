/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import { chartColor } from "@/features/deck/theme";
import type { OpaqueOptionId } from "@/features/deck/types";
import type { PresenterProps } from "../types";
import { PresenterStage } from "../shared";
import { formatPercent, numberedLabel } from "../shared/labels";
import { majorityVerdict, quizFallbackTitle } from "../shared/quizLabels";
import { CorrectSummary, PercentBar, QuizHeader, RevealMark, StageHint, StageMessage, useRevealTiming } from "../shared/quizPresenter";
import { categoryName } from "./labels";

// categorise on the big screen. Waiting / answering: the empty category
// buckets and the items to sort. Reveal: each bucket with the items that
// belong in it, the share of players who put each one there, and ✅ / ❌ for
// whether most players (more than half) got it right. The editor canvas
// shows only the items a live run would: ones with a valid category.

function Bucket({ color, title, children }: { color: string; title: string; children?: ReactNode }) {
	return (
		<section
			aria-label={title}
			className="flex min-h-0 min-w-0 flex-col gap-[0.8cqw] overflow-hidden rounded-[1.2cqw] border-2 p-[1.2cqw]"
			style={{ borderColor: color, background: `color-mix(in srgb, ${color} 8%, var(--deck-surface))` }}
		>
			<h2 className="m-0 line-clamp-1 font-bold" style={{ fontSize: "clamp(1rem, 2cqw, 1.8rem)" }}>
				{title}
			</h2>
			{children}
		</section>
	);
}

export function CategorisePresenter({ run, aggregate, state, theme, mode }: PresenterProps<"categorise">) {
	const timing = useRevealTiming();
	const categories = run.config.categories ?? [];
	// Live runs only carry scorable items; the canvas preview's run view has every
	// authoring option, so keep the ones the sample answer key sorts (like a session would).
	const scorable = mode === "preview" && aggregate?.correct ? new Set(aggregate.correct.categories.flatMap((category) => category.item_ids)) : null;
	const options = scorable ? run.options.filter((option) => scorable.has(option.id)) : run.options;
	const rows = new Map<OpaqueOptionId, { label: string; imageUrl: string | null }>(
		options.map((option, index) => [option.id, { label: numberedLabel(option, index, "Item"), imageUrl: option.image_url }])
	);
	const revealed = state === "reveal" || state === "closed";
	const columns = Math.max(1, categories.length);
	const dense = options.length > 10;

	let aside: ReactNode = null;
	let body: ReactNode;
	if (!revealed) {
		body = (
			<>
				<StageHint>{state === "voting" ? "Sort the items into the categories on your phone." : "Answer on your phone when the question starts."}</StageHint>
				<ul aria-label="Items to sort" className="m-0 flex shrink-0 list-none flex-wrap justify-center gap-[0.8cqw] p-0">
					{options.map((option) => (
						<li
							key={option.id}
							className="inline-flex items-center gap-[0.6cqw] rounded-full border-2 px-[1.2cqw] py-[0.4cqw] font-semibold"
							style={{ borderColor: "var(--deck-border)", background: "var(--deck-surface)", fontSize: dense ? "clamp(0.75rem, 1.3cqw, 1.1rem)" : "clamp(0.85rem, 1.6cqw, 1.4rem)" }}
						>
							{option.image_url ? <img src={option.image_url} alt="" draggable={false} className="rounded-full object-cover" style={{ width: "2.4cqw", height: "2.4cqw" }} /> : null}
							{rows.get(option.id)?.label}
						</li>
					))}
				</ul>
				<div className="grid min-h-0 flex-1 gap-[1.6cqw]" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
					{categories.map((category, index) => (
						<Bucket key={category.key} color={chartColor(theme, index)} title={categoryName(category, index)} />
					))}
				</div>
			</>
		);
	} else if (!aggregate) {
		body = <StageMessage>Revealing the answer…</StageMessage>;
	} else {
		const items = aggregate.items ?? [];
		const badge = timing.badge(items.length);
		aside = <CorrectSummary correct={aggregate.correct_responses} total={aggregate.total_responses} partial={aggregate.partially_correct_responses} />;
		body = (
			<div className="grid min-h-0 flex-1 gap-[1.6cqw]" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
				{categories.map((category, index) => (
					<Bucket key={category.key} color={chartColor(theme, index)} title={categoryName(category, index)}>
						<ul className="m-0 flex min-h-0 list-none flex-col gap-[0.7cqw] p-0">
							{items
								.filter((item) => item.correct_category_key === category.key)
								.map((item) => {
									const order = items.indexOf(item);
									const row = rows.get(item.id);
									const verdict = majorityVerdict(item.correct_percentage, aggregate.total_responses);
									const mostlyRight = verdict?.mostlyRight ?? false;
									return (
										<motion.li
											key={item.id}
											className="flex flex-col gap-[0.3cqw] rounded-[0.8cqw] px-[0.8cqw] py-[0.5cqw]"
											style={{ background: "var(--deck-surface)" }}
											initial={timing.reduced ? false : { opacity: 0, y: 14 }}
											animate={{ opacity: 1, y: 0 }}
											transition={timing.item(order)}
										>
											<span className="flex items-center gap-[0.6cqw]">
												{row?.imageUrl ? <img src={row.imageUrl} alt="" draggable={false} className="shrink-0 rounded-[0.4cqw] object-cover" style={{ width: "2.6cqw", height: "2.6cqw" }} /> : null}
												<span className="line-clamp-1 min-w-0 flex-1 break-words font-semibold" style={{ fontSize: dense ? "clamp(0.75rem, 1.3cqw, 1.1rem)" : "clamp(0.85rem, 1.6cqw, 1.4rem)" }}>
													{row?.label ?? "Item"}
												</span>
												<span className="shrink-0 font-bold tabular-nums" style={{ fontSize: "clamp(0.75rem, 1.3cqw, 1.1rem)" }}>
													{formatPercent(item.correct_percentage)}
													<span className="sr-only"> sorted it here</span>
												</span>
												{verdict ? <RevealMark correct={mostlyRight} transition={badge} reduced={timing.reduced} size="2cqw" label={verdict.label} /> : null}
											</span>
											<PercentBar value={item.correct_percentage} tone={mostlyRight ? "success" : "muted"} delay={0.3 + order * 0.04} reduced={timing.reduced} />
										</motion.li>
									);
								})}
						</ul>
					</Bucket>
				))}
			</div>
		);
	}

	return (
		<PresenterStage style={theme.cssVars as CSSProperties}>
			<QuizHeader title={run.title} fallback={quizFallbackTitle("categorise")} aside={aside} />
			{body}
		</PresenterStage>
	);
}
