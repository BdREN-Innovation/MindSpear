"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Lock, MessageCircleQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerClock } from "@/features/deck/live/useServerClock";
import type { IsoDateTime, ParticipantRunView } from "@/features/deck/types";
import { getSlideType } from "@/features/deck-editor/slideRegistry";
import { runTitle } from "../lib/runs";
import { LoadingDots, useAnnounce } from "../shell";

// The run-state screens around the type's Participant component (plan §7.2):
// lobby (no slide yet), waiting for the host, the get-ready countdown,
// voting closed, the timer bar and the "answer sent" strip (§7.4).
//
// The countdowns own their 250 ms clock (useServerClock), so only these small
// components re-render while time runs — never the slide's answer UI.

export function CenteredLoading({ label }: { label: string }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-[var(--deck-text-muted)]">
			<LoadingDots size="lg" label={label} />
			<p className="text-sm">{label}…</p>
		</div>
	);
}

export function LobbyView({ name, emoji, deckTitle }: { name: string; emoji: string; deckTitle?: string | null }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
			<span
				role="img"
				aria-label="Your avatar"
				className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-[var(--deck-primary)] bg-[var(--deck-surface)] text-[60px] leading-none"
			>
				{emoji}
			</span>
			<h2 className="mt-6 text-2xl font-bold tracking-tight">You&apos;re in, {name}!</h2>
			{deckTitle && <p className="mt-1 text-[15px] text-[var(--deck-text-muted)]">{deckTitle}</p>}
			<p className="mt-6 inline-flex items-center gap-2 text-sm text-[var(--deck-text-muted)]">
				<LoadingDots label={null} size="sm" /> Waiting for the host to start
			</p>
		</div>
	);
}

function TypeChip({ run }: { run: ParticipantRunView }) {
	const entry = getSlideType(run.type);
	if (!entry) return null;
	const Icon = entry.icon;
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--deck-surface-muted)] px-3 py-1 text-xs font-medium text-[var(--deck-text-muted)]">
			<Icon className="h-3.5 w-3.5" aria-hidden />
			{entry.label}
		</span>
	);
}

export function WaitingForHost({ run }: { run: ParticipantRunView }) {
	const qa = run.type === "qa_audience";
	return (
		<div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
			<TypeChip run={run} />
			<h2 className="mt-4 text-2xl font-bold leading-snug tracking-tight">{runTitle(run)}</h2>
			<p className="mt-6 inline-flex items-center gap-2 text-sm text-[var(--deck-text-muted)]">
				<LoadingDots label={null} size="sm" />
				{qa ? "Questions will open soon" : "Waiting for the host to open voting"}
			</p>
		</div>
	);
}

export interface CountdownProps {
	/** The state's deadline (run state ends_at); null = untimed. */
	endsAt: IsoDateTime | null | undefined;
	durationSeconds?: number | null;
}

export function GetReadyOverlay({ run, endsAt, durationSeconds }: CountdownProps & { run: ParticipantRunView }) {
	const reduceMotion = useReducedMotion();
	const { secondsRemaining: seconds } = useServerClock({ endsAt, durationSeconds });
	return (
		<div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
			<p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--deck-text-muted)]">Get ready</p>
			<div className="relative mt-6 flex h-40 w-40 items-center justify-center" role="timer" aria-live="off">
				<span className="absolute inset-0 rounded-full border-[6px] border-[var(--deck-surface-muted)]" aria-hidden />
				<AnimatePresence mode="popLayout" initial={false}>
					<motion.span
						key={seconds ?? "dots"}
						className="font-mono text-[72px] font-semibold leading-none"
						initial={reduceMotion ? false : { scale: 1.6, opacity: 0 }}
						animate={{ scale: 1, opacity: 1 }}
						exit={reduceMotion ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
						transition={{ type: "spring", stiffness: 420, damping: 26 }}
					>
						{seconds !== null && seconds > 0 ? seconds : <LoadingDots label={null} size="lg" />}
					</motion.span>
				</AnimatePresence>
			</div>
			<h2 className="mt-8 text-xl font-semibold leading-snug">{runTitle(run)}</h2>
		</div>
	);
}

export function VotingClosedView({
	run,
	answered,
	resultsVisible,
	children,
}: {
	run: ParticipantRunView;
	answered: boolean;
	resultsVisible: boolean;
	children?: ReactNode;
}) {
	const qa = run.type === "qa_audience";
	return (
		<div className="flex flex-1 flex-col">
			<div className="mx-4 mt-4 flex items-start gap-3 rounded-2xl bg-[var(--deck-surface-muted)] px-4 py-3">
				{qa ? (
					<MessageCircleQuestion className="mt-0.5 h-5 w-5 shrink-0 text-[var(--deck-text-muted)]" aria-hidden />
				) : (
					<Lock className="mt-0.5 h-5 w-5 shrink-0 text-[var(--deck-text-muted)]" aria-hidden />
				)}
				<div className="min-w-0 text-sm">
					<p className="font-semibold">{qa ? "Questions are closed" : "Voting is closed"}</p>
					<p className="text-[var(--deck-text-muted)]">
						{qa
							? "Thanks for taking part."
							: answered
								? "Your answer was counted."
								: "You didn't answer this one."}{" "}
						{!qa && !resultsVisible && "Results are on the host's screen."}
					</p>
				</div>
			</div>
			{children}
		</div>
	);
}

/** Voting countdown bar; announces "N seconds left" once at ten seconds. */
export function TimerBar({ endsAt, durationSeconds }: CountdownProps) {
	const { secondsRemaining: seconds, progress } = useServerClock({ endsAt, durationSeconds });
	const announce = useAnnounce();
	const announcedFor = useRef<string | null>(null);
	useEffect(() => {
		if (seconds === null || !endsAt) return;
		if (seconds <= 10 && seconds > 0 && announcedFor.current !== endsAt) {
			announcedFor.current = endsAt;
			announce(`${seconds} seconds left.`);
		}
	}, [seconds, endsAt, announce]);

	if (seconds === null) return null;
	const urgent = seconds <= 5;
	return (
		<div className="sticky top-0 z-10 bg-[var(--deck-bg)] px-4 pb-1 pt-2">
			<div className="flex items-center gap-3">
				<div
					className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--deck-surface-muted)]"
					role="progressbar"
					aria-label="Time left"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
				>
					<div
						className={cn(
							"h-full rounded-full transition-[width] duration-300 ease-linear",
							urgent ? "bg-[var(--deck-danger)]" : "bg-[var(--deck-primary)]"
						)}
						style={{ width: `${Math.round((progress ?? 1) * 100)}%` }}
					/>
				</div>
				<span
					className={cn(
						"min-w-10 text-right font-mono text-sm font-semibold tabular-nums",
						urgent ? "text-[var(--deck-danger)]" : "text-[var(--deck-text-muted)]"
					)}
					aria-hidden
				>
					{seconds}s
				</span>
			</div>
		</div>
	);
}

export function SubmittedStrip({ message }: { message: string }) {
	const reduceMotion = useReducedMotion();
	return (
		<motion.div
			role="status"
			className="flex min-h-11 items-center justify-center gap-2 text-sm font-medium"
			initial={reduceMotion ? false : { scale: 0.92, opacity: 0 }}
			animate={{ scale: 1, opacity: 1 }}
			transition={{ type: "spring", stiffness: 500, damping: 28 }}
		>
			<CheckCircle2 className="h-5 w-5 text-[var(--deck-success)]" aria-hidden />
			{message}
		</motion.div>
	);
}
