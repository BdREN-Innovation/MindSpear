/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Check, CheckCircle2, CircleDashed, Clock, Hourglass, X, XCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { toDeckApiError } from "@/features/deck/api/errors";
import { earnablePoints } from "@/features/deck/lib/quiz";
import { serverNow } from "@/features/deck/live/useServerClock";
import type { DeckTheme } from "@/features/deck/theme";
import type { IsoDateTime, QuizScoringConfig, RunState } from "@/features/deck/types";
import { useAnswer, type AnswerState } from "./answer";
import { haptic, usePrefersReducedMotion } from "./hooks";
import { ParticipantLayout, ParticipantNotice } from "./participantKit";
import { formatPoints, optionLetter, rankLabel } from "./quizLabels";

// Phone pieces of the Quiz v2 Participants (plan §3.2): the "earnable points"
// bar that counts down while answering with the speed bonus on, the
// locked-in screen, the big ✅ "+N points" / ❌ "0 points" result after the
// reveal with my standing, and result rows that highlight the correct answer.
// Correctness only ever comes from the reveal (props.reveal / aggregate.correct).

/** Where a quiz Participant is in its run. */
export type QuizPhase = "answering" | "locked_in" | "result" | "not_open";

/**
 * reveal / review → result; voting → answering until an answer is stored, then
 * locked in (quiz answers are final: the speed bonus is earned at the first submit).
 */
export function quizPhase(state: RunState, mode: "live" | "preview" | "review" | undefined, answered: boolean): QuizPhase {
	if (mode === "review" || state === "reveal" || state === "closed") return "result";
	if (state === "voting") return answered ? "locked_in" : "answering";
	return "not_open";
}

/* ------------------------------------------------------------------ */
/* Answers are final (409 already_answered)                            */
/* ------------------------------------------------------------------ */

/** 409 invalid_state {reason: 'already_answered'}: the server kept the first answer of this scored run. */
export function isAlreadyAnswered(reason: unknown): boolean {
	const error = toDeckApiError(reason);
	return error.code === "invalid_state" && error.reason === "already_answered";
}

export interface QuizAnswerState<S, P> extends AnswerState<S, P> {
	/**
	 * A submit on this run came back 409 already_answered (an earlier send
	 * landed, e.g. its response was lost, or another tab answered): the
	 * screen stays locked in. The shell resyncs on invalid_state, so the
	 * stored answer itself arrives as mySubmission shortly after.
	 */
	alreadyAnswered: boolean;
}

/** useAnswer for scored quiz runs: also remembers a 409 already_answered for this run. */
export function useQuizAnswer<S, P>(runId: number, mySubmission: S | null, onSubmit: (payload: P) => Promise<void>): QuizAnswerState<S, P> {
	const [answeredRun, setAnsweredRun] = useState<number | null>(null);
	const guarded = useCallback(
		async (payload: P) => {
			try {
				await onSubmit(payload);
			} catch (reason) {
				if (isAlreadyAnswered(reason)) setAnsweredRun(runId);
				throw reason;
			}
		},
		[onSubmit, runId]
	);
	const answer = useAnswer<S, P>(runId, mySubmission, guarded);
	return { ...answer, alreadyAnswered: answeredRun === runId };
}

/* ------------------------------------------------------------------ */
/* Options hidden until voting                                         */
/* ------------------------------------------------------------------ */

/**
 * Scored quiz participant views carry `options: []` + `options_hidden: true`
 * while the run is waiting / get_ready (the title is still sent), so nobody
 * reads the answers during the countdown. Read defensively: absent = shown.
 */
export function optionsHidden(run: { options_hidden?: boolean | null }): boolean {
	return run.options_hidden === true;
}

/**
 * The question with "Get ready…" in place of the answers. In `voting` the
 * fresh run view (with the options) is still on its way: "Here it comes…".
 */
