"use client";

import { X } from "lucide-react";
import { formatJoinCode, joinDisplayUrl } from "../lib/join";

// Top banner (plan §6.2): "To join: <host>/play — code ABC 123", dismissible.

export interface JoinBannerProps {
	joinCode: string;
	onDismiss: () => void;
}

export function JoinBanner({ joinCode, onDismiss }: JoinBannerProps) {
	return (
		<div
			role="region"
			aria-label="Join instructions"
			className="relative flex min-h-12 shrink-0 items-center justify-center gap-x-3 bg-[var(--deck-primary)] px-14 py-1.5 text-center text-[clamp(1rem,1.35vw,1.5rem)] text-[var(--deck-on-primary)]"
		>
			<p className="flex flex-wrap items-baseline justify-center gap-x-2">
				<span>To join:</span>
				<strong className="font-bold">{joinDisplayUrl()}</strong>
				<span aria-hidden>—</span>
				<span>code</span>
				<strong className="whitespace-nowrap font-mono font-bold tracking-[0.12em]">{formatJoinCode(joinCode)}</strong>
			</p>
			<button
				type="button"
				onClick={onDismiss}
				aria-label="Hide join banner"
				title="Hide join banner"
				className="absolute right-1.5 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
			>
				<X className="h-5 w-5" aria-hidden />
			</button>
		</div>
	);
}
