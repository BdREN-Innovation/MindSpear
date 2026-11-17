"use client";

import type { CSSProperties, ReactNode } from "react";
import type { AxisLabels } from "@/features/deck/types";
import { cn } from "@/lib/utils";

// The 2×2 plane drawn by the presenter, the participant and the editor's
// mini preview: quadrant cross at 50 %, axis labels at the four edge
// midpoints (y high on top, y low at the bottom, x low left, x high right).
// Children are positioned in percent of the plane (left = x, top = 100 - y).

export type PlaneSize = "stage" | "phone" | "mini";

const LABEL_FONT: Record<PlaneSize, string> = {
	stage: "clamp(0.75rem, 1.5cqw, 1.35rem)",
	phone: "0.75rem",
	mini: "0.625rem",
};

const EDGE_INSET: Record<PlaneSize, string> = { stage: "1cqw", phone: "0.5rem", mini: "0.25rem" };

export interface MatrixPlaneProps {
	xAxis: AxisLabels | undefined;
	yAxis: AxisLabels | undefined;
	size: PlaneSize;
	/** Show "X low" etc. for empty labels (editor preview). */
	placeholders?: boolean;
	children?: ReactNode;
	className?: string;
	style?: CSSProperties;
}

function EdgeLabel({ text, placeholder, size, style }: { text: string; placeholder: string; size: PlaneSize; style: CSSProperties }) {
	const shown = text.trim() || placeholder;
	if (!shown) return null;
	return (
		<span
			className={cn(
				"pointer-events-none absolute z-10 max-w-[42%] truncate rounded-full font-semibold leading-tight",
				size === "stage" ? "px-[0.9cqw] py-[0.35cqw]" : "px-2 py-0.5"
			)}
			style={{
				fontSize: LABEL_FONT[size],
				background: "color-mix(in srgb, var(--deck-bg, #fff) 85%, transparent)",
				color: text.trim() ? "var(--deck-text, #111928)" : "var(--deck-text-muted, #4B5563)",
				border: "1px solid var(--deck-border, #E5E7EB)",
				...style,
			}}
			title={text.trim() || undefined}
		>
			{shown}
		</span>
	);
}

export function MatrixPlane({ xAxis, yAxis, size, placeholders = false, children, className, style }: MatrixPlaneProps) {
	const x = xAxis ?? { low: "", high: "" };
	const y = yAxis ?? { low: "", high: "" };
	const ph = (label: string) => (placeholders ? label : "");
	const inset = EDGE_INSET[size];
	const centerX: CSSProperties = { left: "50%", transform: "translateX(-50%)" };
	const centerY: CSSProperties = { top: "50%", transform: "translateY(-50%)" };

	return (
		<div
			className={cn("relative overflow-hidden rounded-xl", className)}
			style={{ background: "var(--deck-surface, #F9FAFB)", border: "1px solid var(--deck-border, #E5E7EB)", ...style }}
		>
			{/* Quadrant tint: top-right (high / high). */}
			<span
				aria-hidden
				className="pointer-events-none absolute right-0 top-0 h-1/2 w-1/2"
				style={{ background: "color-mix(in srgb, var(--deck-primary, #F79945) 7%, transparent)" }}
			/>
			<span aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-full w-px -translate-x-1/2" style={{ background: "var(--deck-border, #E5E7EB)" }} />
			<span aria-hidden className="pointer-events-none absolute left-0 top-1/2 h-px w-full -translate-y-1/2" style={{ background: "var(--deck-border, #E5E7EB)" }} />

			{children}

			<EdgeLabel text={y.high} placeholder={ph("Y high")} size={size} style={{ ...centerX, top: inset }} />
			<EdgeLabel text={y.low} placeholder={ph("Y low")} size={size} style={{ ...centerX, bottom: inset }} />
			<EdgeLabel text={x.low} placeholder={ph("X low")} size={size} style={{ ...centerY, left: inset }} />
			<EdgeLabel text={x.high} placeholder={ph("X high")} size={size} style={{ ...centerY, right: inset }} />
		</div>
	);
}

/** "Left: Cheap · Right: Expensive · Bottom: Slow · Top: Fast" for screen readers. */
export function describeAxes(xAxis: AxisLabels | undefined, yAxis: AxisLabels | undefined): string {
	const part = (name: string, label: string | undefined) => (label?.trim() ? `${name}: ${label.trim()}` : null);
	return [part("Left", xAxis?.low), part("Right", xAxis?.high), part("Bottom", yAxis?.low), part("Top", yAxis?.high)]
		.filter(Boolean)
		.join(", ");
}
