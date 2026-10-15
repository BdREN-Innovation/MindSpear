"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Share, SquarePlus, X } from "lucide-react";
import { PlayButton } from "../shell/PlayButton";
import { TapFeedback } from "../shell/TapFeedback";
import { useInstallPrompt } from "./installPrompt";

// One-time "Add MindSpear to your home screen" card (plan §4.1), shown on the
// live screen after a successful join while nothing is being answered.

export function InstallBanner({ hidden = false }: { hidden?: boolean }) {
	const { mode, install, dismiss } = useInstallPrompt();
	const reduceMotion = useReducedMotion();
	const visible = !!mode && !hidden;

	return (
		<AnimatePresence>
			{visible && (
				<motion.aside
					aria-label="Install MindSpear"
					className="mx-4 mb-4 flex items-start gap-3 rounded-2xl border border-[var(--deck-border)] bg-[var(--deck-surface)] p-3 shadow-sm"
					initial={reduceMotion ? false : { opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
				>
					{/* eslint-disable-next-line @next/next/no-img-element -- static icon, no optimisation needed */}
					<img src="/pwa/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-xl" />
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold">Add MindSpear to your home screen</p>
						{mode === "ios" ? (
							<p className="mt-0.5 text-sm text-[var(--deck-text-muted)]">
								Tap <Share className="inline h-4 w-4 align-[-2px]" aria-label="Share" /> then{" "}
								<span className="whitespace-nowrap font-medium text-[var(--deck-text)]">
									<SquarePlus className="inline h-4 w-4 align-[-2px]" aria-hidden /> Add to Home Screen
								</span>{" "}
								for the full experience.
							</p>
						) : (
							<>
								<p className="mt-0.5 text-sm text-[var(--deck-text-muted)]">
									Full screen, faster to open next time.
								</p>
								<PlayButton
									variant="primary"
									size="md"
									block={false}
									className="mt-2"
									onClick={() => void install()}
								>
									Install
								</PlayButton>
							</>
						)}
					</div>
					<TapFeedback
						onClick={dismiss}
						aria-label="Dismiss install suggestion"
						className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--deck-text-muted)] hover:bg-[var(--deck-surface-muted)]"
					>
						<X className="h-5 w-5" aria-hidden />
					</TapFeedback>
				</motion.aside>
			)}
		</AnimatePresence>
	);
}
