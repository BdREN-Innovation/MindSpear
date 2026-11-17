"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { DeckTheme } from "@/features/deck/theme";
import type { ParticipantQaFeed } from "@/features/deck/live/qaFeed";
import type {
	ParticipantRunView,
	QuizScoringConfig,
	QuizStanding,
	SlideAggregate,
	StoredAnswer,
} from "@/features/deck/types";
import { getSlideType } from "@/features/deck-editor/slideRegistry";
import type { ParticipantQuizInfo, QuizReveal } from "@/features/deck-editor/slides/types";

// Mounts the registry's Participant component for a run. The type components
// are owned by other modules, so each one sits in an error boundary: a crash
// in one slide type shows a small fallback instead of taking the session
// screen down, and the boundary resets on the next run.
// Quiz sessions also pass scoring (points bar), reveal (my result), standing
// and the live quiz block; Quest never sets them.

export interface SlideStageProps {
	run: ParticipantRunView;
	theme: DeckTheme;
	mySubmission: StoredAnswer | null;
	/** Omit for read-only (content, review): submitting is a no-op. */
	onSubmit?: (payload: unknown) => Promise<void>;
	disabled: boolean;
	aggregate?: SlideAggregate | null;
	qa?: ParticipantQaFeed;
	mode?: "live" | "preview" | "review";
	scoring?: QuizScoringConfig | null;
	reveal?: QuizReveal | null;
	standing?: QuizStanding | null;
	quiz?: ParticipantQuizInfo | null;
}

const noSubmit = async () => undefined;

export function SlideStage({
	run,
	theme,
	mySubmission,
	onSubmit,
	disabled,
	aggregate,
	qa,
	mode = "live",
	scoring,
	reveal,
	standing,
	quiz,
}: SlideStageProps) {
	const entry = getSlideType(run.type);
	if (!entry) return <SlideFallback title={run.title} message="This slide type isn't supported on this device yet." />;
	const Participant = entry.Participant;
	return (
		<SlideErrorBoundary resetKey={`${run.id}:${run.state_version}`} title={run.title}>
			<Participant
				run={run}
				theme={theme}
				mySubmission={mySubmission}
				onSubmit={onSubmit ?? noSubmit}
				disabled={disabled}
				aggregate={aggregate ?? null}
				qa={qa}
				mode={mode}
				scoring={scoring}
				reveal={reveal}
				standing={standing}
				quiz={quiz}
			/>
		</SlideErrorBoundary>
	);
}

export function SlideFallback({ title, message }: { title?: string | null; message: string }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
			<AlertTriangle className="h-8 w-8 text-[var(--deck-text-muted)]" aria-hidden />
			{title && <p className="text-lg font-semibold">{title}</p>}
			<p className="text-sm text-[var(--deck-text-muted)]">{message}</p>
		</div>
	);
}

interface BoundaryProps {
	resetKey: string;
	title?: string | null;
	children: ReactNode;
}

class SlideErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
	state: { error: Error | null } = { error: null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("Participant slide failed to render", error, info.componentStack);
	}

	componentDidUpdate(previous: BoundaryProps) {
		if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
	}

	render() {
		if (this.state.error) {
			return (
				<SlideFallback
					title={this.props.title}
					message="This slide couldn't be shown. Watch the host's screen — the next slide will load normally."
				/>
			);
		}
		return this.props.children;
	}
}
