/* eslint-disable @next/next/no-img-element -- option images are My Files URLs on arbitrary hosts. */
"use client";

import type { ReactNode } from "react";
import { Check, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "./hooks";

// Participant (phone) building blocks, themed by the --deck-* variables of the
// nearest DeckThemeProvider (fallbacks keep them readable without one).
// Tap targets are ≥ 48 px, focus rings use --deck-focus, presses scale only
// when motion is allowed, and haptics go through haptic() (off with
// prefers-reduced-motion and where unsupported).

const FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] focus-visible:ring-offset-[color:var(--deck-bg,#fff)]";

/* ------------------------------------------------------------------ */
/* SubmitBar                                                           */
/* ------------------------------------------------------------------ */

export interface SubmitBarProps {
	label: string;
	onClick?: () => void;
	/** "submit" when the bar sits inside a <form>. */
	type?: "button" | "submit";
	/** Associates a submit button with a form by id when it sits outside it. */
	form?: string;
	loading?: boolean;
	disabled?: boolean;
	/** Line above the button, e.g. "42 / 100 points used" or a validation hint. Announced politely. */
	hint?: ReactNode;
	/** Error line (role="alert"), e.g. useSubmit().errorMessage. */
	error?: string | null;
	className?: string;
}

/** Sticky bottom action bar, safe-area aware, with one 48 px primary button. */
export function SubmitBar({ label, onClick, type = "button", form, loading = false, disabled = false, hint, error, className }: SubmitBarProps) {
	return (
		<div
			className={cn("sticky bottom-0 z-10 flex flex-col gap-2 px-4 pt-3", className)}
			style={{
				paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)",
				background: "var(--deck-bg, #fff)",
				borderTop: "1px solid var(--deck-border, #E5E7EB)",
			}}
		>
			{hint ? (
				<p aria-live="polite" className="m-0 text-center text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					{hint}
				</p>
			) : null}
			{error ? (
				<p role="alert" className="m-0 text-center text-sm font-medium" style={{ color: "var(--deck-danger, #B91C1C)" }}>
					{error}
				</p>
			) : null}
			<button
				type={type}
				form={form}
				onClick={onClick}
				disabled={disabled || loading}
				aria-busy={loading || undefined}
				className={cn(
					"flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition motion-safe:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
					FOCUS_RING
				)}
				style={{ background: "var(--deck-primary, #F79945)", color: "var(--deck-on-primary, #111928)" }}
			>
				{loading ? (
					<span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden />
				) : null}
				{loading ? "Sending…" : label}
			</button>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* OptionCard                                                          */
/* ------------------------------------------------------------------ */

export interface OptionCardGroupProps {
	/** Accessible name, usually the question. */
	label: string;
	/** single → radiogroup, multi → group of checkboxes. */
	mode?: "single" | "multi";
	children: ReactNode;
	className?: string;
}

/** Wraps OptionCards with the right group role. */
export function OptionCardGroup({ label, mode = "single", children, className }: OptionCardGroupProps) {
	return (
		<div role={mode === "single" ? "radiogroup" : "group"} aria-label={label} className={cn("flex flex-col gap-3", className)}>
			{children}
		</div>
	);
}

export interface OptionCardProps {
	label: string | null;
	imageUrl?: string | null;
	selected: boolean;
	onSelect: () => void;
	disabled?: boolean;
	/** single → role radio, multi → role checkbox. */
	mode?: "single" | "multi";
	/** 0-based; shows a letter badge (A, B, C…). Omit for none. */
	index?: number;
	/** Extra line under the label. */
	description?: ReactNode;
	/** Vibrate on tap (default true; haptic() still respects reduced motion). */
	hapticFeedback?: boolean;
	className?: string;
}

/** Full-width tappable answer card with optional image, letter badge and selected state. */
export function OptionCard({
	label,
	imageUrl,
	selected,
	onSelect,
	disabled = false,
	mode = "single",
	index,
	description,
	hapticFeedback = true,
	className,
}: OptionCardProps) {
	const letter = index !== undefined && index < 26 ? String.fromCharCode(65 + index) : index !== undefined ? String(index + 1) : null;
	return (
		<button
			type="button"
			role={mode === "single" ? "radio" : "checkbox"}
			aria-checked={selected}
			disabled={disabled}
			onClick={() => {
				if (hapticFeedback) haptic(10);
				onSelect();
			}}
			className={cn(
				"flex min-h-14 w-full touch-manipulation select-none items-center gap-3 rounded-xl border-2 p-3 text-left transition motion-safe:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
				FOCUS_RING,
				className
			)}
			style={{
				borderColor: selected ? "var(--deck-primary, #F79945)" : "var(--deck-border, #E5E7EB)",
				background: selected
					? "color-mix(in srgb, var(--deck-primary, #F79945) 14%, var(--deck-surface, #fff))"
					: "var(--deck-surface, #fff)",
				color: "var(--deck-text, #111928)",
				WebkitTouchCallout: "none",
			}}
		>
			{letter ? (
				<span
					aria-hidden
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
					style={{
						background: selected ? "var(--deck-primary, #F79945)" : "var(--deck-surface-muted, #F3F4F6)",
						color: selected ? "var(--deck-on-primary, #111928)" : "var(--deck-text-muted, #4B5563)",
					}}
				>
					{letter}
				</span>
			) : null}
			{imageUrl ? (
				<img src={imageUrl} alt="" draggable={false} className="h-16 w-16 shrink-0 rounded-lg object-cover" />
			) : null}
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="break-words text-base font-semibold leading-snug">{label || "—"}</span>
				{description ? (
					<span className="text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
						{description}
					</span>
				) : null}
			</span>
			<span
				aria-hidden
				className={cn("flex h-6 w-6 shrink-0 items-center justify-center border-2", mode === "single" ? "rounded-full" : "rounded-md")}
				style={{
					borderColor: selected ? "var(--deck-primary, #F79945)" : "var(--deck-border, #D1D5DB)",
					background: selected ? "var(--deck-primary, #F79945)" : "transparent",
					color: "var(--deck-on-primary, #111928)",
				}}
			>
				{selected ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
			</span>
		</button>
	);
}

/* ------------------------------------------------------------------ */
/* SubmittedState                                                      */
/* ------------------------------------------------------------------ */

export interface SubmittedStateProps {
	title?: string;
	message?: ReactNode;
	/** E.g. "You can change your answer until voting closes." */
	editHint?: ReactNode;
	/** Shows a "Change answer" button (types that allow replacing the answer). */
	onEdit?: () => void;
	editLabel?: string;
	/** A summary of what was sent (chosen option, words, ...). */
	children?: ReactNode;
	className?: string;
}

/** ✓ "Thanks, your answer is in" screen shown after a submit and after a reload with has_answered. */
export function SubmittedState({
	title = "Thanks, your answer is in",
	message = "Waiting for the host to continue.",
	editHint,
	onEdit,
	editLabel = "Change answer",
	children,
	className,
}: SubmittedStateProps) {
	return (
		<div
			role="status"
			aria-live="polite"
			className={cn("flex flex-col items-center gap-4 px-6 py-10 text-center", className)}
			style={{ color: "var(--deck-text, #111928)" }}
		>
			<CheckCircle2
				className="h-16 w-16 motion-safe:animate-[deck-pop_300ms_ease-out]"
				style={{ color: "var(--deck-success, #15803D)" }}
				aria-hidden
			/>
			<h2 className="m-0 text-2xl font-bold">{title}</h2>
			{message ? (
				<p className="m-0 text-base" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					{message}
				</p>
			) : null}
			{children ? <div className="w-full max-w-md">{children}</div> : null}
			{editHint ? (
				<p className="m-0 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
					{editHint}
				</p>
			) : null}
			{onEdit ? (
				<button
					type="button"
					onClick={onEdit}
					className={cn("min-h-12 touch-manipulation rounded-xl border-2 px-5 text-base font-semibold", FOCUS_RING)}
					style={{ borderColor: "var(--deck-border, #E5E7EB)", color: "var(--deck-text, #111928)", background: "var(--deck-surface, #fff)" }}
				>
					{editLabel}
				</button>
			) : null}
			<style>{`@keyframes deck-pop { 0% { transform: scale(0.6); opacity: 0 } 70% { transform: scale(1.08) } 100% { transform: scale(1); opacity: 1 } }`}</style>
		</div>
	);
}
