"use client";

import { useMemo } from "react";
import { slideToRunView } from "@/features/deck/lib/previewRun";
import { runScoring } from "@/features/deck/lib/quiz";
import { DeckThemeProvider, type DeckTheme } from "@/features/deck/theme";
import type { RunState, Slide } from "@/features/deck/types";
import { getSlideType } from "../slideRegistry";
import { previewResult } from "./previewScore";
import { SlideErrorBoundary } from "./SlidePreview";

// The participant half of the full-screen preview: the slide type's real
// Participant inside a phone frame, answerable but offline. Answers stay in
// the preview (onSubmit only records them); after "Show results" a quiz
// answer is scored locally (previewScore) and the type's sample results
// stand in for everyone else's.

export interface PhoneAnswer {
	payload: unknown;
	/** Time from the question opening to the answer, for the speed bonus. */
	elapsedMs: number;
}

export function PhonePreview({
	slide,
	theme,
	state,
	answer,
	onAnswer,
	openedAt,
	showResults,
}: {
	slide: Slide;
	theme: DeckTheme;
	state: RunState;
	answer: PhoneAnswer | null;
	onAnswer(payload: unknown): void;
	/** When this question opened in the preview (ISO), drives the points bar. */
	openedAt: string | null;
	showResults: boolean;
}) {
	const entry = getSlideType(slide.type);
	const run = useMemo(
		() => ({ ...slideToRunView(slide, { state }), state_started_at: openedAt, voting_started_at: state === "voting" || state === "reveal" ? openedAt : null }),
		[slide, state, openedAt]
	);
	const aggregate = useMemo(() => {
		if (!showResults) return null;
		try {
			return entry?.sampleAggregate?.(slide) ?? null;
		} catch {
			return null;
		}
	}, [entry, showResults, slide]);
	const scoring = runScoring(run);
	const reveal = useMemo(() => {
		if (!showResults || !answer) return null;
		const result = previewResult(slide, answer.payload, scoring, answer.elapsedMs);
		if (!result) return null;
		const correct = (aggregate as { correct?: unknown } | null)?.correct ?? null;
		return { is_correct: result.is_correct, points_awarded: result.points_awarded, correct_answer: correct, total_points: result.points_awarded, rank: 1 };
	}, [aggregate, answer, scoring, showResults, slide]);

	const Participant = entry?.Participant;
	return (
		<div
			className="flex h-full max-h-[760px] w-[360px] shrink-0 flex-col overflow-hidden rounded-[2.6rem] border-[10px] border-[#1f2430] bg-[#1f2430] shadow-2xl"
			role="region"
			aria-label="Participant view (phone)"
		>
			<div className="flex h-6 shrink-0 items-center justify-center" aria-hidden>
				<span className="h-1.5 w-16 rounded-full bg-white/25" />
			</div>
			<DeckThemeProvider theme={theme} className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[1.9rem] bg-[var(--deck-bg)] text-[var(--deck-text)]">
				{Participant ? (
					<SlideErrorBoundary resetKey={slide}>
						<Participant
							run={run}
							mySubmission={(answer?.payload ?? null) as never}
							onSubmit={async (payload: unknown) => onAnswer(payload)}
							disabled={state !== "voting" && state !== "open"}
							theme={theme}
							aggregate={showResults ? aggregate : null}
							mode="live"
							scoring={scoring}
							reveal={reveal as never}
							standing={null}
							quiz={null}
						/>
					</SlideErrorBoundary>
				) : (
					<p className="p-6 text-center text-sm">Unknown slide type “{slide.type}”</p>
				)}
			</DeckThemeProvider>
		</div>
	);
}
