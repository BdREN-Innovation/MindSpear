"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { chartColor, type DeckTheme } from "@/features/deck/theme";
import { spinRotation, spinnerSegments } from "@/features/deck/lib/quiz";
import { msUntil } from "@/features/deck/live/useServerClock";
import { QUIZ_LIMITS, type IsoDateTime, type RunOption, type RunState, type SpinnerOptionPayload, type SpinnerSegment, type SlideAggregateMap } from "@/features/deck/types";
import type { QuizSlideLiveInfo } from "../types";
import { usePrefersReducedMotion } from "../shared";
import { optionLabel } from "../shared/labels";

// The spinner wheel (SVG) shared by the big screen and phones. Geometry is the
// run's `segments` (degrees clockwise from 12 o'clock, sized by weight); the
// server picks where it lands (target_angle) and the wheel turns clockwise so
// that angle ends under the 12 o'clock pointer, over what is left of the spin
// (ends_at on the server clock). A landed wheel rests there without animating.

export type WheelOption = RunOption<number, SpinnerOptionPayload>;

export interface WheelSpin {
	option_id: number;
	target_angle: number;
	duration_seconds: number | null;
	ends_at: IsoDateTime | null;
	landed: boolean;
}

/** Turns before landing (for the show). */
const TURNS = 6;

/** This run's spin: the live block (spin.started / state) or, after the reveal, the aggregate's. */
export function wheelSpin(
	runId: number,
	state: RunState,
	quiz: QuizSlideLiveInfo | null | undefined,
	aggregate: SlideAggregateMap["spinner_wheel"] | null | undefined
): WheelSpin | null {
	const live = quiz?.spin && quiz.spin.slide_run_id === runId ? quiz.spin : null;
	if (live) return { ...live, landed: live.landed || state === "reveal" };
	const result = aggregate && !Array.isArray(aggregate) ? aggregate.spin : undefined;
	return result ? { ...result, duration_seconds: null, ends_at: null, landed: true } : null;
}

export function wheelSegments(segments: SpinnerSegment[] | undefined, options: WheelOption[]): SpinnerSegment[] {
	return segments && segments.length > 0 ? segments : spinnerSegments(options);
}

function point(angle: number, radius: number): [number, number] {
	const rad = (angle * Math.PI) / 180;
	return [Math.sin(rad) * radius, -Math.cos(rad) * radius];
}

function slicePath(start: number, end: number, radius: number): string {
	if (end - start >= 359.999) return `M 0 ${-radius} A ${radius} ${radius} 0 1 1 0 ${radius} A ${radius} ${radius} 0 1 1 0 ${-radius} Z`;
	const [x1, y1] = point(start, radius);
	const [x2, y2] = point(end, radius);
	const large = end - start > 180 ? 1 : 0;
	return `M 0 0 L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${radius} ${radius} 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`;
}

function shorten(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function SpinnerWheelGraphic({
	segments,
	options,
	theme,
	spin,
	className,
}: {
	segments: SpinnerSegment[];
	options: WheelOption[];
	theme: DeckTheme;
	spin: WheelSpin | null;
	className?: string;
}) {
	const reduced = usePrefersReducedMotion();
	const R = 100;
	const labels = useMemo(() => new Map(options.map((option, index) => [option.id, optionLabel(option, index, "Entry")])), [options]);
	const indexOf = useMemo(() => new Map(options.map((option, index) => [option.id, index])), [options]);

	const rotation = spin ? spinRotation(spin.target_angle, TURNS) : 0;
	const remainingS = spin && !spin.landed ? Math.max(0, (msUntil(spin.ends_at) ?? (spin.duration_seconds ?? QUIZ_LIMITS.spinSeconds) * 1000) / 1000) : 0;
	const duration = reduced || !spin || spin.landed ? 0 : Math.min(remainingS, spin.duration_seconds ?? remainingS);
	const landed = !!spin?.landed;

	return (
		<div className={className} style={{ position: "relative", aspectRatio: "1 / 1" }}>
			<motion.div
				className="h-full w-full"
				initial={landed ? false : { rotate: 0 }}
				animate={{ rotate: rotation }}
				// Fast start, long glide to a stop.
				transition={{ duration, ease: [0.12, 0.8, 0.2, 1] }}
			>
				<svg viewBox="-104 -104 208 208" className="h-full w-full" role="img" aria-label={`Spinner wheel with ${segments.length} entries`}>
					<circle r={103} fill="var(--deck-surface)" stroke="var(--deck-border)" strokeWidth={2} />
					{segments.map((segment, index) => {
						const optionIndex = indexOf.get(segment.option_id) ?? index;
						const winner = landed && spin?.option_id === segment.option_id;
						const mid = (segment.start_angle + segment.end_angle) / 2;
						const span = segment.end_angle - segment.start_angle;
						const label = labels.get(segment.option_id) ?? `Entry ${index + 1}`;
						const fontSize = Math.max(5, Math.min(11, span / 3.2));
						return (
							<g key={segment.option_id} opacity={landed && !winner ? 0.4 : 1}>
								<path
									d={slicePath(segment.start_angle, segment.end_angle, R)}
									fill={chartColor(theme, optionIndex)}
									stroke={winner ? "#fff" : "var(--deck-bg)"}
									strokeWidth={winner ? 3 : 1}
								/>
								{span >= 8 ? (
									<g transform={`rotate(${mid})`}>
										<text
											x={0}
											y={-R * 0.58}
											// Left half: turn the other way so labels read upright with the wheel at rest.
											transform={`rotate(${mid > 180 ? 90 : -90} 0 ${-R * 0.58})`}
											textAnchor="middle"
											dominantBaseline="central"
											fontSize={fontSize}
											fontWeight={700}
											fill="#fff"
											style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.25)", strokeWidth: 1.2 }}
										>
											{shorten(label, span > 60 ? 18 : 12)}
										</text>
									</g>
								) : null}
							</g>
						);
					})}
					<circle r={13} fill="var(--deck-surface)" stroke="var(--deck-border)" strokeWidth={2} />
				</svg>
			</motion.div>
			{/* The pointer at 12 o'clock (does not turn). */}
			<svg viewBox="0 0 20 22" aria-hidden className="absolute left-1/2 top-0 w-[9%] -translate-x-1/2 -translate-y-[38%] drop-shadow">
				<path d="M10 22 L1 3 Q0 0 3 0 L17 0 Q20 0 19 3 Z" fill="var(--deck-text)" stroke="var(--deck-bg)" strokeWidth={1.5} />
			</svg>
		</div>
	);
}

/** The landed entry's label / image, for the message next to / under the wheel. */
export function landedOption(spin: WheelSpin | null, options: WheelOption[]): { label: string; imageUrl: string | null } | null {
	if (!spin?.landed) return null;
	const index = options.findIndex((option) => option.id === spin.option_id);
	if (index < 0) return { label: "An entry", imageUrl: null };
	return { label: optionLabel(options[index], index, "Entry"), imageUrl: options[index].image_url };
}
