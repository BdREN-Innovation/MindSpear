"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ScaledSlide } from "@/features/deck-editor/components/SlidePreview";
import { getSlideType } from "@/features/deck-editor/slideRegistry";
import type { HostActions, PresenterQuizInfo, PresenterSessionInfo } from "@/features/deck-editor/slides/types";
import type { DeckTheme } from "@/features/deck/theme";
import type { ParticipantRunView, RunState, SlideAggregate, SlimRunView } from "@/features/deck/types";

// Centre of the presenter: the current run's registry Presenter (plan §6.3)
// in 'live' mode. The shell never switches on the type; any key the
// registry knows renders, and an unknown key or a Presenter that throws gets
// a fallback instead of taking the session controls down with it.
//
// The slide is laid out at the same 1280×720 design size as the editor's
// canvas (ScaledSlide) and scaled to fit, letterboxed to 16:9. Inside, a
// wrapper is the inline-size container, so every cqw unit (PresenterStage's
// own padding included) and every rem cap in a clamp() lands on the same
// fraction of the slide on a 1280 or 1920 projector as in the editor.

interface BoundaryProps {
	resetKey: string;
	label: string;
	children: ReactNode;
}

interface BoundaryState {
	error: Error | null;
	resetKey: string;
}

class PresenterErrorBoundary extends Component<BoundaryProps, BoundaryState> {
	state: BoundaryState = { error: null, resetKey: this.props.resetKey };

	static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
		return { error };
	}

	// The next run gets a fresh attempt.
	static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
		return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error(`Presenter for "${this.props.label}" crashed`, error, info.componentStack);
	}

	render() {
		if (this.state.error) {
			return (
				<StageMessage
					icon={<AlertTriangle className="h-10 w-10" aria-hidden />}
					title="This slide can't be shown right now"
					detail="The session keeps running: votes are still counted and you can move on."
				/>
			);
		}
		return this.props.children;
	}
}

function StageMessage({ icon, title, detail }: { icon: ReactNode; title: string; detail?: string }) {
	return (
		<div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center text-[var(--deck-text-muted)]">
			{icon}
			<p className="text-2xl font-semibold text-[var(--deck-text)]">{title}</p>
			{detail && <p className="max-w-xl text-lg">{detail}</p>}
		</div>
	);
}

export interface SlideStageProps {
	run: ParticipantRunView | null;
	slimRun: SlimRunView | null;
	state: RunState | null;
	aggregate: SlideAggregate | null;
	theme: DeckTheme;
	host: HostActions;
	session: PresenterSessionInfo;
	/** Quiz sessions: submitted count, spin, leaderboard rows, reveal delta of this run (null for Quest). */
	quiz?: PresenterQuizInfo | null;
	/** Shell chrome drawn on the slide's top-right corner (the timer chip), scaled with the slide. */
	cornerOverlay?: ReactNode;
}

export function SlideStage({ run, slimRun, state, aggregate, theme, host, session, quiz = null, cornerOverlay }: SlideStageProps) {
	const reduceMotion = useReducedMotion();

	if (!run) {
		return slimRun ? (
			<StageMessage
				icon={<Loader2 className="h-10 w-10 animate-spin motion-reduce:animate-none" aria-hidden />}
				title="Loading slide…"
			/>
		) : (
			<StageMessage
				icon={<Loader2 className="h-10 w-10 animate-spin motion-reduce:animate-none" aria-hidden />}
				title="Waiting for the session…"
			/>
		);
	}

	const entry = getSlideType(run.type);
	const Presenter = entry?.Presenter;

	return (
		<ScaledSlide fit="contain" className="overflow-hidden">
			<div className="relative h-full w-full overflow-hidden" style={{ containerType: "inline-size" }}>
				<AnimatePresence mode="wait" initial={false}>
					<motion.div
						key={run.id}
						className="h-full w-full"
						initial={reduceMotion ? false : { opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -12 }}
						transition={{ duration: reduceMotion ? 0 : 0.25, ease: "easeOut" }}
					>
						{Presenter ? (
							<PresenterErrorBoundary resetKey={`${run.id}`} label={entry.label}>
								<Presenter
									run={run}
									aggregate={aggregate}
									state={state ?? run.state}
									theme={theme}
									mode="live"
									host={host}
									session={session}
									quiz={quiz && quiz.slide_run_id === run.id ? quiz : null}
								/>
							</PresenterErrorBoundary>
						) : (
							<StageMessage
								icon={<AlertTriangle className="h-10 w-10" aria-hidden />}
								title={run.title?.trim() || "Unsupported slide"}
								detail={`This app version can't show "${run.type}" slides. Move on to the next slide.`}
							/>
						)}
					</motion.div>
				</AnimatePresence>
				{cornerOverlay ? <div className="pointer-events-none absolute right-4 top-4 z-10">{cornerOverlay}</div> : null}
			</div>
		</ScaledSlide>
	);
}
