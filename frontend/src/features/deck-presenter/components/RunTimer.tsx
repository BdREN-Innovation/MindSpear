"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Clock, Radio } from "lucide-react";
import type { RunStateInfo } from "@/features/deck/live/channelState";
import { useServerClock } from "@/features/deck/live/useServerClock";
import { cn } from "@/lib/utils";
import { formatClock } from "../lib/format";
import type { RunKind } from "../lib/runKind";

// Plan §6.5. The server owns every deadline (ends_at); useServerClock counts
// down against the server clock. Untimed voting (most Quest slides) shows a
// "Voting open" chip instead. The channel hook resyncs shortly after a
// deadline, which applies the server's transition, so nothing here advances.

export interface RunTimerChipProps {
	kind: RunKind | null;
	runState: RunStateInfo | null;
}

/** Top-right chip on the stage: countdown, "Voting open", "Q&A open" or "Voting closed". */
export function RunTimerChip({ kind, runState }: RunTimerChipProps) {
	const state = runState?.state ?? null;
	const timed = state === "voting" && !!runState?.ends_at;
	const clock = useServerClock({
		endsAt: timed ? runState?.ends_at : null,
		durationSeconds: runState?.duration_seconds ?? null,
	});

	if (!kind || kind === "content" || !state || state === "waiting" || state === "get_ready") return null;

	const base =
		"pointer-events-none inline-flex items-center gap-2 rounded-full border px-4 py-2 text-lg font-semibold shadow-sm backdrop-blur";

	if (timed && clock.secondsRemaining !== null) {
		const urgent = clock.secondsRemaining <= 5;
		return (
			<div
				className={cn(
					base,
					"tabular-nums",
					urgent
						? "border-[var(--deck-danger)] bg-[var(--deck-danger)] text-white"
						: "border-[var(--deck-border)] bg-[var(--deck-surface)] text-[var(--deck-text)]"
				)}
				role="timer"
				aria-label={`${clock.secondsRemaining} seconds left`}
			>
				<Clock className="h-5 w-5" aria-hidden />
				<span className="min-w-[3.5ch] text-center text-xl">{formatClock(clock.secondsRemaining)}</span>
				{clock.progress !== null && (
					<span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-black/15" aria-hidden>
						<span
							className="absolute inset-y-0 left-0 rounded-full bg-current transition-[width] duration-200 ease-linear motion-reduce:transition-none"
							style={{ width: `${clock.progress * 100}%` }}
						/>
					</span>
				)}
			</div>
		);
	}

	if (state === "voting" || state === "open") {
		return (
			<div className={cn(base, "border-[var(--deck-success)] bg-[var(--deck-surface)] text-[var(--deck-success)]")}>
				<Radio className="h-5 w-5" aria-hidden />
				{state === "open" ? "Q&A open" : "Voting open"}
			</div>
		);
	}

	return (
		<div className={cn(base, "border-[var(--deck-border)] bg-[var(--deck-surface)] text-[var(--deck-text-muted)]")}>
			<CheckCircle2 className="h-5 w-5" aria-hidden />
			{kind === "qa" ? "Q&A closed" : "Voting closed"}
		</div>
	);
}

/** Full-stage "get ready" countdown before voting opens. */
export function GetReadyOverlay({ runState }: { runState: RunStateInfo | null }) {
	const active = runState?.state === "get_ready";
	const clock = useServerClock({ endsAt: active ? runState?.ends_at : null, tickMs: 100 });
	const reduceMotion = useReducedMotion();

	if (!active) return null;
	const seconds = clock.secondsRemaining;

	return (
		<div
			className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 text-[var(--deck-text)] backdrop-blur-sm"
			style={{ background: "color-mix(in srgb, var(--deck-bg) 92%, transparent)" }}
			role="status"
			aria-live="polite"
		>
			<p className="text-[clamp(1.5rem,3vw,3rem)] font-bold uppercase tracking-widest text-[var(--deck-text-muted)]">
				Get ready
			</p>
			<div className="relative flex h-[min(40vh,320px)] w-[min(40vh,320px)] items-center justify-center">
				<AnimatePresence mode="popLayout" initial={false}>
					<motion.span
						key={seconds ?? "…"}
						initial={reduceMotion ? false : { scale: 1.6, opacity: 0 }}
						animate={{ scale: 1, opacity: 1 }}
						exit={reduceMotion ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
						transition={{ duration: reduceMotion ? 0 : 0.35, ease: "easeOut" }}
						className="absolute text-[min(30vh,240px)] font-black leading-none tabular-nums text-[var(--deck-primary)]"
					>
						{seconds !== null && seconds > 0 ? seconds : "Go!"}
					</motion.span>
				</AnimatePresence>
			</div>
			<span className="sr-only">{seconds ? `Voting opens in ${seconds} seconds` : "Voting is opening"}</span>
		</div>
	);
}
