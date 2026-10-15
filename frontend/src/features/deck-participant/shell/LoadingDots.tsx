"use client";

import { cn } from "@/lib/utils";
import { ShellStyles } from "./shellStyles";

// Three-dot native-style loader (plan §4.2). Inherits the text colour.
// Static (no pulse) under prefers-reduced-motion.

export interface LoadingDotsProps {
	/** Accessible name; pass null when a surrounding element already says what is loading. */
	label?: string | null;
	size?: "sm" | "md" | "lg";
	className?: string;
}

const DOT = { sm: "h-1.5 w-1.5", md: "h-2 w-2", lg: "h-3 w-3" } as const;
const GAP = { sm: "gap-1", md: "gap-1.5", lg: "gap-2" } as const;

export function LoadingDots({ label = "Loading", size = "md", className }: LoadingDotsProps) {
	return (
		<span
			role={label ? "status" : undefined}
			aria-label={label ?? undefined}
			aria-hidden={label ? undefined : true}
			className={cn("inline-flex items-center", GAP[size], className)}
		>
			<ShellStyles />
			{[0, 1, 2].map((index) => (
				<span
					key={index}
					className={cn("ms-play-dot rounded-full bg-current", DOT[size])}
					style={{ animationDelay: `${index * 160}ms` }}
				/>
			))}
		</span>
	);
}
