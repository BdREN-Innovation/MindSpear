/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import { useMemo } from "react";
import type { PresenterProps } from "../types";
import { PresenterStage, ResponseCount, ResultsEmpty, SlideTitle } from "../shared";
import { fallbackTitle, numberedLabel } from "../shared/labels";
import { TIMER_CHIP_CLEARANCE } from "../shared/stageLayout";
import { StarMeter } from "./StarRow";

// rating presenter (plan §6.3): one row per item with a star row filled to
// the average, the numeric average and the number of ratings. Up to 30 items
// fit by flowing into 2 or 3 columns with smaller type.

export function RatingPresenter({ run, aggregate }: PresenterProps<"rating">) {
	const scale = aggregate?.scale ?? run.config.scale ?? 5;
	const rows = useMemo(() => {
		const byId = new Map((aggregate?.items ?? []).map((item) => [item.option_id, item]));
		return run.options.map((option, index) => ({
			id: option.id,
			label: numberedLabel(option, index, "Item"),
			imageUrl: option.image_url,
			mean: byId.get(option.id)?.mean ?? null,
			count: byId.get(option.id)?.count ?? 0,
		}));
	}, [run.options, aggregate]);

	const columns = rows.length > 12 ? 3 : rows.length > 6 ? 2 : 1;
	// Star size shrinks with columns and long scales so a row always fits.
	const starSize = `${((columns === 1 ? 3.2 : columns === 2 ? 1.7 : 1.1) * 5) / Math.max(5, scale)}cqw`;
	const labelSize = columns === 1 ? "clamp(1rem, 2.4cqw, 2.25rem)" : columns === 2 ? "clamp(0.875rem, 1.6cqw, 1.5rem)" : "clamp(0.75rem, 1.15cqw, 1.1rem)";
	const stacked = columns > 1;

	return (
		<PresenterStage>
			{/* Right padding keeps the shell's timer chip area (top-right ~220×56 px) clear. */}
			<div className="flex items-start justify-between gap-[2cqw]" style={TIMER_CHIP_CLEARANCE}>
				<SlideTitle title={run.title} fallback={fallbackTitle("rating")} size="md" />
				<ResponseCount count={aggregate?.total_responses ?? 0} className="shrink-0" />
			</div>

			{rows.length === 0 ? (
				<ResultsEmpty message="Add items to this slide" />
			) : (
				<ul
					className="m-0 grid min-h-0 flex-1 list-none content-center gap-x-[3cqw] p-0"
					style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, rowGap: columns === 1 ? "2cqw" : "1.2cqw" }}
				>
					{rows.map((row) => (
						<li
							key={row.id}
							className={stacked ? "flex min-w-0 flex-col gap-[0.4cqw]" : "flex min-w-0 items-center gap-[2cqw]"}
							aria-label={`${row.label}: ${row.mean !== null ? `average ${row.mean} of ${scale} stars` : "no ratings yet"}, ${row.count} ${row.count === 1 ? "rating" : "ratings"}`}
						>
							<span className="flex min-w-0 flex-1 items-center gap-[1cqw]" aria-hidden>
								{row.imageUrl ? (
									<img src={row.imageUrl} alt="" className="shrink-0 rounded-[0.6cqw] object-cover" style={{ width: "3.5cqw", height: "3.5cqw" }} />
								) : null}
								<span className="min-w-0 truncate font-semibold" style={{ fontSize: labelSize }} title={row.label}>
									{row.label}
								</span>
							</span>
							<span className="flex shrink-0 items-center gap-[1.2cqw]" aria-hidden>
								<StarMeter value={row.mean} scale={scale} size={starSize} />
								<span className="font-bold tabular-nums" style={{ fontSize: labelSize, minWidth: "2.6em", textAlign: "right" }}>
									{row.mean !== null ? row.mean.toFixed(1) : "–"}
								</span>
								<span className="tabular-nums" style={{ fontSize: `calc(${labelSize} * 0.7)`, color: "var(--deck-text-muted)", minWidth: "2.5em" }}>
									({row.count})
								</span>
							</span>
						</li>
					))}
				</ul>
			)}
		</PresenterStage>
	);
}
