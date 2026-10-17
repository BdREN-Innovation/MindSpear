"use client";

import type { ApexOptions } from "apexcharts";

export type ChartDatum = {
	label: string;
	value: number;
	color?: string;
};

export type Word = {
	text: string;
	value: number;
};

export type ChartColorInput = ReadonlyArray<string | null | undefined>;

export type NormalizedChartProps = {
	data?: ChartDatum[] | number[];
	title?: string;
	height?: number;
	colors?: ChartColorInput;
	showLegend?: boolean;
	isLoading?: boolean;
	className?: string;
	/**
	 * Editor previews have no responses yet: draw the chart anyway (zero bars,
	 * faded equal slices) instead of the "Waiting for responses..." box.
	 */
	showEmptyChart?: boolean;
};

export type LegacyCategoricalProps = {
	categories?: string[];
	labels?: string[];
	series?: number[];
	width?: number | string;
};

export type ApexChartType = NonNullable<ApexOptions["chart"]>["type"];
