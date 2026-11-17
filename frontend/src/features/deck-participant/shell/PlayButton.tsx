"use client";

import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LoadingDots } from "./LoadingDots";
import { TapFeedback, type TapFeedbackProps } from "./TapFeedback";

// The participant app's buttons, coloured from the deck palette. Primary is
// 48 px tall (plan §4.6: 48×48 for primary actions), the others 44 px.

export interface PlayButtonProps extends Omit<TapFeedbackProps, "children"> {
	variant?: "primary" | "secondary" | "ghost" | "danger";
	size?: "md" | "lg";
	/** Full width (default true). */
	block?: boolean;
	loading?: boolean;
	/** Accessible label while loading (default "Please wait"). */
	loadingLabel?: string;
	icon?: ReactNode;
	children?: ReactNode;
}

const VARIANTS: Record<NonNullable<PlayButtonProps["variant"]>, string> = {
	primary:
		"bg-[var(--deck-primary)] text-[var(--deck-on-primary)] shadow-sm hover:brightness-[1.04] disabled:opacity-50",
	secondary:
		"border border-[var(--deck-border)] bg-[var(--deck-surface)] text-[var(--deck-text)] hover:bg-[var(--deck-surface-muted)] disabled:opacity-50",
	ghost: "text-[var(--deck-text)] hover:bg-[var(--deck-surface-muted)] disabled:opacity-50",
	danger: "bg-[var(--deck-danger)] text-white shadow-sm hover:brightness-[1.05] disabled:opacity-50",
};

export const PlayButton = forwardRef<HTMLButtonElement, PlayButtonProps>(function PlayButton(
	{
		variant = "primary",
		size,
		block = true,
		loading = false,
		loadingLabel = "Please wait",
		icon,
		children,
		className,
		disabled,
		haptic,
		...rest
	},
	ref
) {
	const resolvedSize = size ?? (variant === "primary" ? "lg" : "md");
	return (
		<TapFeedback
			ref={ref}
			disabled={disabled || loading}
			aria-busy={loading || undefined}
			haptic={haptic ?? (variant === "primary" ? "submit" : "tap")}
			className={cn(
				"inline-flex items-center justify-center gap-2 rounded-full px-6 font-semibold transition-[filter,background-color,opacity] disabled:cursor-not-allowed",
				resolvedSize === "lg" ? "min-h-12 text-base" : "min-h-11 text-[15px]",
				block && "w-full",
				VARIANTS[variant],
				className
			)}
			{...rest}
		>
			{loading ? (
				<LoadingDots label={loadingLabel} />
			) : (
				<>
					{icon}
					{children}
				</>
			)}
		</TapFeedback>
	);
});
