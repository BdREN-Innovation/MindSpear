"use client";

import { useId, useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "./hooks";

// Inspector form primitives for slide Editors. They render in the app UI (not
// on the deck canvas), so they use the app's Tailwind tokens with dark mode.
// Every field: visible label (or sr-only with hideLabel), hint, error text
// wired through aria-describedby / aria-invalid, 44px min height, focus ring,
// and an optional debounce (debounceMs) that commits on blur / Enter.

export interface FieldBaseProps {
	label: string;
	/** Visually hide the label (still read by screen readers). */
	hideLabel?: boolean;
	hint?: ReactNode;
	/** Server field error(s), e.g. editor `errors["config.max_selections"]`. */
	error?: string | string[] | null;
	disabled?: boolean;
	className?: string;
	id?: string;
}

const inputClass =
	"w-full min-h-11 rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition placeholder:text-dark-6 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-dark-3 dark:bg-dark-2 dark:text-white";

const invalidClass = "border-red focus-visible:border-red focus-visible:ring-red/30";

function firstError(error: FieldBaseProps["error"]): string | null {
	if (!error) return null;
	return Array.isArray(error) ? (error[0] ?? null) : error;
}

/** Label + control + hint + error. Use it to wrap custom controls so they match the primitives. */
export function FieldShell({
	label,
	hideLabel,
	hint,
	error,
	className,
	htmlFor,
	labelId,
	trailing,
	children,
	describedBy,
}: Omit<FieldBaseProps, "disabled" | "id"> & {
	htmlFor?: string;
	labelId?: string;
	/** Rendered at the end of the label row (e.g. a counter). */
	trailing?: ReactNode;
	describedBy: { hint: string; error: string };
	children: ReactNode;
}) {
	const message = firstError(error);
	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<div className={cn("flex items-baseline justify-between gap-2", hideLabel && !trailing && "sr-only")}>
				<label
					htmlFor={htmlFor}
					id={labelId}
					className={cn("text-sm font-medium text-dark dark:text-white", hideLabel && "sr-only")}
				>
					{label}
				</label>
				{trailing}
			</div>
			{children}
			{hint ? (
				<p id={describedBy.hint} className="text-xs text-dark-5 dark:text-dark-6">
					{hint}
				</p>
			) : null}
			{message ? (
				<p id={describedBy.error} role="alert" className="text-xs font-medium text-[#B42318] dark:text-red-light">
					{message}
				</p>
			) : null}
		</div>
	);
}

function useFieldIds(id?: string) {
	const generated = useId();
	const base = id ?? `field-${generated}`;
	return { input: base, hint: `${base}-hint`, error: `${base}-error`, label: `${base}-label` };
}

function describedByFor(ids: { hint: string; error: string }, hint: ReactNode, error: FieldBaseProps["error"]) {
	return [hint ? ids.hint : null, firstError(error) ? ids.error : null].filter(Boolean).join(" ") || undefined;
}

/* ------------------------------------------------------------------ */

export interface TextFieldProps extends FieldBaseProps {
	value: string;
	/** Called with every change, or debounced when debounceMs is set (flushed on blur / Enter). */
	onChange: (value: string) => void;
	debounceMs?: number;
	placeholder?: string;
	maxLength?: number;
	/** Show "12 / 80" next to the label (needs maxLength). */
	showCount?: boolean;
	type?: "text" | "url" | "search";
	autoFocus?: boolean;
	inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "id">;
}

export function TextField({
	label,
	hideLabel,
	hint,
	error,
	disabled,
	className,
	id,
	value,
	onChange,
	debounceMs,
	placeholder,
	maxLength,
	showCount,
	type = "text",
	autoFocus,
	inputProps,
}: TextFieldProps) {
	const ids = useFieldIds(id);
	const { local, setLocal, flush } = useDebouncedValue(value, onChange, debounceMs);
	return (
		<FieldShell
			label={label}
			hideLabel={hideLabel}
			hint={hint}
			error={error}
			className={className}
			htmlFor={ids.input}
			describedBy={ids}
			trailing={showCount && maxLength ? <CharCount length={local.length} max={maxLength} /> : null}
		>
			<input
				{...inputProps}
				id={ids.input}
				type={type}
				value={local}
				placeholder={placeholder}
				maxLength={maxLength}
				disabled={disabled}
				autoFocus={autoFocus}
				aria-invalid={firstError(error) ? true : undefined}
				aria-describedby={describedByFor(ids, hint, error)}
				onChange={(event) => setLocal(event.target.value)}
				onBlur={(event) => {
					flush();
					inputProps?.onBlur?.(event);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") flush();
					inputProps?.onKeyDown?.(event);
				}}
				className={cn(inputClass, firstError(error) && invalidClass, inputProps?.className)}
			/>
		</FieldShell>
	);
}

/** "12 / 280", turning red near and at the limit. */
export function CharCount({ length, max, className }: { length: number; max: number; className?: string }) {
	const near = length >= max * 0.9;
	return (
		<span
			className={cn("text-xs tabular-nums", near ? "font-medium text-[#B42318] dark:text-red-light" : "text-dark-5 dark:text-dark-6", className)}
			aria-label={`${length} of ${max} characters`}
		>
			{length} / {max}
		</span>
	);
}

