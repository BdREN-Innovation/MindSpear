/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import type { PresenterProps } from "../types";
import { PresenterStage, usePrefersReducedMotion } from "../shared";
import { quizFallbackTitle } from "../shared/quizLabels";
import { QuizHeader, StageHint } from "../shared/quizPresenter";
import { SpinnerWheelGraphic, landedOption, wheelSegments, wheelSpin, type WheelOption } from "./Wheel";

// spinner_wheel on the big screen: a large wheel at rest (waiting), turning to
// the server's target over the spin (voting = spinning, from spin.started),
// then resting on the landed entry, which is highlighted and named (reveal).

export function SpinnerWheelPresenter({ run, aggregate, state, theme, quiz }: PresenterProps<"spinner_wheel">) {
	const reduced = usePrefersReducedMotion();
	const options = run.options as WheelOption[];
	const spin = wheelSpin(run.id, state, quiz, aggregate);
	const landed = landedOption(spin, options);
	const segments = wheelSegments(run.segments, options);

	return (
		<PresenterStage style={theme.cssVars as CSSProperties}>
			<QuizHeader title={run.title} fallback={quizFallbackTitle("spinner_wheel")} />
			<div className="flex min-h-0 flex-1 items-center justify-center gap-[5cqw]">
				<SpinnerWheelGraphic segments={segments} options={options} theme={theme} spin={spin} className="w-[35cqw] shrink-0" />
				<div className="flex w-[34cqw] flex-col gap-[1.4cqw]" aria-live="polite">
					{landed ? (
						<motion.div
							initial={reduced ? false : { opacity: 0, scale: 0.85 }}
							animate={{ opacity: 1, scale: 1 }}
							transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 18 }}
							className="flex flex-col gap-[1cqw] rounded-[1.6cqw] p-[2cqw]"
							style={{ background: "color-mix(in srgb, var(--deck-primary) 16%, var(--deck-surface))", border: "2px solid var(--deck-primary)" }}
						>
							<span className="font-semibold uppercase tracking-wide" style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.8rem, 1.4cqw, 1.2rem)" }}>
								The wheel landed on
							</span>
							{landed.imageUrl ? (
								<img src={landed.imageUrl} alt="" draggable={false} className="rounded-[1cqw] object-cover" style={{ width: "12cqw", height: "12cqw" }} />
							) : null}
							<span className="break-words font-extrabold leading-tight" style={{ fontSize: "clamp(1.5rem, 4.4cqw, 4rem)" }}>
								{landed.label}
							</span>
						</motion.div>
					) : (
						<StageHint>
							{spin ? "Spinning…" : state === "waiting" ? "Press Start to spin the wheel." : "Get ready…"}
						</StageHint>
					)}
				</div>
			</div>
		</PresenterStage>
	);
}
