"use client";

import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { pulse } from "./haptics";

// Pull-to-refresh for reconnection-retry screens only (plan §4.2: never
// during a live session). Wraps its own scroll container; the browser's
// native pull-to-refresh is disabled there (overscroll-behavior: contain).
// Touch only: keyboard / mouse users get the screen's "Try again" button.

export interface PullIndicatorProps {
	onRefresh: () => Promise<unknown> | void;
	/** Show the spinner (e.g. while a retry runs, however it was started). */
	refreshing?: boolean;
	children: ReactNode;
	/** Pull distance (px) that triggers a refresh. */
	threshold?: number;
	className?: string;
}

const MAX_PULL = 140;

export function PullIndicator({ onRefresh, refreshing = false, children, threshold = 72, className }: PullIndicatorProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const startY = useRef<number | null>(null);
	const armed = useRef(false);
	const [pull, setPull] = useState(0);
	const [busy, setBusy] = useState(false);
	const spinning = refreshing || busy;

	const onTouchStart = (event: TouchEvent) => {
		if (spinning || (scrollRef.current?.scrollTop ?? 0) > 0) return;
		startY.current = event.touches[0].clientY;
		armed.current = false;
	};

	const onTouchMove = (event: TouchEvent) => {
		if (startY.current === null) return;
		const delta = event.touches[0].clientY - startY.current;
		if (delta <= 0) {
			setPull(0);
			return;
		}
		// Rubber band: the further you pull, the less it moves.
		const next = Math.min(MAX_PULL, delta * 0.5);
		if (next >= threshold && !armed.current) {
			armed.current = true;
			pulse("tap");
		} else if (next < threshold) {
			armed.current = false;
		}
		setPull(next);
	};

	const onTouchEnd = async () => {
		if (startY.current === null) return;
		startY.current = null;
		const trigger = armed.current;
		armed.current = false;
		setPull(0);
		if (!trigger) return;
		setBusy(true);
		try {
			await onRefresh();
		} finally {
			setBusy(false);
		}
	};

	const progress = Math.min(1, pull / threshold);
	const offset = spinning ? 56 : pull;

	return (
		<div
			ref={scrollRef}
			className={cn("ms-play-scroll relative h-full overflow-y-auto", className)}
			onTouchStart={onTouchStart}
			onTouchMove={onTouchMove}
			onTouchEnd={onTouchEnd}
			onTouchCancel={onTouchEnd}
		>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-0 flex justify-center"
				style={{ transform: `translateY(${Math.max(0, offset - 44)}px)`, opacity: spinning ? 1 : progress }}
			>
				<span className="mt-2 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--deck-surface)] text-[var(--deck-primary)] shadow-md">
					<RefreshCw
						className={cn("h-5 w-5", spinning && "animate-spin")}
						style={spinning ? undefined : { transform: `rotate(${progress * 270}deg)` }}
					/>
				</span>
			</div>
			<div
				className={cn(!startY.current && "transition-transform duration-200 ease-out")}
				style={{ transform: `translateY(${offset}px)` }}
			>
				{children}
			</div>
			<span className="sr-only" role="status">
				{spinning ? "Reconnecting" : ""}
			</span>
		</div>
	);
}
