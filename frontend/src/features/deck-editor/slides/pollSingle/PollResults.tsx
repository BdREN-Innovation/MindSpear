/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { chartColor, type DeckTheme } from "@/features/deck/theme";
import type { PollOptionCount, ResultLayout, RunOption } from "@/features/deck/types";
import { BarChart, usePrefersReducedMotion } from "../shared";
import { formatPercent, optionLabel } from "./common";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

// Live results of the two choice polls (poll_single / poll_multi) in the
// slide's result_layout: bars (shared BarChart, option images under / next to
// the bars), donut / pie (ApexCharts) or dots (one dot per vote, grouped per
// option). Every layout keeps a text equivalent for screen readers.

export interface PollResultRow {
	id: number;
	label: string;
	imageUrl: string | null;
	count: number;
	/** 0..100 as the aggregate defines it (of votes for poll_single, of participants for poll_multi). */
	percentage: number;
}

/** Run options joined with their aggregate counts (options without a count show 0). */
export function pollRows(options: RunOption[], counts: PollOptionCount[] | null | undefined): PollResultRow[] {
	const byId = new Map((counts ?? []).map((entry) => [entry.option_id, entry]));
	return options.map((option, index) => ({
		id: option.id,
		label: optionLabel(option, index),
		imageUrl: option.image_url,
		count: byId.get(option.id)?.count ?? 0,
		percentage: byId.get(option.id)?.percentage ?? 0,
	}));
}

export const RESULT_LAYOUT_CHOICES: { value: ResultLayout; label: string }[] = [
	{ value: "bars", label: "Bars" },
	{ value: "donut", label: "Donut" },
	{ value: "pie", label: "Pie" },
	{ value: "dots", label: "Dots" },
];

export function PollResultsChart({
	rows,
	layout,
	theme,
	ariaLabel,
}: {
	rows: PollResultRow[];
	layout: ResultLayout | undefined;
	theme: DeckTheme;
	ariaLabel: string;
}) {
	if (layout === "donut" || layout === "pie") return <PieResults rows={rows} donut={layout === "donut"} theme={theme} ariaLabel={ariaLabel} />;
	if (layout === "dots") return <DotResults rows={rows} theme={theme} ariaLabel={ariaLabel} />;

	// Columns read best for a few short options; many or long labels get rows.
	const horizontal = rows.length > 6 || rows.some((row) => row.label.length > 48);
	return (
		<BarChart
			items={rows.map((row) => ({
				id: row.id,
				label: row.label,
				value: row.count,
				imageUrl: row.imageUrl,
				display: formatPercent(row.percentage),
			}))}
			ariaLabel={ariaLabel}
			orientation={horizontal ? "horizontal" : "vertical"}
			theme={theme}
		/>
	);
}

/* ------------------------------------------------------------------ */

