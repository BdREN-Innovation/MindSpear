"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { JOIN_CODE_LENGTH, sanitizeJoinCode } from "../lib/joinCode";

// Six slot boxes over one real <input>: the keyboard, paste, autofill and
// screen readers all deal with a single plain text field, while the boxes
// show progress. Upper-cases as you type and drops characters the
// alphabet never uses (reported through onChange's `rejected`).

export interface CodeInputProps {
	value: string;
	onChange: (code: string, rejected: string[]) => void;
	disabled?: boolean;
	invalid?: boolean;
	/** id(s) of the hint / error text. */
	describedBy?: string;
	autoFocus?: boolean;
	id?: string;
}

export const CodeInput = forwardRef<HTMLInputElement, CodeInputProps>(function CodeInput(
	{ value, onChange, disabled, invalid, describedBy, autoFocus, id },
	ref
) {
	const inputRef = useRef<HTMLInputElement>(null);
	useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);
	const [focused, setFocused] = useState(false);
	const activeIndex = Math.min(value.length, JOIN_CODE_LENGTH - 1);

	return (
		<div className="relative mx-auto w-full max-w-[22rem]">
			<input
				ref={inputRef}
				id={id}
				value={value}
				onChange={(event) => {
					const { code, rejected } = sanitizeJoinCode(event.target.value);
					onChange(code, rejected);
				}}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				disabled={disabled}
				autoFocus={autoFocus}
				aria-label="Session code"
				aria-invalid={invalid || undefined}
				aria-describedby={describedBy}
				autoComplete="off"
				autoCorrect="off"
				autoCapitalize="characters"
				spellCheck={false}
				inputMode="text"
				enterKeyHint="go"
				className="absolute inset-0 z-10 h-full w-full cursor-text appearance-none bg-transparent text-transparent caret-transparent opacity-0 outline-none selection:bg-transparent"
			/>
			<div
				aria-hidden
				className={cn(
					"grid grid-cols-6 gap-2 rounded-2xl p-1",
					focused && "ring-[3px] ring-[var(--deck-focus)] ring-offset-2 ring-offset-[var(--deck-bg)]"
				)}
			>
				{Array.from({ length: JOIN_CODE_LENGTH }, (_, index) => {
					const char = value[index] ?? "";
					const current = focused && index === activeIndex && value.length < JOIN_CODE_LENGTH;
					return (
						<div
							key={index}
							className={cn(
								"flex aspect-[4/5] items-center justify-center rounded-xl border-2 bg-[var(--deck-surface)] font-mono text-[28px] font-semibold uppercase leading-none transition-colors",
								invalid
									? "border-[var(--deck-danger)]"
									: char
										? "border-[var(--deck-primary)]"
										: current
											? "border-[var(--deck-text-muted)]"
											: "border-[var(--deck-border)]",
								disabled && "opacity-60"
							)}
						>
							{char || (current ? <span className="ms-play-caret h-8 w-0.5 rounded bg-[var(--deck-text)]" /> : "")}
						</div>
					);
				})}
			</div>
		</div>
	);
});
