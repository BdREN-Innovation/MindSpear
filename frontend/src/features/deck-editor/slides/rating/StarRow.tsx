"use client";

import { useRef, type KeyboardEvent } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "../shared";

// Stars for the rating type: a read-only row with fractional fill (presenter
// averages, summaries) and an input radiogroup (participant) with roving
// focus and arrow keys.

/** Read-only stars filled up to `value` (fractions allowed). Sized by `size` (any CSS length). */
export function StarMeter({ value, scale, size, className }: { value: number | null; scale: number; size: string; className?: string }) {
	const filled = value ?? 0;
	return (
		<span className={cn("inline-flex shrink-0 items-center", className)} style={{ gap: `calc(${size} * 0.12)` }} aria-hidden>
			{Array.from({ length: scale }, (_, index) => {
				const fill = Math.max(0, Math.min(1, filled - index));
				return (
					<span key={index} className="relative inline-block shrink-0" style={{ width: size, height: size }}>
						<Star className="absolute inset-0 h-full w-full" style={{ color: "var(--deck-border, #D1D5DB)" }} fill="currentColor" strokeWidth={0} />
						<span
							className="absolute inset-y-0 left-0 overflow-hidden transition-[width] duration-500 ease-out motion-reduce:transition-none"
							style={{ width: `${fill * 100}%` }}
						>
							<Star style={{ width: size, height: size, color: "var(--deck-primary, #F79945)" }} fill="currentColor" strokeWidth={0} />
						</span>
					</span>
				);
			})}
		</span>
	);
}

const FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] focus-visible:ring-offset-[color:var(--deck-bg,#fff)]";

export interface StarInputProps {
	/** Accessible name, e.g. the item label. */
	label: string;
	value: number | null;
	scale: number;
	onChange: (value: number) => void;
	disabled?: boolean;
}

/** Tap a star to rate 1..scale. ≥ 44 px targets; 10-star scales wrap to two rows of five. */
export function StarInput({ label, value, scale, onChange, disabled = false }: StarInputProps) {
	const refs = useRef<(HTMLButtonElement | null)[]>([]);
	const tabStop = value ? value - 1 : 0;

	const select = (next: number) => {
		onChange(next);
		haptic(10);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
		let next: number | null = null;
		if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(scale - 1, index + 1);
		else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(0, index - 1);
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = scale - 1;
		if (next === null) return;
		event.preventDefault();
		select(next + 1);
		refs.current[next]?.focus();
	};

	return (
		<div
			role="radiogroup"
			aria-label={label}
			className={cn("mx-auto grid w-fit gap-1", scale > 7 ? "grid-cols-5" : "")}
			style={scale > 7 ? undefined : { gridTemplateColumns: `repeat(${scale}, minmax(0, 1fr))` }}
		>
			{Array.from({ length: scale }, (_, index) => {
				const starValue = index + 1;
				const on = value !== null && starValue <= value;
				return (
					<button
						key={starValue}
						ref={(node) => {
							refs.current[index] = node;
						}}
						type="button"
						role="radio"
						aria-checked={value === starValue}
						aria-label={`${starValue} of ${scale} ${scale === 1 ? "star" : "stars"}`}
						tabIndex={index === tabStop ? 0 : -1}
						disabled={disabled}
						onClick={() => select(starValue)}
						onKeyDown={(event) => onKeyDown(event, index)}
						className={cn(
							"flex h-12 w-12 touch-manipulation items-center justify-center rounded-lg transition motion-safe:active:scale-90 disabled:cursor-not-allowed disabled:opacity-60",
							FOCUS_RING
						)}
					>
						<Star
							className="h-9 w-9 transition-colors"
							style={{ color: on ? "var(--deck-primary, #F79945)" : "var(--deck-border, #D1D5DB)" }}
							fill="currentColor"
							strokeWidth={on ? 0 : 1}
							aria-hidden
						/>
					</button>
				);
			})}
		</div>
	);
}
