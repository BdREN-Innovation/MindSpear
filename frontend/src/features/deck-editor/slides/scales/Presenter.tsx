"use client";

import { useMemo, type CSSProperties } from "react";
import type { ScaleStatementResult } from "@/features/deck/types";
import type { PresenterProps } from "../types";
import { PresenterStage, ResponseCount, ResultsEmpty, SlideTitle } from "../shared";
import { fallbackTitle, numberedLabel } from "../shared/labels";
import { clampPoints, fitLabels, scaleColor, scaleTextColor } from "./scale";

// scales presenter (plan §6.3): one row per statement with a stacked bar of
// the answers (value 1 light → value N strong) and, under it, a number line
// 1..N with a marker at the mean. Widths and the marker glide on updates
// (CSS transitions, off with prefers-reduced-motion).

interface Row {
	id: number;
	label: string;
	result: ScaleStatementResult | null;
}

const SMALL_TEXT = "clamp(0.75rem, 1.3cqw, 1.05rem)";

export function ScalesPresenter({ run, aggregate, theme, mode }: PresenterProps<"scales">) {
	const points = clampPoints(aggregate?.scale_points ?? run.config.scale_points);
	const labels = fitLabels(run.config.scale_labels, points);
	const rows = useMemo<Row[]>(() => {
		const byId = new Map((aggregate?.statements ?? []).map((statement) => [statement.option_id, statement]));
		return run.options.map((option, index) => ({
			id: option.id,
			label: numberedLabel(option, index, "Statement"),
			result: byId.get(option.id) ?? null,
		}));
	}, [aggregate, run.options]);
	const waiting = aggregate === null && mode === "live";
	const dense = rows.length > 6;

	return (
		<PresenterStage style={theme.cssVars as CSSProperties}>
			<header className="flex items-start justify-between gap-[3cqw]">
				<SlideTitle title={run.title} fallback={fallbackTitle("scales")} />
				{aggregate ? <ResponseCount count={aggregate.total_responses} className="shrink-0 pt-[0.8cqw]" /> : null}
			</header>

			{waiting ? (
				<ResultsEmpty />
			) : (
				<>
					<Legend points={points} labels={labels} />
					<ul className="m-0 flex min-h-0 flex-1 list-none flex-col justify-center gap-[1.6cqw] overflow-y-auto p-0" aria-label="Results per statement">
						{rows.map((row) => (
							<StatementRow key={row.id} row={row} points={points} labels={labels} dense={dense} />
						))}
					</ul>
				</>
			)}
		</PresenterStage>
	);
}

function Legend({ points, labels }: { points: number; labels: (string | null)[] }) {
	return (
		<div className="flex items-center gap-[1.5cqw]" aria-hidden style={{ fontSize: SMALL_TEXT, color: "var(--deck-text-muted)" }}>
			<span className="min-w-0 flex-1 truncate text-right font-semibold">{labels[0] ? `1 · ${labels[0]}` : "1"}</span>
			<span className="flex shrink-0 overflow-hidden rounded-full">
				{Array.from({ length: points }, (_, index) => (
					<span
						key={index}
						className="flex h-[2cqw] min-h-4 w-[2.4cqw] min-w-5 items-center justify-center font-bold tabular-nums"
						style={{ background: scaleColor(index + 1, points), color: scaleTextColor(index + 1, points), fontSize: "0.8em" }}
					>
						{index + 1}
					</span>
				))}
			</span>
			<span className="min-w-0 flex-1 truncate font-semibold">{labels[points - 1] ? `${points} · ${labels[points - 1]}` : String(points)}</span>
		</div>
	);
}

function StatementRow({ row, points, labels, dense }: { row: Row; points: number; labels: (string | null)[]; dense: boolean }) {
	const count = row.result?.count ?? 0;
	const mean = row.result?.mean ?? null;
	const distribution = Array.from({ length: points }, (_, index) => row.result?.distribution.find((entry) => entry.value === index + 1)?.count ?? 0);
	const markerLeft = mean === null ? null : ((mean - 1) / Math.max(1, points - 1)) * 100;
	const summary =
		count === 0
			? `${row.label}: no answers yet.`
			: `${row.label}: average ${mean} out of ${points} from ${count} ${count === 1 ? "answer" : "answers"}. ` +
				distribution.map((n, index) => `${index + 1}${labels[index] ? ` (${labels[index]})` : ""}: ${n}`).join(", ") +
				".";

	return (
		<li className="grid grid-cols-[minmax(0,30%)_minmax(0,1fr)_auto] items-center gap-x-[2cqw]">
			<span className="sr-only">{summary}</span>
			<span
				aria-hidden
				className={dense ? "line-clamp-1 break-words font-semibold leading-tight" : "line-clamp-2 break-words font-semibold leading-tight"}
				style={{ fontSize: dense ? "clamp(0.8rem, 1.45cqw, 1.2rem)" : "clamp(0.9rem, 1.8cqw, 1.5rem)" }}
			>
				{row.label}
			</span>

			<div className="flex min-w-0 flex-col gap-[0.5cqw]" aria-hidden>
				<div
					className="flex w-full overflow-hidden rounded-[0.6cqw]"
					style={{ height: dense ? "1.9cqw" : "2.8cqw", background: "var(--deck-surface-muted)" }}
				>
					{count > 0
						? distribution.map((n, index) => {
								const share = (n / count) * 100;
								return (
									<div
										key={index}
										className="flex h-full items-center justify-center overflow-hidden font-bold tabular-nums motion-safe:transition-[width] motion-safe:duration-500"
										style={{
											width: `${share}%`,
											background: scaleColor(index + 1, points),
											color: scaleTextColor(index + 1, points),
											fontSize: dense ? "clamp(0.65rem, 1.05cqw, 0.9rem)" : SMALL_TEXT,
										}}
									>
										{share >= 7 ? n : ""}
									</div>
								);
							})
						: null}
				</div>
				{/* Number line 1..N with the mean marker. */}
				<div className="relative mx-[0.4cqw]" style={{ height: dense ? "1cqw" : "1.4cqw" }}>
					<div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2" style={{ background: "var(--deck-border)" }} />
					{Array.from({ length: points }, (_, index) => (
						<div
							key={index}
							className="absolute top-1/2 h-[60%] w-px -translate-y-1/2"
							style={{ left: `${(index / Math.max(1, points - 1)) * 100}%`, background: "var(--deck-border)" }}
						/>
					))}
					{markerLeft !== null ? (
						<div
							className="absolute top-1/2 aspect-square h-full -translate-x-1/2 -translate-y-1/2 rounded-full border-2 motion-safe:transition-[left] motion-safe:duration-500"
							style={{ left: `${markerLeft}%`, background: "var(--deck-primary)", borderColor: "var(--deck-bg)" }}
						/>
					) : null}
				</div>
			</div>

			<span aria-hidden className="flex min-w-[5cqw] flex-col items-end leading-none">
				<span className="font-bold tabular-nums" style={{ fontSize: dense ? "clamp(0.9rem, 1.8cqw, 1.5rem)" : "clamp(1rem, 2.6cqw, 2.25rem)" }}>
					{mean === null ? "–" : mean.toFixed(1)}
				</span>
				<span className="mt-[0.3cqw] tabular-nums" style={{ fontSize: "clamp(0.65rem, 1.05cqw, 0.9rem)", color: "var(--deck-text-muted)" }}>
					{count === 0 ? "no answers" : `avg · ${count}`}
				</span>
			</span>
		</li>
	);
}
