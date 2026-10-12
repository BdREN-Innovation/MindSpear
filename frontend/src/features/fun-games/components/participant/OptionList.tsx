"use client";

import { useRef, type KeyboardEvent } from "react";
import { Check, CircleDashed, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuestionOption } from "../../types";

/**
 * selected: picked, not sent yet · saved: the server has it (ink) ·
 * dimmed: another option is final, or the question closed ·
 * unsent: picked but time ran out before it was sent.
 */
export type OptionState = "default" | "selected" | "saved" | "dimmed" | "unsent";

const accents = [
	"from-primary to-primary-dark",
	"from-secondary to-secondary-dark",
	"from-accent to-accent-dark",
	"from-slate-900 to-slate-700",
	"from-primary-dark to-secondary-dark",
	"from-accent-dark to-slate-900",
];

const TAGS: Partial<Record<OptionState, string>> = {
	saved: "Saved",
	unsent: "Not submitted",
};

type OptionListProps = {
	options: QuestionOption[];
	/** The option shown as chosen (draft, or the saved answer). */
	checkedId: string | null;
	stateOf: (optionId: string) => OptionState;
	/** No more changes (locked, submitted, time up, saving). */
	readOnly: boolean;
	onSelect: (optionId: string) => void;
	labelledBy: string;
	/** Override the "Saved" tag (per-question mode says "Submitted"). */
	savedLabel?: string;
};

/** Answer options as a radio group: arrow keys move and select, Tab leaves the group. */
export function OptionList({
	options,
	checkedId,
	stateOf,
	readOnly,
	onSelect,
	labelledBy,
	savedLabel,
}: OptionListProps) {
	const refs = useRef<Array<HTMLButtonElement | null>>([]);
	const focusIndex = Math.max(0, options.findIndex((o) => o.id === checkedId));

	const onKeyDown = (event: KeyboardEvent, index: number) => {
		const delta = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
		if (!delta) return;
		event.preventDefault();
		const next = (index + delta + options.length) % options.length;
		refs.current[next]?.focus();
		if (!readOnly) onSelect(options[next].id);
	};

	return (
		<div
			role="radiogroup"
			aria-labelledby={labelledBy}
			aria-readonly={readOnly || undefined}
			className="grid gap-3 sm:grid-cols-2"
		>
			{options.map((option, index) => {
				const state = stateOf(option.id);
				const checked = option.id === checkedId;
				const tag = state === "saved" ? (savedLabel ?? TAGS.saved) : TAGS[state];
				return (
					<button
						key={option.id}
						ref={(el) => {
							refs.current[index] = el;
						}}
						type="button"
						role="radio"
						aria-checked={checked}
						aria-disabled={readOnly || undefined}
						tabIndex={index === focusIndex ? 0 : -1}
						onClick={() => !readOnly && onSelect(option.id)}
						onKeyDown={(event) => onKeyDown(event, index)}
						className={cn(
							"group relative flex min-h-[3.5rem] w-full items-center gap-3 overflow-hidden rounded-lg border p-3 text-left transition",
							"focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30",
							state === "default" &&
								"border-slate-200 bg-white text-slate-900 shadow-sm hover:border-primary/40 hover:shadow-md",
							state === "selected" && "border-2 border-primary bg-primary/10 text-slate-950 shadow-md",
							state === "saved" && "border-2 border-slate-900 bg-slate-900 text-white shadow-md",
							state === "dimmed" && "border-slate-200 bg-white text-slate-900 opacity-55",
							state === "unsent" && "border-2 border-dashed border-urgent bg-urgent-bg text-slate-950",
							readOnly && state !== "dimmed" && "cursor-default",
							readOnly && state === "dimmed" && "cursor-not-allowed",
						)}
					>
						<span
							className={cn("absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b", accents[index % accents.length])}
							aria-hidden
						/>
						<span
							className={cn(
								"flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-sm font-black text-white",
								accents[index % accents.length],
							)}
							aria-hidden
						>
							{String.fromCharCode(65 + (index % 26))}
						</span>
						<span className="min-w-0 flex-1 break-words text-sm font-semibold leading-snug sm:text-base">
							{option.text}
						</span>
						{tag ? (
							<span
								className={cn(
									"flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold",
									state === "saved" ? "bg-white/15 text-white" : "bg-white text-urgent-text",
								)}
							>
								{state === "saved" ? <Lock className="h-3 w-3" aria-hidden /> : <CircleDashed className="h-3 w-3" aria-hidden />}
								{tag}
							</span>
						) : (
							<span
								className={cn(
									"flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
									checked ? "border-primary bg-primary text-white" : "border-slate-300 bg-slate-50 text-transparent",
								)}
								aria-hidden
							>
								<Check className="h-3.5 w-3.5" />
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
