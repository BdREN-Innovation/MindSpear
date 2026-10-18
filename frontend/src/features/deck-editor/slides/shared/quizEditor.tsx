"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toDeckApiError } from "@/features/deck/api/errors";
import { DECK_LIMITS, type Slide, type SlideOption } from "@/features/deck/types";
import type { OptionsApi } from "../types";
import { CharCount } from "./fields";
import { useDebouncedValue } from "./hooks";
import { optionIsCorrect } from "./quizLabels";

// Inspector pieces the Quiz v2 editors share: the "correct answer" marker of
// the pick types (optimistic, one PATCH per changed option), a debounced
// option label input for editors that lay options out themselves (match
// pairs), and the inline notices. Scoring fields (points, speed bonus) live
// in the editor shell's Settings tab, not here.

/* ------------------------------------------------------------------ */
/* Correct-answer marking                                              */
/* ------------------------------------------------------------------ */

export interface CorrectMarking {
	isCorrect: (option: SlideOption) => boolean;
	/** single: makes this the one correct option (others are cleared); multi: flips it. */
	toggle: (option: SlideOption) => Promise<void>;
	busy: boolean;
	error: string | null;
	correctCount: number;
}

/**
 * Option `is_correct` editing through OptionsApi.update. The marks show at
 * once (pending map) and settle to server truth when the shell replaces the
 * slide; a failure rolls back and reports the message.
 */
export function useCorrectMarking(slide: Slide, api: OptionsApi, mode: "single" | "multi"): CorrectMarking {
	const [pending, setPending] = useState<Record<number, boolean>>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const busyRef = useRef(false);

	// Server truth includes the payload.is_correct fallback (QuizOptions::isCorrect).
	const isCorrect = useCallback((option: SlideOption) => pending[option.id] ?? optionIsCorrect(option), [pending]);

	const toggle = useCallback(
		async (option: SlideOption) => {
			if (busyRef.current) return;
			const changes: Record<number, boolean> = {};
			if (mode === "single") {
				if (isCorrect(option)) return;
				changes[option.id] = true;
				for (const other of slide.options) if (other.id !== option.id && isCorrect(other)) changes[other.id] = false;
			} else {
				changes[option.id] = !isCorrect(option);
			}

			busyRef.current = true;
			setBusy(true);
			setError(null);
			setPending((previous) => ({ ...previous, ...changes }));
			try {
				// Mark the new answer first, so a failure half-way never leaves no correct option.
				const ordered = Object.entries(changes).sort(([, a], [, b]) => Number(b) - Number(a));
				for (const [id, value] of ordered) await api.update(Number(id), { is_correct: value });
			} catch (reason) {
				const failure = toDeckApiError(reason);
				setError(failure.fieldError("is_correct") ?? failure.message);
			} finally {
				busyRef.current = false;
				setBusy(false);
				setPending({});
			}
		},
		[api, isCorrect, mode, slide.options]
	);

	const correctCount = slide.options.filter((option) => isCorrect(option)).length;
	return { isCorrect, toggle, busy, error, correctCount };
}

/** The radio / checkbox at the start of an option row that marks it correct. */
export function CorrectMarker({
	mode,
	checked,
	onToggle,
	label,
	disabled,
}: {
	mode: "single" | "multi";
	checked: boolean;
	onToggle: () => void;
	/** e.g. "Option 2" → "Mark option 2 as correct". */
	label: string;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			role={mode === "single" ? "radio" : "checkbox"}
			aria-checked={checked}
			aria-label={`${label} is ${mode === "single" ? "the" : "a"} correct answer`}
			title={checked ? "Correct answer" : "Mark as correct"}
			disabled={disabled}
			onClick={onToggle}
			className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
		>
			<span
				aria-hidden
				className={cn(
					"flex h-6 w-6 items-center justify-center border-2 transition-colors",
					mode === "single" ? "rounded-full" : "rounded-md",
					checked ? "border-green-dark bg-green-dark text-white" : "border-gray-5 bg-white text-transparent hover:border-green-dark dark:border-dark-4 dark:bg-dark-2"
				)}
			>
				<Check className="h-4 w-4" strokeWidth={3} />
			</span>
		</button>
	);
}

/* ------------------------------------------------------------------ */
/* Notices                                                             */
/* ------------------------------------------------------------------ */