export function OptionsHiddenView({
	theme,
	title,
	state,
	hint = "The answers appear on your phone when the question starts.",
}: {
	theme: DeckTheme;
	title: string;
	state: RunState;
	hint?: string;
}) {
	const reduced = usePrefersReducedMotion();
	const arriving = state === "voting";
	return (
		<ParticipantLayout theme={theme} title={title}>
			<div role="status" aria-live="polite" className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
				<motion.span
					aria-hidden
					className="flex h-20 w-20 items-center justify-center rounded-full"
					style={{ background: "color-mix(in srgb, var(--deck-primary, #F79945) 14%, var(--deck-surface, #fff))" }}
					animate={reduced ? undefined : { rotate: [0, 0, 180, 180] }}
					transition={reduced ? undefined : { duration: 2.4, times: [0, 0.45, 0.6, 1], repeat: Infinity, ease: "easeInOut" }}
				>
					<Hourglass className="h-10 w-10" style={{ color: "var(--deck-primary, #F79945)" }} />
				</motion.span>
				<p className="m-0 text-2xl font-bold">{arriving ? "Here it comes…" : "Get ready…"}</p>
				<p className="m-0 max-w-xs text-base" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					{arriving ? "The answers are on their way." : hint}
				</p>
			</div>
		</ParticipantLayout>
	);
}

/**
 * Locked in without a local copy of the answer (409 already_answered, or the
 * answer arrived while the options are hidden): no summary until the shell's
 * resync brings the stored answer.
 */
export function FirstAnswerLockedIn({ theme, title }: { theme: DeckTheme; title: string }) {
	return (
		<ParticipantLayout theme={theme} title={title}>
			<LockedIn>
				<ParticipantNotice>You&apos;ve already answered this question. Your first answer counts.</ParticipantNotice>
			</LockedIn>
		</ParticipantLayout>
	);
}

/* ------------------------------------------------------------------ */
/* Earnable points                                                     */
/* ------------------------------------------------------------------ */

/** Points a fully correct answer earns right now (ticks while `active` and the speed bonus is on). */
export function useEarnablePoints(
	scoring: QuizScoringConfig | null | undefined,
	votingStartedAt: IsoDateTime | null | undefined,
	active: boolean
): number | null {
	const ticking = !!(active && scoring?.speed_bonus_enabled && scoring.time_limit_seconds && votingStartedAt);
	const [now, setNow] = useState(() => serverNow());

	useEffect(() => {
		if (!ticking) return;
		setNow(serverNow());
		const timer = window.setInterval(() => setNow(serverNow()), 200);
		return () => window.clearInterval(timer);
	}, [ticking]);

	if (!scoring) return null;
	const started = votingStartedAt ? Date.parse(votingStartedAt) : Number.NaN;
	const elapsed = Number.isFinite(started) ? Math.max(0, now - started) : 0;
	return earnablePoints(scoring, elapsed);
}

