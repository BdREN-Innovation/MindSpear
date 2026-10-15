"use client";

import { useEffect, useMemo, useRef } from "react";
import type { DensityGrid, Point } from "@/features/deck/types";
import { cn } from "@/lib/utils";

// Client-side heatmap (plan §6.3): every sample is splatted onto an alpha
// canvas as a gaussian kernel (radial gradient with exp(-4.5·t²) stops), the
// accumulated alpha is normalised, then coloured through a palette. The raw
// list is capped at 150 points by the backend, so once the total is larger
// the 20×20 density grid (which counts every point) is used instead, weighted
// by count. The canvas has a fixed small resolution and is stretched by CSS:
// a blurred field looks the same scaled.

export interface HeatmapCanvasProps {
	/** Raw points (0..100 percent). */
	points: Point[];
	/** Density of every point (aggregate.density). */
	density?: DensityGrid | null;
	/** Every point counted (total_pins / total_points); above points.length the grid is used. */
	total?: number;
	/** true: y 100 = top (matrix); false: y 0 = top (pin_on_image). */
	yUp?: boolean;
	/** Drawing surface width / height (match the box it covers). */
	aspect: number;
	/** heat: blue→red palette; tint: one colour (density shading). */
	variant?: "heat" | "tint";
	/** tint colour (hex). */
	color?: string;
	/** Max alpha of the coloured field, 0..1. */
	opacity?: number;
	className?: string;
}

interface Sample {
	/** 0..1 across the canvas, screen orientation. */
	x: number;
	y: number;
	weight: number;
}

const HEAT_STOPS: [number, string][] = [
	[0, "rgba(60,80,224,0)"],
	[0.18, "rgba(60,80,224,0.75)"],
	[0.42, "#0EA5E9"],
	[0.62, "#22AD5C"],
	[0.8, "#F59E0B"],
	[1, "#ED3A76"],
];

const GAUSS_STOPS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];

function heatSamples(points: Point[], density: DensityGrid | null | undefined, total: number | undefined, yUp: boolean): Sample[] {
	const toScreenY = (y: number) => (yUp ? 1 - y / 100 : y / 100);
	const useGrid = !!density && density.size > 0 && (total ?? points.length) > points.length;
	if (!useGrid) return points.map((point) => ({ x: point.x / 100, y: toScreenY(point.y), weight: 1 }));

	const samples: Sample[] = [];
	const { size, counts } = density!;
	counts.forEach((row, rowIndex) =>
		row.forEach((count, colIndex) => {
			if (count > 0) {
				samples.push({
					x: (colIndex + 0.5) / size,
					y: toScreenY(((rowIndex + 0.5) * 100) / size),
					weight: count,
				});
			}
		})
	);
	return samples;
}

function hexToRgb(hex: string | undefined): [number, number, number] {
	const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex?.trim() ?? "");
	if (!match) return [247, 153, 69];
	const value = match[1].length === 3 ? match[1].replace(/./g, (c) => c + c) : match[1];
	const n = parseInt(value, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

let heatPalette: Uint8ClampedArray | null = null;

/** 256 RGBA entries of the heat gradient (built once). */
function getHeatPalette(): Uint8ClampedArray | null {
	if (heatPalette) return heatPalette;
	const canvas = document.createElement("canvas");
	canvas.width = 256;
	canvas.height = 1;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	const gradient = ctx.createLinearGradient(0, 0, 256, 0);
	HEAT_STOPS.forEach(([stop, color]) => gradient.addColorStop(stop, color));
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, 256, 1);
	heatPalette = ctx.getImageData(0, 0, 256, 1).data;
	return heatPalette;
}

function draw(canvas: HTMLCanvasElement, samples: Sample[], gridSize: number | null, props: Required<Pick<HeatmapCanvasProps, "variant" | "opacity">> & { color?: string }) {
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return;
	const { width, height } = canvas;
	ctx.clearRect(0, 0, width, height);
	if (samples.length === 0) return;

	// Kernel radius: ~1.6 grid cells, or 7.5% of the long side for raw points.
	const radius = gridSize ? (1.6 * Math.max(width, height)) / gridSize : 0.075 * Math.max(width, height);
	const maxWeight = Math.max(...samples.map((sample) => sample.weight));
	for (const sample of samples) {
		const alpha = gridSize ? 0.25 + 0.75 * (sample.weight / maxWeight) : 0.35;
		const cx = sample.x * width;
		const cy = sample.y * height;
		const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
		for (const t of GAUSS_STOPS) gradient.addColorStop(t, `rgba(0,0,0,${(alpha * Math.exp(-4.5 * t * t)).toFixed(4)})`);
		ctx.fillStyle = gradient;
		ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
	}

	const image = ctx.getImageData(0, 0, width, height);
	const data = image.data;
	let peak = 0;
	for (let i = 3; i < data.length; i += 4) if (data[i] > peak) peak = data[i];
	if (peak === 0) return;
	const scale = 255 / peak;
	const palette = props.variant === "heat" ? getHeatPalette() : null;
	const [r, g, b] = hexToRgb(props.color);

	for (let i = 0; i < data.length; i += 4) {
		const level = Math.min(255, Math.round(data[i + 3] * scale));
		if (level === 0) continue;
		if (palette) {
			const p = level * 4;
			data[i] = palette[p];
			data[i + 1] = palette[p + 1];
			data[i + 2] = palette[p + 2];
			data[i + 3] = Math.round(palette[p + 3] * props.opacity);
		} else {
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = Math.round(level * props.opacity);
		}
	}
	ctx.putImageData(image, 0, 0);
}

/** Absolutely positioned heatmap layer filling its (relative) parent. Decorative: aria-hidden. */
export function HeatmapCanvas({
	points,
	density,
	total,
	yUp = false,
	aspect,
	variant = "heat",
	color,
	opacity = 0.85,
	className,
}: HeatmapCanvasProps) {
	const ref = useRef<HTMLCanvasElement>(null);
	const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
	const base = 256;
	const width = Math.max(32, Math.round(safeAspect >= 1 ? base : base * safeAspect));
	const height = Math.max(32, Math.round(safeAspect >= 1 ? base / safeAspect : base));

	const samples = useMemo(() => heatSamples(points, density, total, yUp), [points, density, total, yUp]);
	const gridSize = !!density && (total ?? points.length) > points.length ? density.size : null;

	useEffect(() => {
		if (ref.current) draw(ref.current, samples, gridSize, { variant, opacity, color });
	}, [samples, gridSize, variant, opacity, color, width, height]);

	return (
		<canvas
			ref={ref}
			width={width}
			height={height}
			aria-hidden
			className={cn("pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-500 motion-reduce:transition-none", className)}
		/>
	);
}
