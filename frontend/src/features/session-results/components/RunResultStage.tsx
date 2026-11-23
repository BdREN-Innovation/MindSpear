"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ScaledSlide, SlideErrorBoundary } from "@/features/deck-editor/components/SlidePreview";
import { getSlideType } from "@/features/deck-editor/slideRegistry";
import type { PresenterSessionInfo } from "@/features/deck-editor/slides/types";
import { aggregateResponses } from "@/features/deck-presenter/lib/format";
import { runKindOf } from "@/features/deck-presenter/lib/runKind";
import { DeckThemeProvider, type DeckTheme } from "@/features/deck/theme";
import type { PresenterRunView, RunState } from "@/features/deck/types";
import { plural } from "../format";

// One run of a past session, drawn by its slide type's registry Presenter in
// 'preview' mode (no host, no network) with the run's final aggregate, on the
// same 1280×720 scaled stage as the editor canvas and the presenter. A type
// that cannot render outside a live session falls back to its response count.

const FRAME_STYLE: CSSProperties = {
	background: "var(--deck-bg)",
	color: "var(--deck-text)",
	containerType: "inline-size",
};

/**
 * Results read final: quiz runs as revealed (their Presenters hide results
 * until then), polls as closed unless the session is still live on them.
 */
function resultState(run: PresenterRunView): RunState {
	if (runKindOf(run) === "quiz") return "reveal";
	return run.state === "voting" || run.state === "open" || run.state === "reveal" ? run.state : "closed";
}

/** Mounts the Presenter only once the card scrolls near the viewport. */
function useSeen<T extends Element>() {
	const ref = useRef<T>(null);
	const [seen, setSeen] = useState(false);
	useEffect(() => {
		const element = ref.current;
		if (!element || seen) return;
		if (typeof IntersectionObserver === "undefined") {
			setSeen(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setSeen(true);
					observer.disconnect();
				}
			},
			{ rootMargin: "400px 0px" }
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [seen]);
	return { ref, seen };
}

export function responsesOf(run: PresenterRunView): number | null {
	return aggregateResponses(run.aggregate);
}

function ResponsesFallback({ run }: { run: PresenterRunView }) {
	return (
		<div className="flex h-full w-full flex-col items-center justify-center gap-4 p-16 text-center">
			<p className="text-5xl font-bold">{plural(responsesOf(run) ?? 0, "response")}</p>
			<p className="text-2xl text-[var(--deck-text-muted)]">This slide&apos;s results can&apos;t be drawn here. Download the CSV for every answer.</p>
		</div>
	);
}

export function RunResultStage({ run, theme, totalSlides }: { run: PresenterRunView; theme: DeckTheme; totalSlides: number }) {
	const entry = getSlideType(run.type);
	const { ref, seen } = useSeen<HTMLDivElement>();
	const session = useMemo<PresenterSessionInfo>(
		() => ({ sessionId: null, join: null, participantCount: null, totalSlides }),
		[totalSlides]
	);
	const Presenter = entry?.Presenter;

	return (
		<div ref={ref} className="mx-auto w-full max-w-3xl overflow-hidden rounded-lg border border-stroke dark:border-stroke-dark">
			<ScaledSlide fit="width">
				{seen ? (
					<DeckThemeProvider theme={theme} className="h-full w-full overflow-hidden" style={FRAME_STYLE}>
						{Presenter ? (
							<SlideErrorBoundary resetKey={run.id} fallback={<ResponsesFallback run={run} />}>
								<Presenter
									run={run}
									aggregate={run.aggregate}
									state={resultState(run)}
									theme={theme}
									mode="preview"
									session={session}
								/>
							</SlideErrorBoundary>
						) : (
							<ResponsesFallback run={run} />
						)}
					</DeckThemeProvider>
				) : null}
			</ScaledSlide>
		</div>
	);
}
