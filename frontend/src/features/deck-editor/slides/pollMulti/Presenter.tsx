"use client";

import { useMemo, type CSSProperties } from "react";
import type { PresenterProps } from "../types";
import { PresenterStage, ResponseCount, ResultsEmpty, SlideTitle } from "../shared";
import { PollResultsChart, pollRows } from "../pollSingle/PollResults";

export function PollMultiPresenter({ run, aggregate, theme, mode }: PresenterProps<"poll_multi">) {
	const rows = useMemo(() => pollRows(run.options, aggregate?.options), [run.options, aggregate]);
	const waiting = aggregate === null && mode === "live";

	return (
		<PresenterStage style={theme.cssVars as CSSProperties}>
			<header className="flex items-start justify-between gap-[3cqw]">
				<SlideTitle title={run.title} fallback="Your question" />
				{aggregate ? (
					<div className="flex shrink-0 flex-col items-end gap-[0.4cqw] pt-[0.8cqw]">
						<ResponseCount count={aggregate.total_responses} />
						{aggregate.total_responses > 0 ? (
							<p className="m-0 tabular-nums" style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.75rem, 1.3cqw, 1.05rem)" }}>
								{aggregate.average_selections_per_participant} picks each on average
							</p>
						) : null}
					</div>
				) : null}
			</header>
			<div className="flex min-h-0 flex-1 flex-col">
				{waiting ? (
					<ResultsEmpty />
				) : (
					<PollResultsChart rows={rows} layout={run.config.result_layout} theme={theme} ariaLabel="Share of participants per option" />
				)}
			</div>
		</PresenterStage>
	);
}
