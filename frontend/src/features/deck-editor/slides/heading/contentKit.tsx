"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DeckTheme } from "@/features/deck/theme";
import { DECK_LIMITS, type SlidePatch, type SlideTypeKey } from "@/features/deck/types";
import { PresenterStage, TextField } from "../shared";

// Building blocks shared by the nine content slide folders (heading,
// paragraph, bullets, numbered, quote, image, video, bigText, qrCode). It
// lives in heading/ because the content types own only their own folders.
//
// Plan §6.3: "presenter layout = participant layout for content". Each type
// renders ONE view component with a `variant`:
//   - "stage": inside PresenterStage (cqw units, text shrinks to fit the 16:9 frame)
//   - "phone": inside ContentPhone (rem units, the page scrolls)
// Sizes are em steps on top of a per-variant base size, so a view never
// hard-codes pixels and both variants keep the same proportions.

export type ContentVariant = "stage" | "phone";

/** Base font size the em steps below multiply. Stage: 1280px-wide slide → 32px. */
const BASE_SIZE: Record<ContentVariant, string> = {
	stage: "clamp(12px, 2.5cqw, 72px)",
	phone: "1rem",
};

const STEPS = {
	/** big_text */
	display: { stage: 3.6, phone: 2.5 },
	/** heading slide title */
	hero: { stage: 2.5, phone: 2 },
	/** slide title above content */
	title: { stage: 1.6, phone: 1.5 },
	/** quote text */
	lead: { stage: 1.45, phone: 1.375 },
	subtitle: { stage: 1.1, phone: 1.125 },
	body: { stage: 1, phone: 1.0625 },
	small: { stage: 0.72, phone: 0.875 },
} as const;

export type ContentStep = keyof typeof STEPS;

/** `font-size` for a step, relative to the view's base size. */
export function contentSize(variant: ContentVariant, step: ContentStep): string {
	return `${STEPS[step][variant]}em`;
}

/* ------------------------------------------------------------------ */
/* Frames                                                              */
/* ------------------------------------------------------------------ */

/** Presenter frame for content slides: PresenterStage (cqw container) with the theme applied. */
export function ContentStage({
	theme,
	children,
	align = "center",
	className,
}: {
	theme: DeckTheme;
	children: ReactNode;
	align?: "center" | "stretch";
	className?: string;
}) {
	return (
		<PresenterStage
			align={align}
			className={className}
			// The presenter shell puts its timer chip (≈ 220×56 px) in the stage's
			// top-right corner: keep the top band clear of content.
			style={{ ...(theme.cssVars as CSSProperties), paddingTop: "max(4cqw, 72px)" }}
		>
			{children}
		</PresenterStage>
	);
}

/**
 * Participant frame for content slides (plan §7.3): read-only, a consistent
 * "Slide N" header, the deck theme, and the same view the big screen shows.
 */
export function ContentPhone({
	theme,
	position,
	totalSlides,
	children,
	className,
}: {
	theme: DeckTheme;
	position: number;
	/** Not in ParticipantProps yet; shown as "Slide x of y" when a shell passes it. */
	totalSlides?: number | null;
	children: ReactNode;
	className?: string;
}) {
	const progress = totalSlides ? `Slide ${position} of ${totalSlides}` : `Slide ${position}`;
	return (
		<section
			aria-label={progress}
			className={cn("flex min-h-full w-full flex-col gap-5 px-5 pb-8 pt-4", className)}
			style={{
				...(theme.cssVars as CSSProperties),
				background: "var(--deck-bg)",
				color: "var(--deck-text)",
				fontSize: BASE_SIZE.phone,
			}}
		>
			<p className="m-0 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--deck-text-muted)" }}>
				{progress}
			</p>
			{children}
		</section>
	);
}

/* ------------------------------------------------------------------ */
/* Fit-to-box text                                                     */
/* ------------------------------------------------------------------ */

const MIN_FIT = 0.4;

/**
 * Sets the view's base font size and, on the stage, shrinks it (down to 40%)
 * until the content fits the remaining slide height: long bullet lists or a
 * 5,000-character paragraph stay on screen instead of being clipped. On the
 * phone it only sets the base size; the page scrolls.
 *
 * The scale lives in a CSS variable set imperatively (not React state), so
 * measuring never re-renders and React never overwrites it.
 */
