"use client";

import { useMemo, type CSSProperties } from "react";
import type { PresenterProps } from "../types";
import { PresenterStage, ResponseCount, ResultsEmpty, SlideTitle } from "../shared";
import { PollResultsChart, pollRows } from "./PollResults";

export function PollSinglePresenter({ run, aggregate, theme, mode }: PresenterProps<"poll_single">) {
	const rows = useMemo(() => pollRows(run.options, aggregate?.options), [run.options, aggregate]);
	// Live without an aggregate yet (first load / resync): don't draw zeros that look like results.
	const waiting = aggregate === null && mode === "live";

	return (
		<PresenterStage style={theme.cssVars as CSSProperties}>
			<header className="flex items-start justify-between gap-[3cqw]">
				<SlideTitle title={run.title} fallback="Your question" />
				{aggregate ? <ResponseCount count={aggregate.total_votes} noun={["vote", "votes"]} className="shrink-0 pt-[0.8cqw]" /> : null}
			</header>
			<div className="flex min-h-0 flex-1 flex-col">
				{waiting ? (
					<ResultsEmpty />
				) : (
					<PollResultsChart rows={rows} layout={run.config.result_layout} theme={theme} ariaLabel="Votes per option" />
				)}
			</div>
		</PresenterStage>
	);
}
