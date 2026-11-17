"use client";

import { CloudOff } from "lucide-react";
import { PlayButton, PullIndicator } from "../shell";

// Full-screen retry state when the session could not be loaded at all
// (plan §7.6). Pull down or tap "Try again"; the caller also retries on its
// own with backoff.

export function ReconnectScreen({
	message,
	onRetry,
	retrying,
}: {
	message: string;
	onRetry: () => Promise<unknown> | void;
	retrying: boolean;
}) {
	return (
		<PullIndicator onRefresh={onRetry} refreshing={retrying} className="flex-1">
			<div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-6 py-12 text-center">
				<span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--deck-surface-muted)]">
					<CloudOff className="h-8 w-8 text-[var(--deck-text-muted)]" aria-hidden />
				</span>
				<h2 className="mt-5 text-xl font-semibold">Can&apos;t reach the session</h2>
				<p className="mt-2 text-sm text-[var(--deck-text-muted)]">{message}</p>
				<p className="mt-1 text-xs text-[var(--deck-text-muted)]">Pull down to try again.</p>
				<PlayButton className="mt-8" onClick={() => void onRetry()} loading={retrying} loadingLabel="Reconnecting">
					Try again
				</PlayButton>
			</div>
		</PullIndicator>
	);
}