/* ------------------------------------------------------------------ */

export interface TextAreaFieldProps extends FieldBaseProps {
	value: string;
	onChange: (value: string) => void;
	debounceMs?: number;
	placeholder?: string;
	maxLength?: number;
	/** Character counter (default on when maxLength is set). */
	showCount?: boolean;
	rows?: number;
}

export function TextAreaField({
	label,
	hideLabel,
	hint,
	error,
	disabled,
	className,
	id,
	value,
	onChange,
	debounceMs,
	placeholder,
	maxLength,
	showCount = maxLength !== undefined,
	rows = 3,
}: TextAreaFieldProps) {
	const ids = useFieldIds(id);
	const { local, setLocal, flush } = useDebouncedValue(value, onChange, debounceMs);
	return (
		<FieldShell
			label={label}
			hideLabel={hideLabel}
			hint={hint}
			error={error}
			className={className}
			htmlFor={ids.input}
			describedBy={ids}
			trailing={showCount && maxLength ? <CharCount length={local.length} max={maxLength} /> : null}
		>
			<textarea
				id={ids.input}
				value={local}
				rows={rows}
				placeholder={placeholder}
				maxLength={maxLength}
				disabled={disabled}
				aria-invalid={firstError(error) ? true : undefined}
				aria-describedby={describedByFor(ids, hint, error)}
				onChange={(event) => setLocal(event.target.value)}
				onBlur={flush}
				className={cn(inputClass, "resize-y leading-relaxed", firstError(error) && invalidClass)}
			/>
		</FieldShell>
	);
}

/* ------------------------------------------------------------------ */

export interface NumberFieldProps extends FieldBaseProps {
	value: number | null;
	onChange: (value: number | null) => void;
	debounceMs?: number;
	min?: number;
	max?: number;
	step?: number;
	/** Allow clearing the field (commits null). Otherwise an empty field goes back to the last value. */
	allowEmpty?: boolean;
	placeholder?: string;
	/** Text after the input, e.g. "seconds". */
	suffix?: string;
}

export function NumberField({
	label,
	hideLabel,
	hint,
	error,
	disabled,
	className,
	id,
	value,
	onChange,
	debounceMs,
	min,
	max,
	step = 1,
	allowEmpty = false,
	placeholder,
	suffix,
}: NumberFieldProps) {
	const ids = useFieldIds(id);
	const lastValid = useRef(value);
	lastValid.current = value;

	// Keep the raw text while typing ("-", "1.") and commit only parseable values.
	const normalise = (text: string): number | null | undefined => {
		if (text.trim() === "") return allowEmpty ? null : undefined;
		const parsed = Number(text);
		if (!Number.isFinite(parsed)) return undefined;
		const clamped = Math.min(max ?? parsed, Math.max(min ?? parsed, parsed));
		return step % 1 === 0 ? Math.round(clamped) : clamped;
	};
	const commitText = (text: string) => {
		const next = normalise(text);
		if (next !== undefined && next !== lastValid.current) onChange(next);
	};
	const { local, setLocal, flush, replace } = useDebouncedValue(value === null ? "" : String(value), commitText, debounceMs);

	return (
		<FieldShell
			label={label}
			hideLabel={hideLabel}
			hint={hint}
			error={error}
			className={className}
			htmlFor={ids.input}
			describedBy={ids}
		>
			<div className="flex items-center gap-2">
				<input
					id={ids.input}
					type="number"
					inputMode={step % 1 === 0 ? "numeric" : "decimal"}
					value={local}
					min={min}
					max={max}
					step={step}
					placeholder={placeholder}
					disabled={disabled}
					aria-invalid={firstError(error) ? true : undefined}
					aria-describedby={describedByFor(ids, hint, error)}
					onChange={(event) => setLocal(event.target.value)}
					onBlur={() => {
						flush();
						// Show what was committed (clamped, or the last value when emptied).
						const next = normalise(local);
						const shown = next === undefined ? lastValid.current : next;
						replace(shown === null ? "" : String(shown));
					}}
					onKeyDown={(event) => event.key === "Enter" && flush()}
					className={cn(inputClass, "max-w-32 tabular-nums", firstError(error) && invalidClass)}
				/>
				{suffix ? <span className="text-sm text-dark-5 dark:text-dark-6">{suffix}</span> : null}
			</div>
		</FieldShell>
	);
}

/* ------------------------------------------------------------------ */

export interface ChoiceOption<T extends string | number> {
	value: T;
	label: string;
	disabled?: boolean;
	icon?: LucideIcon;
}

export interface SelectFieldProps<T extends string | number> extends FieldBaseProps {
	value: T;
	options: ChoiceOption<T>[];
	onChange: (value: T) => void;
}

