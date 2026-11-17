/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import { cn } from "@/lib/utils";
import { chartColor, useDeckTheme, type DeckTheme } from "@/features/deck/theme";
import { usePrefersReducedMotion } from "./hooks";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

// Live results bar chart for Presenters (poll_single / poll_multi / points
// allocation, ...). ApexCharts draws and animates the bars; option labels and
// images are an HTML strip aligned to the plot area (measured from the chart
// after every draw), so labels wrap, images show next to their bar, and the
// text stays real text. A visually hidden table carries the data for screen
// readers. Colours come from the deck theme (chartColor), animation stops
// when the user prefers reduced motion.

export interface BarChartItem {
	id: string | number;
	label: string;
	value: number;
	imageUrl?: string | null;
	/** Text on / next to the bar (default: the value). E.g. "42%" or "12". */
	display?: string;
}

export interface BarChartProps {
	items: BarChartItem[];
	/** Accessible name of the chart, e.g. "Votes per option". */
	ariaLabel: string;
	/** vertical = columns (default), horizontal = rows. */
	orientation?: "vertical" | "horizontal";
	/** Value-axis maximum, e.g. 100 for percentages. Default: auto from the data. */
	max?: number;
	/** Defaults to the nearest DeckThemeProvider's theme. */
	theme?: DeckTheme;
	/** One colour per bar (default) or every bar in the theme's primary colour. */
	distributed?: boolean;
	/** CSS height of the whole widget (default 100%: fill the parent, which must have a height). */
	height?: number | string;
	className?: string;
}

