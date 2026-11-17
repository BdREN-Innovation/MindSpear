"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import type { PresenterProps } from "../types";
import { PresenterStage, ResponseCount, ResultsEmpty, SlideTitle, usePrefersReducedMotion } from "../shared";
import { HeatmapCanvas } from "../shared/HeatmapCanvas";
import { fallbackTitle } from "../shared/labels";
import { describePoint, pointKeys } from "../shared/pointMath";
import { TIMER_CHIP_CLEARANCE } from "../shared/stageLayout";
import { describeAxes, MatrixPlane } from "./MatrixPlane";

// matrix_2x2 presenter (plan §6.3): cartesian scatter on the 2×2 plane with
// the axis labels, density shading from the 20×20 grid (it counts every
// point, while `points` holds only the latest 150), dots that fade in as they
// arrive, and the centroid of every point.

const PLANE_ASPECT = 1.6;

export function Matrix2x2Presenter({ run, aggregate, theme }: PresenterProps<"matrix_2x2">) {
	const reduceMotion = usePrefersReducedMotion();
	const points = useMemo(() => aggregate?.points ?? [], [aggregate]);
	const keys = useMemo(() => pointKeys(points), [points]);
	const total = aggregate?.total_points ?? 0;
	const centroid = aggregate?.centroid ?? null;
	const axes = describeAxes(run.config.x_axis, run.config.y_axis);

	return (
		<PresenterStage>
			{/* Right padding keeps the shell's timer chip area (top-right ~220×56 px) clear. */}
			<div className="flex items-start justify-between gap-[2cqw]" style={TIMER_CHIP_CLEARANCE}>
				<SlideTitle title={run.title} fallback={fallbackTitle("matrix_2x2")} size="md" />
				<ResponseCount count={aggregate?.total_responses ?? 0} className="shrink-0" />
			</div>

			<div className="relative min-h-0 flex-1" style={{ containerType: "size" }}>
				<div
					className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
					style={{ width: `min(100cqw, calc(100cqh * ${PLANE_ASPECT}))`, aspectRatio: `${PLANE_ASPECT}` }}
				>
					<MatrixPlane xAxis={run.config.x_axis} yAxis={run.config.y_axis} size="stage" className="h-full w-full">
						<HeatmapCanvas
							points={points}
							density={aggregate?.density}
							total={total}
							yUp
							aspect={PLANE_ASPECT}
							variant="tint"
							color={theme.colors.primary}
							opacity={0.45}
						/>

						{points.map((point, index) => (
							<motion.span
								key={keys[index]}
								aria-hidden
								className="absolute rounded-full"
								initial={reduceMotion ? false : { opacity: 0, scale: 0.3 }}
								animate={{ opacity: 0.9, scale: 1 }}
								transition={{ duration: reduceMotion ? 0 : 0.4, ease: "easeOut" }}
								style={{
									left: `${point.x}%`,
									top: `${100 - point.y}%`,
									width: "1.3cqw",
									height: "1.3cqw",
									minWidth: 6,
									minHeight: 6,
									marginLeft: "-0.65cqw",
									marginTop: "-0.65cqw",
									background: "var(--deck-primary)",
									border: "0.15cqw solid var(--deck-bg)",
								}}
							/>
						))}

						{centroid ? (
							<motion.span
								aria-hidden
								className="absolute z-[5] flex items-center justify-center rounded-full"
								animate={{ left: `${centroid.x}%`, top: `${100 - centroid.y}%` }}
								initial={false}
								transition={{ duration: reduceMotion ? 0 : 0.5, ease: "easeOut" }}
								style={{
									width: "3cqw",
									height: "3cqw",
									marginLeft: "-1.5cqw",
									marginTop: "-1.5cqw",
									border: "0.35cqw solid var(--deck-accent)",
									background: "color-mix(in srgb, var(--deck-accent) 20%, transparent)",
								}}
							>
								<span className="h-[0.8cqw] w-[0.8cqw] rounded-full" style={{ background: "var(--deck-accent)" }} />
							</motion.span>
						) : null}
					</MatrixPlane>

					{total === 0 ? <ResultsEmpty className="pointer-events-none absolute inset-0" /> : null}
				</div>
			</div>

			{centroid ? (
				<p className="m-0 flex items-center gap-[0.8cqw]" style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.75rem, 1.3cqw, 1.1rem)" }}>
					<span
						aria-hidden
						className="inline-block h-[1.2cqw] min-h-3 w-[1.2cqw] min-w-3 rounded-full"
						style={{ border: "0.25cqw solid var(--deck-accent)" }}
					/>
					Average position
				</p>
			) : null}

			<p className="sr-only" aria-live="polite">
				{`${total} ${total === 1 ? "dot" : "dots"} placed.`}
				{centroid ? ` Average ${describePoint(centroid)} on a 0 to 100 grid.` : ""}
				{axes ? ` Axes: ${axes}.` : ""}
			</p>
		</PresenterStage>
	);
}