export function SelectField<T extends string | number>({
	label,
	hideLabel,
	hint,
	error,
	disabled,
	className,
	id,
	value,
	options,
	onChange,
}: SelectFieldProps<T>) {
	const ids = useFieldIds(id);
	const index = options.findIndex((option) => option.value === value);
	return (
		<FieldShell
			label={label}
			hideLabel={hideLabel}
			hint={hint}
			error={error}
			className={className}
			htmlFor={ids.input}
			describedBy={ids}
		>
			<select
				id={ids.input}
				value={index < 0 ? "" : String(index)}
				disabled={disabled}
				aria-invalid={firstError(error) ? true : undefined}
				aria-describedby={describedByFor(ids, hint, error)}
				onChange={(event) => {
					const option = options[Number(event.target.value)];
					if (option) onChange(option.value);
				}}
				className={cn(inputClass, "cursor-pointer pr-8", firstError(error) && invalidClass)}
			>
				{index < 0 ? <option value="">Choose…</option> : null}
				{options.map((option, i) => (
					<option key={String(option.value)} value={String(i)} disabled={option.disabled}>
						{option.label}
					</option>
				))}
			</select>
		</FieldShell>
	);
}

/* ------------------------------------------------------------------ */

export interface ToggleFieldProps extends Omit<FieldBaseProps, "hideLabel"> {
	checked: boolean;
	onChange: (checked: boolean) => void;
	/** Second line under the label. */
	description?: ReactNode;
}

/** A labelled switch (role="switch"), the whole row is the hit target. */
export function ToggleField({ label, hint, description, error, disabled, className, id, checked, onChange }: ToggleFieldProps) {
	const ids = useFieldIds(id);
	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<button
				type="button"
				role="switch"
				id={ids.input}
				aria-checked={checked}
				aria-labelledby={ids.label}
				aria-describedby={describedByFor(ids, hint ?? description, error)}
				disabled={disabled}
				onClick={() => onChange(!checked)}
				className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
			>
				<span className="flex flex-col">
					<span id={ids.label} className="text-sm font-medium text-dark dark:text-white">
						{label}
					</span>
					{description ? <span className="text-xs text-dark-5 dark:text-dark-6">{description}</span> : null}
				</span>
				<span
					aria-hidden
					className={cn(
						"relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
						checked ? "bg-primary" : "bg-gray-4 dark:bg-dark-4"
					)}
				>
					<span
						className={cn(
							"inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none",
							checked ? "translate-x-[22px]" : "translate-x-0.5"
						)}
					/>
				</span>
			</button>
			{hint ? (
				<p id={ids.hint} className="text-xs text-dark-5 dark:text-dark-6">
					{hint}
				</p>
			) : null}
			{firstError(error) ? (
				<p id={ids.error} role="alert" className="text-xs font-medium text-[#B42318] dark:text-red-light">
					{firstError(error)}
				</p>
			) : null}
		</div>
	);
}

/* ------------------------------------------------------------------ */

export interface SegmentedFieldProps<T extends string | number> extends FieldBaseProps {
	value: T;
	options: ChoiceOption<T>[];
	onChange: (value: T) => void;
}

/** A radio group drawn as segmented buttons; arrow keys move the selection. */
export function SegmentedField<T extends string | number>({
	label,
	hideLabel,
	hint,
	error,
	disabled,
	className,
	id,
	value,
	options,
	onChange,
}: SegmentedFieldProps<T>) {
	const ids = useFieldIds(id);
	const refs = useRef<(HTMLButtonElement | null)[]>([]);
	const selectedIndex = options.findIndex((option) => option.value === value);
	const tabStop = selectedIndex >= 0 ? selectedIndex : Math.max(0, options.findIndex((option) => !option.disabled));

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
		const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
		if (!delta) return;
		event.preventDefault();
		for (let step = 1; step <= options.length; step++) {
			const next = (index + delta * step + options.length) % options.length;
			if (!options[next].disabled) {
				onChange(options[next].value);
				refs.current[next]?.focus();
				return;
			}
		}
	};

	return (
		<FieldShell label={label} hideLabel={hideLabel} hint={hint} error={error} className={className} labelId={ids.label} describedBy={ids}>
			<div
				role="radiogroup"
				aria-labelledby={ids.label}
				aria-describedby={describedByFor(ids, hint, error)}
				className="flex w-full flex-wrap gap-1 rounded-lg bg-gray-2 p-1 dark:bg-dark-2"
			>
				{options.map((option, index) => {
					const selected = option.value === value;
					const Icon = option.icon;
					return (
						<button
							key={String(option.value)}
							ref={(node) => {
								refs.current[index] = node;
							}}
							type="button"
							role="radio"
							aria-checked={selected}
							tabIndex={index === tabStop ? 0 : -1}
							disabled={disabled || option.disabled}
							onClick={() => onChange(option.value)}
							onKeyDown={(event) => onKeyDown(event, index)}
							className={cn(
								"flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50",
								selected ? "bg-white text-dark shadow-sm dark:bg-dark-3 dark:text-white" : "text-dark-5 hover:text-dark dark:text-dark-6 dark:hover:text-white"
							)}
						>
							{Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
							{option.label}
						</button>
					);
				})}
			</div>
		</FieldShell>
	);
}