/** Amber inline warning (e.g. "No correct answer marked yet"). Polite, not an error. */
export function EditorWarning({ children }: { children: ReactNode }) {
	return (
		<p
			role="status"
			className="m-0 flex items-start gap-2 rounded-lg bg-[#FEF3C7] px-3 py-2 text-xs font-medium text-[#92400E] dark:bg-[#78350F]/30 dark:text-[#FCD34D]"
		>
			<AlertTriangle className="mt-px h-4 w-4 shrink-0" aria-hidden />
			<span>{children}</span>
		</p>
	);
}

export function EditorError({ children }: { children: ReactNode }) {
	return (
		<p role="alert" className="m-0 text-xs font-medium text-[#B42318] dark:text-red-light">
			{children}
		</p>
	);
}

/* ------------------------------------------------------------------ */
/* Option label input (custom option layouts)                          */
/* ------------------------------------------------------------------ */

export interface OptionLabelInputProps {
	option: SlideOption;
	api: OptionsApi;
	/** Accessible name, e.g. "Pair 2, left item". */
	ariaLabel: string;
	placeholder?: string;
	maxLength?: number;
	disabled?: boolean;
	autoFocus?: boolean;
	onFocused?: () => void;
	debounceMs?: number;
	className?: string;
}

/** A debounced (flushed on blur / Enter) option label field with its own save error. */
export function OptionLabelInput({
	option,
	api,
	ariaLabel,
	placeholder,
	maxLength = DECK_LIMITS.maxOptionLabel,
	disabled,
	autoFocus,
	onFocused,
	debounceMs = 500,
	className,
}: OptionLabelInputProps) {
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const save = async (value: string) => {
		const label = value.trim() === "" ? null : value;
		if (label === (option.label ?? null)) return;
		try {
			await api.update(option.id, { label });
			setError(null);
		} catch (reason) {
			const failure = toDeckApiError(reason);
			setError(failure.fieldError("label") ?? failure.message);
		}
	};
	const { local, setLocal, flush } = useDebouncedValue(option.label ?? "", (value) => void save(value), debounceMs);

	useEffect(() => {
		if (!autoFocus) return;
		inputRef.current?.focus();
		onFocused?.();
	}, [autoFocus, onFocused]);

	const errorId = `option-${option.id}-label-error`;
	return (
		<div className={cn("flex min-w-0 flex-1 flex-col gap-1", className)}>
			<div className="relative">
				<input
					ref={inputRef}
					value={local}
					onChange={(event) => setLocal(event.target.value)}
					onBlur={flush}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							flush();
						}
					}}
					maxLength={maxLength}
					placeholder={placeholder}
					disabled={disabled}
					aria-label={ariaLabel}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? errorId : undefined}
					className={cn(
						"min-h-11 w-full rounded-lg border border-stroke bg-white py-2 pl-3 pr-14 text-sm text-dark outline-none transition placeholder:text-dark-6 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 dark:border-dark-3 dark:bg-dark-2 dark:text-white",
						error && "border-red"
					)}
				/>
				{local.length >= maxLength * 0.8 ? (
					<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
						<CharCount length={local.length} max={maxLength} />
					</span>
				) : null}
			</div>
			{error ? (
				<p id={errorId} role="alert" className="m-0 text-xs font-medium text-[#B42318] dark:text-red-light">
					{error}
				</p>
			) : null}
		</div>
	);
}

/** A compact native select for option rows (category of a categorise item, …). */
export function InlineSelect<T extends string>({
	label,
	value,
	options,
	onChange,
	disabled,
	placeholder = "Choose…",
}: {
	label: string;
	value: T | null;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
	disabled?: boolean;
	placeholder?: string;
}) {
	const known = value !== null && options.some((option) => option.value === value);
	return (
		<label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-dark-5 dark:text-dark-6">
			<span className="shrink-0">{label}</span>
			<select
				value={known ? (value as string) : ""}
				disabled={disabled}
				onChange={(event) => {
					const next = options.find((option) => option.value === event.target.value);
					if (next) onChange(next.value);
				}}
				className={cn(
					"min-h-11 min-w-0 flex-1 cursor-pointer rounded-lg border border-stroke bg-white px-2 text-sm text-dark outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-dark-3 dark:bg-dark-2 dark:text-white",
					!known && "border-[#F59E0B]"
				)}
			>
				{!known ? <option value="">{placeholder}</option> : null}
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
}

/** The first `${prefix}${n}` (n = 1, 2, …) not in `used` — new pair / category keys (QUIZ_LIMITS.authorKeyPattern). */
export function nextAuthorKey(prefix: string, used: Iterable<string>): string {
	const taken = new Set(used);
	for (let n = 1; ; n++) {
		const key = `${prefix}${n}`;
		if (!taken.has(key)) return key;
	}
}