export function FitText({
	variant,
	children,
	className,
	contentClassName,
	/** Changes when the text changes (re-fit). */
	fitKey,
}: {
	variant: ContentVariant;
	children: ReactNode;
	className?: string;
	contentClassName?: string;
	fitKey?: string;
}) {
	const outerRef = useRef<HTMLDivElement>(null);
	const innerRef = useRef<HTMLDivElement>(null);
	const fit = variant === "stage";

	useLayoutEffect(() => {
		const outer = outerRef.current;
		const inner = innerRef.current;
		if (!fit || !outer || !inner) return;

		const fits = () => inner.scrollHeight <= outer.clientHeight + 1 && inner.scrollWidth <= outer.clientWidth + 1;
		const measure = () => {
			inner.style.setProperty("--content-fit", "1");
			if (fits()) return;
			// Binary search the largest scale that fits (7 steps ≈ 0.5% precision).
			let low = MIN_FIT;
			let high = 1;
			for (let step = 0; step < 7; step++) {
				const mid = (low + high) / 2;
				inner.style.setProperty("--content-fit", String(mid));
				if (fits()) low = mid;
				else high = mid;
			}
			inner.style.setProperty("--content-fit", String(low));
		};

		measure();
		let frame = 0;
		const observer = new ResizeObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		});
		observer.observe(outer);
		// Fonts arriving late change the text size too.
		void document.fonts?.ready.then(() => measure());
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	}, [fit, fitKey]);

	return (
		<div
			ref={outerRef}
			className={cn(
				"flex w-full flex-col",
				fit ? "min-h-0 flex-1 justify-center overflow-hidden" : "min-h-0",
				className
			)}
		>
			<div
				ref={innerRef}
				className={cn("w-full", contentClassName)}
				style={{ fontSize: fit ? `calc(${BASE_SIZE.stage} * var(--content-fit, 1))` : BASE_SIZE.phone }}
			>
				{children}
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Slide title above content (paragraph, lists, image, video, qr)      */
/* ------------------------------------------------------------------ */

/** The optional slide title of a content slide; nothing when empty. */
export function ContentTitle({
	title,
	variant,
	align = "center",
	className,
}: {
	title: string | null | undefined;
	variant: ContentVariant;
	align?: "left" | "center" | "right";
	className?: string;
}) {
	if (!title || title.trim() === "") return null;
	const Tag = variant === "stage" ? "h1" : "h2";
	return (
		<Tag
			className={cn("m-0 w-full font-bold leading-tight [overflow-wrap:anywhere]", className)}
			style={{ fontSize: contentSize(variant, "title"), textAlign: align }}
		>
			{title}
		</Tag>
	);
}

/** Dimmed text for an empty field in the editor preview. */
export function PreviewHint({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<span className={cn("italic", className)} style={{ color: "var(--deck-text-muted)" }}>
			{children}
		</span>
	);
}

/* ------------------------------------------------------------------ */
/* Editor helpers                                                      */
/* ------------------------------------------------------------------ */

/** A server field error for `key`, accepting bare (`items.2`) and prefixed (`config.items.2`) keys. */
export function fieldError(errors: Record<string, string[]> | undefined, key: string): string | null {
	if (!errors) return null;
	return errors[key]?.[0] ?? errors[`config.${key}`]?.[0] ?? null;
}

/** First server error whose key starts with `prefix` (e.g. any `config.items.N`). */
export function fieldErrorWithPrefix(errors: Record<string, string[]> | undefined, prefix: string): string | null {
	if (!errors) return null;
	for (const [key, messages] of Object.entries(errors)) {
		const bare = key.startsWith("config.") ? key.slice("config.".length) : key;
		if ((bare === prefix || bare.startsWith(`${prefix}.`)) && messages[0]) return messages[0];
	}
	return null;
}

/** The slide `title` field (≤ 280) every content Editor uses. */
export function SlideTitleField<K extends SlideTypeKey>({
	title,
	onChange,
	errors,
	disabled,
	label = "Title",
	hint,
	placeholder,
	autoFocus,
}: {
	title: string | null;
	onChange(patch: SlidePatch<K>): void;
	errors?: Record<string, string[]>;
	disabled?: boolean;
	label?: string;
	hint?: string;
	placeholder?: string;
	autoFocus?: boolean;
}) {
	return (
		<TextField
			label={label}
			hint={hint}
			value={title ?? ""}
			onChange={(value) => onChange({ title: value.trim() === "" ? null : value })}
			debounceMs={400}
			maxLength={DECK_LIMITS.maxSlideTitle}
			showCount
			placeholder={placeholder}
			autoFocus={autoFocus}
			error={errors?.title}
			disabled={disabled}
		/>
	);
}
