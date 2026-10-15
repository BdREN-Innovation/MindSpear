"use client";

import { forwardRef, type ButtonHTMLAttributes, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

// Presenter buttons. After a mouse click the button gives focus back to the
// page, so the next Space / → press drives the deck instead of re-clicking
// the last button (keyboard and touch users keep their focus).

export type ControlTone = "ghost" | "primary" | "danger" | "outline";

export interface ControlButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	tone?: ControlTone;
	/** Square icon-only button (needs aria-label). */
	icon?: boolean;
	size?: "md" | "lg";
}

const TONES: Record<ControlTone, string> = {
	ghost: "bg-transparent text-[var(--deck-text)] hover:bg-[var(--deck-surface-muted)] aria-pressed:bg-[var(--deck-surface-muted)]",
	outline:
		"border border-[var(--deck-border)] bg-[var(--deck-surface)] text-[var(--deck-text)] hover:bg-[var(--deck-surface-muted)]",
	primary: "bg-[var(--deck-primary)] text-[var(--deck-on-primary)] shadow-sm hover:brightness-105",
	danger: "border border-[var(--deck-danger)] bg-transparent text-[var(--deck-danger)] hover:bg-[var(--deck-danger)] hover:text-white",
};

export const ControlButton = forwardRef<HTMLButtonElement, ControlButtonProps>(function ControlButton(
	{ tone = "ghost", icon = false, size = "md", className, onPointerUp, type = "button", ...rest },
	ref
) {
	return (
		<button
			ref={ref}
			type={type}
			className={cn(
				"inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-semibold transition",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--deck-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--deck-bg)]",
				"disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none",
				size === "lg" ? "min-h-12 px-6 text-lg" : "min-h-11 text-base",
				icon ? (size === "lg" ? "w-12 px-0" : "w-11 px-0") : size === "md" && "px-3.5",
				TONES[tone],
				className
			)}
			onPointerUp={(event: PointerEvent<HTMLButtonElement>) => {
				onPointerUp?.(event);
				if (event.pointerType === "mouse") event.currentTarget.blur();
			}}
			{...rest}
		/>
	);
});
