"use client";

import { memo, useEffect, useRef, useState } from "react";
import { AlarmClock, Hourglass, TimerOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerCountdown } from "../../hooks/useServerCountdown";
import { formatCountdown } from "../../lib/format";

export type TimerPhase = "normal" | "warning" | "critical" | "expired";

type CountdownTimerProps = {
	/** Server deadline (ISO). The timer never invents one. */
	deadline: string | null | undefined;
	/** When this window opened, for the "≤ 33% left" warning. */
	windowStartedAt?: string | null;
	label: string;
	/** "Critical" (tinted panel) in the last this-many ms. */
	criticalMs: number;
	/** Called once when the server deadline passes on this device. */
	onExpire?: () => void;
	className?: string;
};

const WARNING_SHARE = 1 / 3;

function phaseFor(remaining: number | null, windowMs: number | null, criticalMs: number): TimerPhase {
	if (remaining == null) return "normal";
	if (remaining <= 0) return "expired";
	if (remaining <= criticalMs) return "critical";
	if (windowMs && remaining <= windowMs * WARNING_SHARE) return "warning";
	return "normal";
}

const ANNOUNCE: Record<TimerPhase, (left: string) => string> = {
	normal: () => "",
	warning: (left) => `${left} left.`,
	critical: (left) => `Hurry, ${left} left.`,
	expired: () => "Time is up.",
};

/**
 * Counts down to a server deadline. Ticking is contained here so the rest of
 * the screen doesn't re-render every second. Threshold changes are announced
 * once to screen readers; the digits themselves are not live.
 */
export const CountdownTimer = memo(function CountdownTimer({
	deadline,
	windowStartedAt,
	label,
	criticalMs,
	onExpire,
	className,
}: CountdownTimerProps) {
	const remaining = useServerCountdown(deadline);
	const windowMs =
		deadline && windowStartedAt ? Date.parse(deadline) - Date.parse(windowStartedAt) : null;
	const phase = phaseFor(remaining, windowMs, criticalMs);
	const digits = formatCountdown(Math.max(0, remaining ?? 0));

	const [announcement, setAnnouncement] = useState("");
	const lastPhase = useRef<TimerPhase>(phase);
	useEffect(() => {
		if (phase === lastPhase.current) return;
		lastPhase.current = phase;
		setAnnouncement(ANNOUNCE[phase](digits));
		// Only the phase change matters, not every tick of `digits`.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [phase]);

	const expiredFor = useRef<string | null>(null);
	useEffect(() => {
		if (phase === "expired" && deadline && expiredFor.current !== deadline) {
			expiredFor.current = deadline;
			onExpire?.();
		}
	}, [phase, deadline, onExpire]);

	const progress =
		remaining != null && windowMs && windowMs > 0 ? Math.min(1, Math.max(0, remaining / windowMs)) : null;
	const Icon = phase === "expired" ? TimerOff : phase === "normal" ? Hourglass : AlarmClock;

	return (
		<div
			className={cn(
				"rounded-lg border px-4 py-3 transition-colors",
				phase === "critical" && "border-urgent/40 bg-urgent-bg",
				phase === "warning" && "border-urgent/30 bg-white",
				phase === "normal" && "border-slate-200 bg-white",
				phase === "expired" && "border-slate-200 bg-slate-100",
				className,
			)}
		>
			<div className="flex items-center justify-between gap-3">
				<span
					className={cn(
						"flex items-center gap-2 text-xs font-bold uppercase tracking-wide",
						phase === "warning" || phase === "critical" ? "text-urgent-text" : "text-slate-500",
					)}
				>
					<Icon className="h-4 w-4" aria-hidden />
					{phase === "expired" ? "Time's up" : label}
				</span>
				<span
					className={cn(
						"font-mono text-2xl font-semibold tabular-nums sm:text-3xl",
						phase === "warning" || phase === "critical" ? "text-urgent-text" : "text-slate-950",
						phase === "expired" && "text-slate-400",
					)}
					aria-label={`${label}: ${digits}`}
					role="timer"
				>
					{digits}
				</span>
			</div>
			{progress != null && (
				<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden>
					<div
						className={cn(
							"h-full rounded-full transition-[width] duration-300 ease-linear",
							phase === "normal" ? "bg-primary" : phase === "expired" ? "bg-slate-300" : "bg-urgent",
						)}
						style={{ width: `${progress * 100}%` }}
					/>
				</div>
			)}
			<span className="sr-only" aria-live="polite">
				{announcement}
			</span>
		</div>
	);
});