interface PlotArea {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface ApexChartContext {
	w?: { globals?: { translateX?: number; translateY?: number; gridWidth?: number; gridHeight?: number } };
}

export function BarChart({
	items,
	ariaLabel,
	orientation = "vertical",
	max,
	theme: themeProp,
	distributed = true,
	height = "100%",
	className,
}: BarChartProps) {
	const contextTheme = useDeckTheme();
	const theme = themeProp ?? contextTheme;
	const reducedMotion = usePrefersReducedMotion();
	const horizontal = orientation === "horizontal";
	const [plot, setPlot] = useState<PlotArea | null>(null);
	const hasImages = items.some((item) => !!item.imageUrl);

	const measure = useCallback((chart: ApexChartContext) => {
		const g = chart?.w?.globals;
		if (!g) return;
		const next = { x: g.translateX ?? 0, y: g.translateY ?? 0, width: g.gridWidth ?? 0, height: g.gridHeight ?? 0 };
		setPlot((previous) =>
			previous &&
			Math.abs(previous.x - next.x) < 0.5 &&
			Math.abs(previous.y - next.y) < 0.5 &&
			Math.abs(previous.width - next.width) < 0.5 &&
			Math.abs(previous.height - next.height) < 0.5
				? previous
				: next
		);
	}, []);

	const values = useMemo(() => items.map((item) => (Number.isFinite(item.value) ? item.value : 0)), [items]);
	const displays = useMemo(() => items.map((item) => item.display ?? String(item.value)), [items]);
	const colors = useMemo(
		() => (distributed ? items.map((_, index) => chartColor(theme, index)) : [theme.colors.primary]),
		[distributed, items, theme]
	);
	const dataMax = Math.max(0, ...values);
	// Head-room for the value label at the end of the longest bar.
	const axisMax = max ?? (dataMax > 0 ? dataMax * (horizontal ? 1.18 : 1.12) : 1);

	const options = useMemo<ApexOptions>(
		() => ({
			chart: {
				type: "bar",
				background: "transparent",
				fontFamily: "inherit",
				parentHeightOffset: 0,
				toolbar: { show: false },
				zoom: { enabled: false },
				animations: {
					enabled: !reducedMotion,
					speed: 450,
					animateGradually: { enabled: false },
					dynamicAnimation: { enabled: !reducedMotion, speed: 350 },
				},
				events: { mounted: measure, updated: measure },
			},
			colors,
			plotOptions: {
				bar: {
					horizontal,
					distributed,
					borderRadius: 6,
					borderRadiusApplication: "end",
					columnWidth: "62%",
					barHeight: "68%",
					dataLabels: { position: "top" },
				},
			},
			dataLabels: {
				enabled: true,
				formatter: (_value: number, opts?: { dataPointIndex?: number }) => displays[opts?.dataPointIndex ?? 0] ?? "",
				offsetY: horizontal ? 0 : -28,
				offsetX: horizontal ? 36 : 0,
				textAnchor: horizontal ? "start" : "middle",
				style: { fontSize: "18px", fontWeight: 700, colors: [theme.colors.text] },
				background: { enabled: false },
				dropShadow: { enabled: false },
			},
			legend: { show: false },
			tooltip: { enabled: false },
			states: {
				hover: { filter: { type: "none" } },
				active: { filter: { type: "none" } },
			},
			grid: {
				show: false,
				padding: { top: horizontal ? 0 : 32, right: horizontal ? 72 : 8, bottom: 0, left: horizontal ? 0 : 8 },
			},
			xaxis: {
				categories: items.map((item) => item.label),
				labels: { show: false },
				axisBorder: { show: false },
				axisTicks: { show: false },
				max: horizontal ? axisMax : undefined,
				min: horizontal ? 0 : undefined,
			},
			yaxis: { show: false, min: 0, max: horizontal ? undefined : axisMax },
			theme: { mode: theme.isDark ? "dark" : "light" },
		}),
		[axisMax, colors, displays, distributed, horizontal, items, measure, reducedMotion, theme]
	);

	const series = useMemo(() => [{ name: ariaLabel, data: values }], [ariaLabel, values]);
	const count = Math.max(1, items.length);

	const labelCell = (item: BarChartItem) => (
		<div className={cn("flex min-w-0 items-center gap-2", horizontal ? "justify-end text-right" : "flex-col justify-start text-center")}>
			{item.imageUrl ? (
				<img
					src={item.imageUrl}
					alt=""
					className={cn("shrink-0 rounded-md object-cover", horizontal ? "h-10 w-10" : "h-14 w-14")}
					draggable={false}
				/>
			) : null}
			<span className="line-clamp-2 break-words text-base font-semibold leading-tight" style={{ color: "var(--deck-text)" }}>
				{item.label}
			</span>
		</div>
	);

	const chart = (
		<div className="relative min-h-0 min-w-0 flex-1" aria-hidden>
			<ReactApexChart type="bar" options={options} series={series} height="100%" width="100%" />
		</div>
	);

	return (
		<figure
			role="figure"
			aria-label={ariaLabel}
			className={cn("m-0 flex min-h-0 w-full", horizontal ? "flex-row" : "flex-col", className)}
			style={{ height, color: theme.colors.text }}
		>
			{horizontal ? (
				<>
					<div
						className="relative w-[34%] min-w-[7rem] max-w-[22rem] shrink-0 pr-3"
						style={{ paddingTop: plot?.y ?? 0 }}
						aria-hidden
					>
						{items.map((item) => (
							<div
								key={item.id}
								className="flex items-center justify-end overflow-hidden"
								style={{ height: plot ? plot.height / count : `${100 / count}%` }}
							>
								{labelCell(item)}
							</div>
						))}
					</div>
					{chart}
				</>
			) : (
				<>
					{chart}
					<div
						className="grid shrink-0 gap-2 pt-2"
						style={{
							marginLeft: plot?.x ?? 0,
							width: plot ? plot.width : "100%",
							gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
							minHeight: hasImages ? "6.5rem" : "3rem",
						}}
						aria-hidden
					>
						{items.map((item) => (
							<div key={item.id}>{labelCell(item)}</div>
						))}
					</div>
				</>
			)}
			<table className="sr-only">
				<caption>{ariaLabel}</caption>
				<tbody>
					{items.map((item, index) => (
						<tr key={item.id}>
							<th scope="row">{item.label || `Option ${index + 1}`}</th>
							<td>{displays[index]}</td>
						</tr>
					))}
				</tbody>
			</table>
		</figure>
	);
}
