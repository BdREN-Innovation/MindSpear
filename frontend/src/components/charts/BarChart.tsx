"use client";

import React, { useMemo } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import { baseApexOptions, chartNeutrals, getChartColors, truncateLabel } from "./chartTheme";
import { normalizeCategoricalData } from "./chartData";
import { ChartContainer } from "./ChartContainer";
import type { LegacyCategoricalProps, NormalizedChartProps } from "./types";

const ReactApexChart = dynamic(() => import("react-apexcharts"), {
	ssr: false,
});

type BarChartProps = NormalizedChartProps &
	LegacyCategoricalProps & {
		horizontal?: boolean;
		rounded?: number;
		valueSuffix?: string;
	};

export function BarChart({
	data,
	categories,
	labels,
	series,
	title,
	height = 350,
	colors,
	showLegend = false,
	isLoading,
	className,
	horizontal = false,
	rounded = 8,
	valueSuffix = "",
	showEmptyChart = false,
}: BarChartProps) {
	const chartData = useMemo(
		() => normalizeCategoricalData({ data, categories, labels, series, colors }),
		[data, categories, labels, series, colors]
	);
	const chartColors = useMemo(
		() => getChartColors(colors, chartData.length),
		[colors, chartData.length]
	);
	const rawLabels = chartData.map((item) => item.label);
	const values = chartData.map((item) => item.value);
	const maxValue = Math.max(...values.map((value) => Number(value) || 0), 0);
	const hasRenderableData = values.some((value) => Number(value) > 0);
	// An empty preview still needs an axis range, or the bars have no scale.
	const emptyAxisMax = !hasRenderableData && showEmptyChart ? (valueSuffix === "%" ? 100 : 10) : undefined;
	const horizontalAxisMax =
		horizontal && maxValue > 0
			? Math.ceil(maxValue + Math.max(maxValue * 0.32, 14))
			: horizontal
				? emptyAxisMax
				: undefined;

	const options: ApexOptions = useMemo(
		() => ({
			...baseApexOptions,
			chart: {
				...baseApexOptions.chart,
				type: "bar",
				height,
			},
			colors: chartColors,
			legend: {
				show: showLegend,
				position: "bottom",
			},
			plotOptions: {
				bar: {
					borderRadius: rounded,
					borderRadiusApplication: "end",
					columnWidth: horizontal ? undefined : "38%",
					barHeight: horizontal ? "60%" : undefined,
					distributed: true,
					horizontal,
					dataLabels: {
						position: horizontal ? "right" : "top",
					},
				},
			},
			dataLabels: {
				enabled: true,
				textAnchor: horizontal ? "start" : "middle",
				offsetX: horizontal ? 22 : 0,
				offsetY: horizontal ? 0 : -22,
				formatter: (value: number) => `${value}${valueSuffix}`,
				style: {
					colors: horizontal ? chartColors : [chartNeutrals.chartAxis],
					fontSize: "12px",
					fontWeight: 700,
				},
				background: {
					enabled: false,
				},
			},
			xaxis: {
				categories: rawLabels.map((label) => truncateLabel(label)),
				max: horizontalAxisMax,
				labels: {
					show: !horizontal,
					trim: true,
				},
				axisTicks: { show: false },
				axisBorder: { show: false },
			},
			yaxis: {
				max: horizontal ? undefined : emptyAxisMax,
				labels: {
					show: horizontal,
					style: {
						colors: chartNeutrals.chartBody,
						fontSize: "12px",
						fontWeight: 700,
					},
				},
			},
			tooltip: {
				enabled: true,
				y: {
					formatter: (value: number) => `${value}${valueSuffix}`,
				},
				x: {
					formatter: (_value: number, opts) => rawLabels[opts.dataPointIndex] ?? "",
				},
			},
			title: {
				...baseApexOptions.title,
				text: title || undefined,
				align: "center",
				style: {
					...baseApexOptions.title?.style,
					color: chartNeutrals.chartTitle,
				},
			},
		}),
		[
			chartColors,
			height,
			horizontal,
			horizontalAxisMax,
			rawLabels,
			rounded,
			emptyAxisMax,
			showLegend,
			title,
			valueSuffix,
		]
	);

	return (
		<ChartContainer className={className} isLoading={isLoading} minHeight={height}>
			{hasRenderableData || showEmptyChart ? (
				<ReactApexChart
					options={options}
					series={[{ name: title || "Responses", data: values }]}
					type="bar"
					height={height}
				/>
			) : (
				<div className="flex min-h-[260px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
					Waiting for responses...
				</div>
			)}
		</ChartContainer>
	);
}

export function HorizontalBarChart(props: BarChartProps) {
	return <BarChart {...props} horizontal valueSuffix={props.valueSuffix ?? "%"} />;
}