function SrTable({ rows, caption }: { rows: PollResultRow[]; caption: string }) {
	return (
		<table className="sr-only">
			<caption>{caption}</caption>
			<tbody>
				{rows.map((row) => (
					<tr key={row.id}>
						<th scope="row">{row.label}</th>
						<td>
							{row.count} ({formatPercent(row.percentage)})
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function PieResults({ rows, donut, theme, ariaLabel }: { rows: PollResultRow[]; donut: boolean; theme: DeckTheme; ariaLabel: string }) {
	const reducedMotion = usePrefersReducedMotion();
	const total = rows.reduce((sum, row) => sum + row.count, 0);
	const series = useMemo(() => rows.map((row) => row.count), [rows]);

	const options = useMemo<ApexOptions>(
		() => ({
			chart: {
				type: donut ? "donut" : "pie",
				background: "transparent",
				fontFamily: "inherit",
				parentHeightOffset: 0,
				toolbar: { show: false },
				animations: {
					enabled: !reducedMotion,
					speed: 450,
					dynamicAnimation: { enabled: !reducedMotion, speed: 350 },
				},
			},
			labels: rows.map((row) => row.label),
			colors: rows.map((_, index) => chartColor(theme, index)),
			stroke: { colors: [theme.colors.background], width: 3 },
			legend: {
				position: "right",
				fontSize: "18px",
				fontWeight: 600,
				labels: { colors: theme.colors.text },
				markers: { size: 9 },
				itemMargin: { vertical: 6 },
			},
			dataLabels: {
				enabled: true,
				formatter: (value: number) => formatPercent(value),
				style: { fontSize: "18px", fontWeight: 700 },
				dropShadow: { enabled: false },
			},
			plotOptions: {
				pie: {
					expandOnClick: false,
					donut: {
						size: "58%",
						labels: {
							show: donut,
							name: { color: theme.colors.textMuted },
							value: { color: theme.colors.text, fontSize: "32px", fontWeight: 700 },
							total: { show: true, label: "Votes", color: theme.colors.textMuted, formatter: () => String(total) },
						},
					},
				},
			},
			tooltip: { enabled: false },
			states: { hover: { filter: { type: "none" } }, active: { filter: { type: "none" } } },
			theme: { mode: theme.isDark ? "dark" : "light" },
		}),
		[donut, reducedMotion, rows, theme, total]
	);

	return (
		<figure role="figure" aria-label={ariaLabel} className="m-0 flex h-full min-h-0 w-full flex-col">
			{total === 0 ? (
				<div className="flex min-h-0 flex-1 items-center justify-center" aria-hidden>
					<div
						className="aspect-square h-[70%] max-h-full rounded-full"
						style={{
							border: `${donut ? "3.2cqw" : "0"} solid var(--deck-surface-muted)`,
							background: donut ? "transparent" : "var(--deck-surface-muted)",
						}}
					/>
				</div>
			) : (
				<div className="relative min-h-0 flex-1" aria-hidden>
					<ReactApexChart type={donut ? "donut" : "pie"} options={options} series={series} height="100%" width="100%" />
				</div>
			)}
			<SrTable rows={rows} caption={ariaLabel} />
		</figure>
	);
}

function DotResults({ rows, theme, ariaLabel }: { rows: PollResultRow[]; theme: DeckTheme; ariaLabel: string }) {
	const reducedMotion = usePrefersReducedMotion();
	const max = Math.max(1, ...rows.map((row) => row.count));
	// Keep a row to ~40 dots: beyond that each dot stands for several votes.
	const unit = Math.max(1, Math.ceil(max / 40));

	return (
		<figure role="figure" aria-label={ariaLabel} className="m-0 flex h-full min-h-0 w-full flex-col gap-[1cqw]">
			<div className="flex min-h-0 flex-1 flex-col justify-center gap-[1.2cqw] overflow-y-auto" aria-hidden>
				{rows.map((row, index) => {
					const dots = row.count === 0 ? 0 : Math.max(1, Math.round(row.count / unit));
					const color = chartColor(theme, index);
					return (
						<div key={row.id} className="flex items-center gap-[1.5cqw]">
							<div className="flex w-[28%] min-w-0 shrink-0 items-center justify-end gap-[0.8cqw] text-right">
								{row.imageUrl ? (
									<img src={row.imageUrl} alt="" draggable={false} className="h-[3.4cqw] w-[3.4cqw] shrink-0 rounded-md object-cover" />
								) : null}
								<span className="line-clamp-2 break-words font-semibold leading-tight" style={{ fontSize: "clamp(0.875rem, 1.7cqw, 1.5rem)" }}>
									{row.label}
								</span>
							</div>
							<div className="flex min-w-0 flex-1 flex-wrap items-center gap-[0.45cqw]">
								<AnimatePresence initial={false}>
									{Array.from({ length: dots }, (_, dot) => (
										<motion.span
											key={dot}
											className="block h-[1.4cqw] min-h-2 w-[1.4cqw] min-w-2 rounded-full"
											style={{ background: color }}
											initial={reducedMotion ? false : { scale: 0, opacity: 0 }}
											animate={{ scale: 1, opacity: 1 }}
											exit={reducedMotion ? undefined : { scale: 0, opacity: 0 }}
											transition={{ duration: reducedMotion ? 0 : 0.25 }}
										/>
									))}
								</AnimatePresence>
								<span className="ml-[0.6cqw] font-bold tabular-nums" style={{ fontSize: "clamp(0.875rem, 1.6cqw, 1.375rem)" }}>
									{formatPercent(row.percentage)}
								</span>
							</div>
						</div>
					);
				})}
			</div>
			{unit > 1 ? (
				<p className="m-0 text-right" style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.75rem, 1.3cqw, 1rem)" }}>
					Each dot ≈ {unit} votes
				</p>
			) : null}
			<SrTable rows={rows} caption={ariaLabel} />
		</figure>
	);
}

/* ------------------------------------------------------------------ */
/* Participant: results when the slide shows them (results 'public')   */
/* ------------------------------------------------------------------ */

export function ParticipantPollResults({
	rows,
	highlight,
	className,
}: {
	rows: PollResultRow[];
	/** Option ids the participant picked. */
	highlight: number[];
	className?: string;
}) {
	return (
		<section aria-label="Live results" className={cn("flex w-full flex-col gap-2 text-left", className)}>
			<p className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
				Live results
			</p>
			<ul className="m-0 flex list-none flex-col gap-2 p-0">
				{rows.map((row) => {
					const mine = highlight.includes(row.id);
					const width = Math.max(0, Math.min(100, row.percentage));
					return (
						<li key={row.id} className="flex flex-col gap-1">
							<div className="flex items-baseline justify-between gap-2 text-sm">
								<span className={cn("min-w-0 break-words", mine && "font-semibold")}>
									{row.label}
									{mine ? <span className="sr-only"> (your choice)</span> : null}
								</span>
								<span className="shrink-0 font-semibold tabular-nums">{formatPercent(row.percentage)}</span>
							</div>
							<div className="h-2.5 w-full overflow-hidden rounded-full" style={{ background: "var(--deck-surface-muted, #F3F4F6)" }} aria-hidden>
								<div
									className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500"
									style={{
										width: `${width}%`,
										background: mine ? "var(--deck-primary, #F79945)" : "var(--deck-text-muted, #9CA3AF)",
									}}
								/>
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
