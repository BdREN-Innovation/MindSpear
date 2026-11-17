"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import type { ConnectionState, SocketFailure } from "../../realtime";

type ConnectionBannerProps = {
	connection: ConnectionState;
	failure: SocketFailure;
	/** Last request failed (e.g. no network). */
	requestFailed?: boolean;
};

/**
 * Shown only when something is wrong. Without realtime the screen keeps
 * working by polling, so "not configured" stays quiet apart from a small note.
 */
export function ConnectionBanner({ connection, failure, requestFailed }: ConnectionBannerProps) {
	const offline =
		requestFailed ||
		(connection === "offline" && failure === null) ||
		(typeof navigator !== "undefined" && !navigator.onLine);

	if (offline) {
		return (
			<div
				role="status"
				className="mb-3 flex items-center gap-2 rounded-lg border border-red-light-3 bg-red-light-5 px-3 py-2 text-sm font-semibold text-red-dark"
			>
				<WifiOff className="h-4 w-4 shrink-0" aria-hidden />
				You&apos;re offline. We&apos;ll catch up as soon as you&apos;re back. Answers you saved are kept.
			</div>
		);
	}
	if (connection === "reconnecting") {
		return (
			<div
				role="status"
				className="mb-3 flex items-center gap-2 rounded-lg border border-urgent/30 bg-urgent-bg px-3 py-2 text-sm font-semibold text-urgent-text"
			>
				<RefreshCw className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
				Reconnecting… The timer keeps running on the server.
			</div>
		);
	}
	return null;
}
