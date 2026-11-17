"use client";

import { useRouter } from "next/navigation";
import type { JoinDraftResult } from "../lib/useJoinDraft";
import { LoadingDots, PlayButton } from "../shell";
import { Notice } from "./Notice";

// Loading / bad code / lookup failure states shared by the name and avatar
// steps. Returns null once the draft is ready.

export function JoinStepStatus({ join }: { join: JoinDraftResult }) {
	const router = useRouter();

	if (join.status === "ready") return null;

	if (join.status === "loading") {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--deck-text-muted)]">
				<LoadingDots size="lg" label="Looking for the session" />
				<p className="text-sm">Looking for the session…</p>
			</div>
		);
	}

	const message =
		join.status === "invalid"
			? "That doesn't look like a session code. Codes have 6 letters and numbers."
			: (join.error ?? "Something went wrong. Please try again.");

	return (
		<div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-5 py-8">
			<Notice tone="error">{message}</Notice>
			{join.status === "error" && !join.notLive && (
				<PlayButton variant="secondary" onClick={join.retry}>
					Try again
				</PlayButton>
			)}
			<PlayButton onClick={() => router.replace("/play")}>Enter a different code</PlayButton>
		</div>
	);
}
