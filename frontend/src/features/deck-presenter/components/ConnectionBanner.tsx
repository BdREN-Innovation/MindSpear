"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import type { DeckApiError } from "@/features/deck/api/errors";
import type { DeckConnectionStatus } from "@/features/deck/live/channelState";

// Shown while the realtime socket is down or the last resync failed. The
// channel hook resyncs by itself on reconnect (and polls while offline), so
// the button is only a shortcut. A short grace period keeps it from
// flashing during the first connect or a sub-second blip.

export interface ConnectionBannerProps {
	status: DeckConnectionStatus;
	error: DeckApiError | null;
	/** Private host channel failed (auth): hidden-results aggregates fall back to polling. */
	hostChannelError: boolean;
	isResyncing: boolean;
	onResync: () => void;
}

const GRACE_MS = 1500;

export function ConnectionBanner({ status, error, hostChannelError, isResyncing, onResync }: ConnectionBannerProps) {
	const offline = status === "reconnecting" || status === "disconnected" || status === "connecting";
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		if (!offline) {
			setVisible(false);
			return;
		}
		const timer = window.setTimeout(() => setVisible(true), GRACE_MS);
		return () => window.clearTimeout(timer);
	}, [offline]);

	let message: string | null = null;
	let Icon = AlertTriangle;
	if (visible && offline) {
		Icon = WifiOff;
		message =
			status === "disconnected"
				? "Live connection lost. Votes are still being counted; the screen refreshes every few seconds until it is back."
				: "Reconnecting to live updates…";
	} else if (error && error.code !== "cancelled") {
		message = `Couldn't refresh the session: ${error.message}`;
	} else if (hostChannelError) {
		message = "Host updates are unavailable, so results refresh every few seconds instead of instantly.";
	}

	if (!message) return null;

	return (
		<div
			role="status"
			aria-live="polite"
			className="flex min-h-11 shrink-0 items-center justify-center gap-3 border-b border-[var(--deck-border)] bg-yellow-light-4 px-4 py-1.5 text-sm font-medium text-dark"
		>
			<Icon className="h-4 w-4 shrink-0" aria-hidden />
			<span>{message}</span>
			<button
				type="button"
				onClick={onResync}
				disabled={isResyncing}
				className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-dark/20 bg-white px-3 font-semibold hover:bg-gray-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dark disabled:opacity-60"
			>
				<RefreshCw className={isResyncing ? "h-4 w-4 animate-spin motion-reduce:animate-none" : "h-4 w-4"} aria-hidden />
				{isResyncing ? "Refreshing…" : "Refresh now"}
			</button>
		</div>
	);
}
