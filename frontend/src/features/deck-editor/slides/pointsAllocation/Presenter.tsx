"use client";

import { useMemo } from "react";
import type { PresenterProps } from "../types";
import { TIMER_CHIP_CLEARANCE } from "../pinOnImage/stageLayout";
import { BarChart, PresenterStage, ResponseCount, ResultsEmpty, SlideTitle, type BarChartItem } from "../shared";

// points_allocation presenter (plan §6.3): one horizontal bar per option with
// its share of every point given (percentage, 0..100), animating as answers
// come in (BarChart / ApexCharts).

function formatPercent(value: number): string {
	return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function PointsAllocationPresenter({ run, aggregate, theme }: PresenterProps<"points_allocation">) {
	const items = useMemo<BarChartItem[]>(() => {
		const byId = new Map((aggregate?.options ?? []).map((row) => [row.option_id, row]));
		return run.options.map((option, index) => {
			const row = byId.get(option.id);
			const percentage = row?.percentage ?? 0;
			return {
				id: option.id,
				label: option.label?.trim() || `Option ${index + 1}`,
				value: percentage,
				imageUrl: option.image_url,
				display: formatPercent(percentage),
			};
		});
	}, [run.options, aggregate]);

	const total = aggregate?.total_points ?? run.config.total_points ?? 100;

	return (
		<PresenterStage>
			{/* Right padding keeps the shell's timer chip area (top-right ~220×56 px) clear. */}
			<div className="flex items-start justify-between gap-[2cqw]" style={TIMER_CHIP_CLEARANCE}>
				<div className="flex min-w-0 flex-col gap-[0.6cqw]">
					<SlideTitle title={run.title} fallback="Distribute your points" size="md" />
					<p className="m-0" style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.875rem, 1.5cqw, 1.25rem)" }}>
						Each person shares {total} points
					</p>
				</div>
				<ResponseCount count={aggregate?.total_responses ?? 0} className="shrink-0" />
			</div>

			{items.length === 0 ? (
				<ResultsEmpty message="Add options to this slide" />
			) : (
				<div className="min-h-0 flex-1">
					<BarChart items={items} orientation="horizontal" max={100} theme={theme} ariaLabel="Share of points per option" />
				</div>
			)}
		</PresenterStage>
	);
}
