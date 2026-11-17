/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import type { ParticipantProps } from "../types";
import { ParticipantLayout } from "../shared/participantKit";
import { quizDisplayTitle } from "../shared/quizLabels";
import { SpinnerWheelGraphic, landedOption, wheelSegments, wheelSpin, type WheelOption } from "./Wheel";

// spinner_wheel on the phone: view only. The same wheel, smaller, turning
// with the big screen; then the entry it landed on.

export function SpinnerWheelParticipant({ run, theme, aggregate, quiz }: ParticipantProps<"spinner_wheel">) {
	const options = run.options as WheelOption[];
	const spin = wheelSpin(run.id, run.state, quiz, aggregate);
	const landed = landedOption(spin, options);
	return (
		<ParticipantLayout theme={theme} title={quizDisplayTitle(run.title, "spinner_wheel")}>
			<div className="flex flex-col items-center gap-5 pt-2">
				<SpinnerWheelGraphic segments={wheelSegments(run.segments, options)} options={options} theme={theme} spin={spin} className="w-full max-w-[20rem]" />
				<div role="status" aria-live="polite" className="flex flex-col items-center gap-2 text-center">
					{landed ? (
						<>
							<span className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
								The wheel landed on
							</span>
							{landed.imageUrl ? <img src={landed.imageUrl} alt="" draggable={false} className="h-20 w-20 rounded-xl object-cover" /> : null}
							<span className="break-words text-3xl font-extrabold">{landed.label}</span>
						</>
					) : (
						<span className="text-base font-medium" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
							{spin ? "Spinning…" : "Watch the big screen — the host will spin the wheel."}
						</span>
					)}
				</div>
			</div>
		</ParticipantLayout>
	);
}
