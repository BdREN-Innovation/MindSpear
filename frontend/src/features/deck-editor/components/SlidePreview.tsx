"use client";

import {
	Component,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type ErrorInfo,
	type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { slideToRunView } from "@/features/deck/lib/previewRun";
import { DeckThemeProvider, type DeckTheme } from "@/features/deck/theme";
import type { RunState, Slide } from "@/features/deck/types";
import { getSlideType } from "../slideRegistry";
import type { PresenterSessionInfo } from "../slides/types";

// Shared by the canvas, the rail thumbnails, the full-screen preview and the
// presenter's stage: a slide's Presenter rendered at a fixed 16:9 design size
// and scaled to fit, so every view lays the slide out exactly like the big
// screen does. The wrapper around the Presenter is the inline-size container,
// so cqw units (PresenterStage's padding and gaps too) resolve against the
// 1280 px slide, never the browser window.

export const SLIDE_BASE_WIDTH = 1280;
export const SLIDE_BASE_HEIGHT = 720;

/** Polls preview with their (sample) results showing, Q&A open, content as-is. */
export function previewStateFor(slide: Slide): RunState {
	if (slide.type === "qa_audience" || slide.revealModel === "moderated_feed") return "open";
	return slide.acceptsAnswers ? "voting" : "waiting";
}

/* ------------------------------------------------------------------ */

interface BoundaryProps {
	/** A new value clears a caught error (e.g. the edited slide). */
	resetKey: unknown;
	children: ReactNode;
	fallback?: ReactNode;
}

/** One broken slide type must not take the whole editor down. */
export class SlideErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
	state: { error: Error | null } = { error: null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidUpdate(previous: BoundaryProps) {
		if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("Slide component failed to render", error, info.componentStack);
	}

	render() {
		if (!this.state.error) return this.props.children;
		return (
			this.props.fallback ?? (
				<div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-dark-5">
					<AlertTriangle className="h-6 w-6 text-yellow-dark-2" aria-hidden />
					<p>This part of the slide could not be shown. Your content is safe.</p>
				</div>
			)
		);
	}
}

/* ------------------------------------------------------------------ */

interface ScaledSlideProps {
	children: ReactNode;
	/** width: fill the width at 16:9 (thumbnails); contain: fit inside the parent box (canvas, preview). */
	fit?: "width" | "contain";
	className?: string;
	/** Classes for the visible 16:9 frame (rounded corners, shadow). */
	frameClassName?: string;
}

export function ScaledSlide({ children, fit = "width", className, frameClassName }: ScaledSlideProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [box, setBox] = useState<{ scale: number; left: number; top: number } | null>(null);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const measure = () => {
			const { width, height } = element.getBoundingClientRect();
			if (width <= 0) return;
			const scale = fit === "contain" ? Math.min(width / SLIDE_BASE_WIDTH, height / SLIDE_BASE_HEIGHT) : width / SLIDE_BASE_WIDTH;
			if (scale <= 0) return;
			setBox({
				scale,
				left: fit === "contain" ? (width - SLIDE_BASE_WIDTH * scale) / 2 : 0,
				top: fit === "contain" ? (height - SLIDE_BASE_HEIGHT * scale) / 2 : 0,
			});
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [fit]);

	const frameStyle: CSSProperties | undefined = box
		? { left: box.left, top: box.top, width: SLIDE_BASE_WIDTH * box.scale, height: SLIDE_BASE_HEIGHT * box.scale }
		: undefined;

	return (
		<div ref={ref} className={cn("relative", fit === "width" ? "aspect-video w-full" : "h-full w-full", className)}>
			{box ? (
				<div className={cn("absolute overflow-hidden", frameClassName)} style={frameStyle}>
					<div
						className="absolute left-0 top-0 origin-top-left"
						style={{ width: SLIDE_BASE_WIDTH, height: SLIDE_BASE_HEIGHT, transform: `scale(${box.scale})` }}
					>
						{children}
					</div>
				</div>
			) : null}
		</div>
	);
}

/* ------------------------------------------------------------------ */

interface SlidePresenterPreviewProps {
	slide: Slide;
	theme: DeckTheme;
	totalSlides: number;
}

const PREVIEW_FRAME_STYLE: CSSProperties = {
	background: "var(--deck-bg)",
	color: "var(--deck-text)",
	containerType: "inline-size",
};

/** The slide's Presenter in preview mode (no session, no network) with the type's sample results. */
export function SlidePresenterPreview({ slide, theme, totalSlides }: SlidePresenterPreviewProps) {
	const entry = getSlideType(slide.type);
	const state = previewStateFor(slide);
	const run = useMemo(() => slideToRunView(slide, { state }), [slide, state]);
	const aggregate = useMemo(() => {
		try {
			return entry?.sampleAggregate?.(slide) ?? null;
		} catch {
			return null;
		}
	}, [entry, slide]);
	const session = useMemo<PresenterSessionInfo>(
		() => ({ sessionId: null, join: null, participantCount: null, totalSlides }),
		[totalSlides]
	);

	if (!entry) {
		return (
			<div className="flex h-full w-full items-center justify-center bg-gray-2 p-8 text-center text-2xl text-dark-5">
				Unknown slide type “{slide.type}”
			</div>
		);
	}

	const Presenter = entry.Presenter;
	return (
		<DeckThemeProvider theme={theme} className="h-full w-full overflow-hidden" style={PREVIEW_FRAME_STYLE}>
			<SlideErrorBoundary resetKey={slide}>
				<Presenter run={run} aggregate={aggregate} state={state} theme={theme} mode="preview" session={session} />
			</SlideErrorBoundary>
		</DeckThemeProvider>
	);
}
