"use client";

import type { CSSProperties, ReactNode } from "react";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";

// Presenter building blocks. They render on the deck canvas, so colours come
// from the --deck-* variables a DeckThemeProvider sets. Sizes use container
// query units (cqw) so a Presenter looks the same full screen and scaled
// down in the editor canvas: wrap the slide in <PresenterStage> (it sets
// `container-type: inline-size`); outside a container cqw falls back to the
// viewport.

/** Full-size slide frame: themed background/text, padding, and the size container for cqw units. */
export function PresenterStage({
	children,
	className,
	style,
	align = "stretch",
}: {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
	/** Content alignment: stretch (charts) or center (content slides). */
	align?: "stretch" | "center";
}) {
	return (
		<div
			className={cn(
				"flex h-full w-full flex-col gap-[2.5cqw] overflow-hidden p-[4cqw]",
				align === "center" ? "items-center justify-center text-center" : "items-stretch",
				className
			)}
			style={{
				containerType: "inline-size",
				background: "var(--deck-bg)",
				color: "var(--deck-text)",
				...style,
			}}
		>
			{children}
		</div>
	);
}

const TITLE_SIZES = {
	md: "clamp(1.25rem, 3.2cqw, 2.5rem)",
	lg: "clamp(1.5rem, 4.4cqw, 3.5rem)",
	xl: "clamp(2rem, 7cqw, 6rem)",
} as const;

export interface SlideTitleProps {
	title: string | null | undefined;
	/** Shown dimmed when the title is empty (editor preview). */
	fallback?: string;
	size?: keyof typeof TITLE_SIZES;
	align?: "left" | "center";
	/** Heading level (default h1: one per slide). */
	as?: "h1" | "h2";
	className?: string;
}

/** The big responsive slide heading. */
export function SlideTitle({ title, fallback = "Untitled slide", size = "lg", align = "left", as: Tag = "h1", className }: SlideTitleProps) {
	const empty = !title || title.trim() === "";
	return (
		<Tag
			className={cn("m-0 font-bold leading-tight [overflow-wrap:anywhere]", align === "center" ? "text-center" : "text-left", className)}
			style={{ fontSize: TITLE_SIZES[size], color: empty ? "var(--deck-text-muted)" : "var(--deck-text)" }}
		>
			{empty ? fallback : title}
		</Tag>
	);
}

/** "Waiting for responses…" placeholder for an empty chart (polite live region). */
export function ResultsEmpty({
	message = "Waiting for responses…",
	icon,
	className,
}: {
	message?: string;
	icon?: ReactNode;
	className?: string;
}) {
	return (
		<div
			role="status"
			className={cn("flex min-h-0 flex-1 flex-col items-center justify-center gap-[1.5cqw] text-center", className)}
			style={{ color: "var(--deck-text-muted)" }}
		>
			{icon ?? (
				<span className="flex gap-[0.8cqw]" aria-hidden>
					{[0, 1, 2].map((dot) => (
						<span
							key={dot}
							className="h-[1.2cqw] min-h-2 w-[1.2cqw] min-w-2 rounded-full motion-safe:animate-pulse"
							style={{ background: "var(--deck-primary)", animationDelay: `${dot * 200}ms` }}
						/>
					))}
				</span>
			)}
			<p className="m-0 font-medium" style={{ fontSize: "clamp(1rem, 2.2cqw, 1.75rem)" }}>
				{message}
			</p>
		</div>
	);
}

export interface ResponseCountProps {
	count: number | null | undefined;
	/** [singular, plural] (default response / responses). */
	noun?: [string, string];
	className?: string;
}

/** "12 responses" with a people icon; announced politely as it changes. */
export function ResponseCount({ count, noun = ["response", "responses"], className }: ResponseCountProps) {
	const value = count ?? 0;
	return (
		<p
			aria-live="polite"
			aria-atomic="true"
			className={cn("m-0 inline-flex items-center gap-[0.6cqw] font-semibold tabular-nums", className)}
			style={{ color: "var(--deck-text-muted)", fontSize: "clamp(0.875rem, 1.6cqw, 1.25rem)" }}
		>
			<Users className="h-[1.2em] w-[1.2em]" aria-hidden />
			{value} {value === 1 ? noun[0] : noun[1]}
		</p>
	);
}
