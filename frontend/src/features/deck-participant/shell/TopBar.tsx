"use client";

import type { ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TapFeedback } from "./TapFeedback";

// Compact title bar (plan §4.2), styled like a Material-3 small top app bar /
// iOS inline title: 56 px, padded for the status bar / notch, back (or
// close) on the left, an optional action on the right. Hardware back on the
// live screen is handled by useBackGuard; this button is the on-screen twin.

export interface TopBarProps {
	title?: ReactNode;
	subtitle?: ReactNode;
	/** Shows the back / close button. */
	onBack?: () => void;
	/** Accessible label of the back button (default "Back"). */
	backLabel?: string;
	backIcon?: "back" | "close" | ReactNode;
	/** Right-hand action(s); keep each ≥ 44×44. */
	right?: ReactNode;
	/** No bottom border / surface (screens with their own header art). */
	transparent?: boolean;
	className?: string;
}

export function TopBar({
	title,
	subtitle,
	onBack,
	backLabel = "Back",
	backIcon = "back",
	right,
	transparent = false,
	className,
}: TopBarProps) {
	const icon =
		backIcon === "back" ? (
			<ChevronLeft className="h-6 w-6" aria-hidden />
		) : backIcon === "close" ? (
			<X className="h-6 w-6" aria-hidden />
		) : (
			backIcon
		);

	return (
		<header
			className={cn(
				"relative z-20 shrink-0",
				!transparent && "border-b border-[var(--deck-border)] bg-[var(--deck-bg)]",
				className
			)}
			style={{ paddingTop: "env(safe-area-inset-top)" }}
		>
			<div className="flex min-h-14 items-center gap-1 px-1.5">
				<div className="flex w-11 shrink-0 justify-start">
					{onBack && (
						<TapFeedback
							onClick={onBack}
							aria-label={backLabel}
							className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--deck-text)] hover:bg-[var(--deck-surface-muted)]"
						>
							{icon}
						</TapFeedback>
					)}
				</div>
				<div className="min-w-0 flex-1 text-center">
					{title && <h1 className="truncate text-base font-semibold leading-tight">{title}</h1>}
					{subtitle && <p className="truncate text-xs text-[var(--deck-text-muted)]">{subtitle}</p>}
				</div>
				<div className="flex min-w-11 shrink-0 items-center justify-end gap-1">{right}</div>
			</div>
		</header>
	);
}
