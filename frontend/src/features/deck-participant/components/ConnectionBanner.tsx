"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { RefreshCw, WifiOff } from "lucide-react";
import type { DeckConnectionStatus } from "@/features/deck/live/useDeckSessionChannel";
import { LoadingDots, TapFeedback } from "../shell";

// Slim banner under the top bar (plan §7.6): offline, socket reconnecting, or
// the last state read failed. The session keeps working through REST while
// the socket is down (the channel hook polls state meanwhile).

export interface ConnectionBannerProps {
	status: DeckConnectionStatus;
	online: boolean;
	/** Last state read failed (not an auth/404 failure, those navigate away). */
	failed: boolean;
	resyncing: boolean;
	onRetry: () => void;
}

export function ConnectionBanner({ status, online, failed, resyncing, onRetry }: ConnectionBannerProps) {
	const reduceMotion = useReducedMotion();
	const kind = !online
		? "offline"
		: status === "reconnecting" || status === "disconnected"
			? "reconnecting"
			: failed
				? "failed"
				: null;

	return (
		<AnimatePresence initial={false}>
			{kind && (
				<motion.div
					key="banner"
					role="status"
					className="shrink-0 overflow-hidden bg-[var(--deck-surface-muted)] text-sm"
					initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
					animate={reduceMotion ? { opacity: 1 } : { height: "auto", opacity: 1 }}
					exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
				>
					<div className="flex min-h-11 items-center gap-2 px-4 py-1.5">
						{kind === "offline" ? (
							<>
								<WifiOff className="h-4 w-4 shrink-0" aria-hidden />
								<span className="flex-1">You&apos;re offline. We&apos;ll reconnect when you&apos;re back online.</span>
							</>
						) : kind === "reconnecting" ? (
							<>
								<LoadingDots label={null} size="sm" />
								<span className="flex-1">Reconnecting…</span>
							</>
						) : (
							<>
								<span className="flex-1">Couldn&apos;t update the session.</span>
								<TapFeedback
									onClick={onRetry}
									disabled={resyncing}
									className="-my-1 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-semibold text-[var(--deck-text)] hover:bg-[var(--deck-surface)]"
								>
									<RefreshCw className={resyncing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />
									Retry
								</TapFeedback>
							</>
						)}
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