/** The "50p ──── 100p" bar: what a correct answer earns now, falling to points_min at the time limit. */
export function PointsBar({
	scoring,
	votingStartedAt,
	active,
}: {
	scoring: QuizScoringConfig | null | undefined;
	votingStartedAt: IsoDateTime | null | undefined;
	/** Count down (answering); otherwise frozen. */
	active: boolean;
}) {
	const points = useEarnablePoints(scoring, votingStartedAt, active);
	if (!scoring || points === null) return null;

	const { points_min: min, points_max: max } = scoring;
	const speed = scoring.speed_bonus_enabled && !!scoring.time_limit_seconds && max > min;
	const share = speed ? Math.max(0, Math.min(1, (points - min) / (max - min))) : 1;

	return (
		<div
			className="flex flex-col gap-1.5 rounded-xl px-3 py-2.5"
			style={{ background: "var(--deck-surface-muted, #F3F4F6)", color: "var(--deck-text, #111928)" }}
		>
			<div className="flex items-baseline justify-between gap-3">
				<span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					<Zap className="h-4 w-4" aria-hidden style={{ color: "var(--deck-primary, #F79945)" }} />
					{speed ? "Earnable points" : "Points"}
				</span>
				<span className="text-lg font-bold tabular-nums">{formatPoints(points)}</span>
			</div>
			<div
				role="progressbar"
				aria-label={speed ? "Points a correct answer earns now" : "Points for a correct answer"}
				aria-valuemin={speed ? min : 0}
				aria-valuemax={max}
				aria-valuenow={points}
				aria-valuetext={`${points} points`}
				className="h-2.5 w-full overflow-hidden rounded-full"
				style={{ background: "color-mix(in srgb, var(--deck-text-muted, #4B5563) 18%, transparent)" }}
			>
				<div
					className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-linear"
					style={{ width: `${share * 100}%`, background: "var(--deck-primary, #F79945)" }}
				/>
			</div>
			{speed ? (
				<div className="flex justify-between text-xs tabular-nums" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					<span>{formatPoints(min)}p</span>
					<span>Answer fast for more points</span>
					<span>{formatPoints(max)}p</span>
				</div>
			) : null}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Locked in                                                           */
/* ------------------------------------------------------------------ */

/** After submitting: the answer is final until the reveal. */
export function LockedIn({ children, title = "Answer locked in!" }: { children?: ReactNode; title?: string }) {
	const reduced = usePrefersReducedMotion();
	return (
		<div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-6 text-center">
			<motion.span
				initial={reduced ? false : { scale: 0.6, opacity: 0 }}
				animate={{ scale: 1, opacity: 1 }}
				transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 18 }}
			>
				<CheckCircle2 className="h-16 w-16" style={{ color: "var(--deck-primary, #F79945)" }} aria-hidden />
			</motion.span>
			<h3 className="m-0 text-2xl font-bold">{title}</h3>
			<p className="m-0 text-base" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
				Watch the big screen for the answer.
			</p>
			{children ? <div className="mt-2 w-full">{children}</div> : null}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Result banner                                                       */
/* ------------------------------------------------------------------ */

export interface QuizResultInfo {
	is_correct: boolean | null;
	points_awarded: number;
}

/**
 * The big result after the reveal: ✅ "+N points", a partial "+N points"
 * (match / order / categorise), ❌ "0 points", "No answer", or a short
 * "checking" line while my-answer is still loading. Pulses a haptic once.
 */
export function QuizResultBanner({
	result,
	answered,
	standing,
	participantCount,
	runId,
}: {
	result: QuizResultInfo | null | undefined;
	answered: boolean;
	standing: { total: number; rank: number | null } | null;
	participantCount?: number | null;
	/** Haptic once per run. */
	runId: number;
}) {
	const reduced = usePrefersReducedMotion();
	const kind = !answered ? "none" : !result ? "pending" : result.is_correct ? "correct" : result.points_awarded > 0 ? "partial" : "wrong";
	const pulsed = useRef<number | null>(null);

	useEffect(() => {
		if (pulsed.current === runId || kind === "pending") return;
		pulsed.current = runId;
		if (kind === "correct" || kind === "partial") haptic("success");
		else if (kind === "wrong") haptic("error");
	}, [kind, runId]);

	const config = {
		correct: { Icon: CheckCircle2, title: "Correct!", color: "var(--deck-success, #15803D)" },
		partial: { Icon: CircleDashed, title: "Partly correct", color: "var(--deck-primary, #F79945)" },
		wrong: { Icon: XCircle, title: "Not quite", color: "var(--deck-danger, #B91C1C)" },
		none: { Icon: Clock, title: "No answer", color: "var(--deck-text-muted, #4B5563)" },
		pending: { Icon: Clock, title: "Checking your answer…", color: "var(--deck-text-muted, #4B5563)" },
	}[kind];
	const points = kind === "correct" || kind === "partial" ? `+${formatPoints(result?.points_awarded ?? 0)} points` : kind === "pending" ? null : "0 points";
	const rank = rankLabel(standing?.rank, participantCount);

	return (
		<div
			role="status"
			aria-live="polite"
			className="flex flex-col items-center gap-2 rounded-2xl px-4 py-5 text-center"
			style={{ background: `color-mix(in srgb, ${config.color} 12%, var(--deck-surface, #fff))`, color: "var(--deck-text, #111928)" }}
		>
			<motion.span
				initial={reduced ? false : { scale: 0.4, opacity: 0, rotate: kind === "wrong" ? -12 : 0 }}
				animate={{ scale: 1, opacity: 1, rotate: 0 }}
				transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 16 }}
			>
				<config.Icon className="h-20 w-20" style={{ color: config.color }} aria-hidden />
			</motion.span>
			<p className="m-0 text-2xl font-bold">{config.title}</p>
			{points ? (
				<motion.p
					className="m-0 text-3xl font-extrabold tabular-nums"
					style={{ color: kind === "wrong" || kind === "none" ? "var(--deck-text-muted, #4B5563)" : config.color }}
					initial={reduced ? false : { opacity: 0, y: 8 }}
					animate={{ opacity: 1, y: 0 }}
					transition={reduced ? { duration: 0 } : { delay: 0.25, duration: 0.3 }}
				>
					{points}
				</motion.p>
			) : null}
			{standing ? (
				<p className="m-0 text-sm font-semibold tabular-nums" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					{rank ? `You're ${rank}` : "Not ranked yet"} · {formatPoints(standing.total)} points
				</p>
			) : null}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Result rows                                                         */
/* ------------------------------------------------------------------ */

export type ResultTone = "correct" | "wrong" | "neutral" | "missed";

/** A row of a revealed answer: green = correct, red = my wrong pick, dashed = a correct one I missed. */
export function ResultRow({
	tone,
	label,
	imageUrl,
	index,
	note,
	trailing,
}: {
	tone: ResultTone;
	label: ReactNode;
	imageUrl?: string | null;
	/** Shows a letter badge. */
	index?: number;
	/** Muted line under the label (e.g. "Your answer", "Correct: Paris"). */
	note?: ReactNode;
	trailing?: ReactNode;
}) {
	const color =
		tone === "correct" || tone === "missed" ? "var(--deck-success, #15803D)" : tone === "wrong" ? "var(--deck-danger, #B91C1C)" : "var(--deck-border, #E5E7EB)";
	const tint = tone === "correct" ? 14 : tone === "wrong" ? 12 : 0;
	return (
		<li
			className={cn("flex min-h-12 items-center gap-3 rounded-xl border-2 px-3 py-2", tone === "missed" && "border-dashed")}
			style={{
				borderColor: color,
				background: tint ? `color-mix(in srgb, ${color} ${tint}%, var(--deck-surface, #fff))` : "var(--deck-surface, #fff)",
				color: "var(--deck-text, #111928)",
			}}
		>
			{index !== undefined ? (
				<span
					aria-hidden
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
					style={{ background: "var(--deck-surface-muted, #F3F4F6)", color: "var(--deck-text-muted, #4B5563)" }}
				>
					{optionLetter(index)}
				</span>
			) : null}
			{imageUrl ? <img src={imageUrl} alt="" draggable={false} className="h-10 w-10 shrink-0 rounded-md object-cover" /> : null}
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="break-words text-base font-semibold leading-snug">{label}</span>
				{note ? (
					<span className="text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
						{note}
					</span>
				) : null}
			</span>
			{trailing}
			<ToneIcon tone={tone} />
		</li>
	);
}

export function ToneIcon({ tone }: { tone: ResultTone }) {
	if (tone === "neutral") return null;
	const correct = tone !== "wrong";
	const Icon = correct ? Check : X;
	return (
		<span
			className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
			style={{ background: correct ? "var(--deck-success, #15803D)" : "var(--deck-danger, #B91C1C)", color: "#fff", opacity: tone === "missed" ? 0.75 : 1 }}
		>
			<Icon className="h-4 w-4" strokeWidth={3} aria-hidden />
			<span className="sr-only">{tone === "wrong" ? "incorrect" : tone === "missed" ? "correct, not chosen" : "correct"}</span>
		</span>
	);
}

/** Section heading inside a participant result view. */
export function ResultHeading({ children }: { children: ReactNode }) {
	return (
		<h3 className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
			{children}
		</h3>
	);
}
