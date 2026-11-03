"use client";

import { useId } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { QUESTION_TYPES } from "../questionTypes";
import { MAX_QUESTIONS, TARGET_NOUN, type GenerationOptions, type GenerationTarget } from "../types";

const fieldClass =
	"w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-secondary focus:ring-2 focus:ring-secondary/20 dark:border-stroke-dark dark:bg-dark-2 dark:text-white";
const labelClass = "mb-1.5 block text-sm font-semibold text-dark dark:text-white";

/** A chosen chip: the MindSpear orchid, soft, so the orange stays with the main action. */
const chipOn = "border-secondary bg-secondary-50 text-secondary-700 dark:border-secondary-400 dark:bg-secondary-900/40 dark:text-secondary-100";
const chipOff =
	"border-stroke bg-white text-dark-4 hover:border-secondary-200 hover:text-dark dark:border-stroke-dark dark:bg-dark-2 dark:text-dark-6 dark:hover:text-white";
const chipBase = "border font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/40";
const linkButton = "text-xs font-semibold text-secondary-600 hover:underline dark:text-secondary-200";

/** Shortcuts under the counter; the counter itself goes from 1 to the max. */
const COUNT_PRESETS = [5, 10, 15, 20];

const DIFFICULTIES = [
	{ value: "Easy", label: "Easy" },
	{ value: "Medium", label: "Medium" },
	{ value: "Hard", label: "Hard" },
	{ value: "Very Hard", label: "Very hard" },
];

const AUDIENCES = [
	{ value: "Generic", label: "General" },
	{ value: "School", label: "School" },
	{ value: "College", label: "College" },
	{ value: "Graduate", label: "Graduate" },
	{ value: "PhD", label: "Ph.D" },
];

interface Props {
	target: GenerationTarget;
	value: GenerationOptions;
	onChange: (value: GenerationOptions) => void;
}

/** Topic, count, types, difficulty, audience and focus for AI generation. */
export function GenerationOptionsForm({ target, value, onChange }: Props) {
	const id = useId();
	const noun = TARGET_NOUN[target];
	const count = value.questionCount;
	const set = <K extends keyof GenerationOptions>(key: K, v: GenerationOptions[K]) => onChange({ ...value, [key]: v });
	const setCount = (next: number) => set("questionCount", Math.max(1, Math.min(MAX_QUESTIONS, Math.round(next) || 1)));
	const types = QUESTION_TYPES[target];
	const chosenTypes = types.filter((type) => value.questionTypes.includes(type.value)).length;
	const toggleType = (type: string) =>
		set("questionTypes", value.questionTypes.includes(type) ? value.questionTypes.filter((t) => t !== type) : [...value.questionTypes, type]);
	const stepClass =
		"flex h-8 w-8 items-center justify-center rounded-full bg-gray-2 text-dark transition hover:bg-secondary-50 hover:text-secondary-600 disabled:pointer-events-none disabled:opacity-40 dark:bg-dark-3 dark:text-white";

	return (
		<div className="space-y-5">
			<div>
				<label htmlFor={`${id}-topic`} className={labelClass}>
					Topic <span className="text-red">*</span>
				</label>
				<input id={`${id}-topic`} value={value.topic} maxLength={200} onChange={(e) => set("topic", e.target.value)} placeholder="e.g. Photosynthesis" className={fieldClass} />
			</div>

			<div>
				<label htmlFor={`${id}-count`} className={labelClass}>
					How many {noun.plural}? <span className="font-normal text-dark-5">(1 to {MAX_QUESTIONS})</span>
				</label>
				<div className="inline-flex items-center gap-1 rounded-full border border-stroke bg-white p-1 focus-within:border-secondary focus-within:ring-2 focus-within:ring-secondary/20 dark:border-stroke-dark dark:bg-dark-2">
					<button type="button" onClick={() => setCount(count - 1)} disabled={count <= 1} aria-label={`One ${noun.singular} fewer`} className={stepClass}>
						<Minus className="h-4 w-4" aria-hidden />
					</button>
					<span className="flex items-baseline gap-1 px-1">
						<input
							id={`${id}-count`}
							type="number"
							inputMode="numeric"
							min={1}
							max={MAX_QUESTIONS}
							value={count}
							// Typing replaces the number instead of adding to it.
							onFocus={(e) => e.target.select()}
							onChange={(e) => setCount(Number(e.target.value))}
							className="w-8 bg-transparent text-center text-lg font-bold tabular-nums text-dark outline-none [appearance:textfield] dark:text-white [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
						/>
						<span className="w-16 text-sm text-dark-5" aria-hidden>
							{count === 1 ? noun.singular : noun.plural}
						</span>
					</span>
					<button type="button" onClick={() => setCount(count + 1)} disabled={count >= MAX_QUESTIONS} aria-label={`One ${noun.singular} more`} className={stepClass}>
						<Plus className="h-4 w-4" aria-hidden />
					</button>
				</div>
				<div className="mt-2.5 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Quick pick: number of ${noun.plural}`}>
					<span className="mr-1 text-xs font-medium text-dark-5" aria-hidden>
						Quick pick:
					</span>
					{COUNT_PRESETS.map((preset) => (
						<button
							key={preset}
							type="button"
							onClick={() => setCount(preset)}
							aria-pressed={count === preset}
							className={cn(chipBase, "h-7 min-w-9 rounded-full px-2.5 text-xs tabular-nums", count === preset ? chipOn : chipOff)}
						>
							{preset}
						</button>
					))}
				</div>
			</div>

			<div role="group" aria-labelledby={`${id}-types`} aria-describedby={`${id}-types-hint`}>
				<div className="mb-1.5 flex items-baseline justify-between gap-2">
					<p id={`${id}-types`} className="text-sm font-semibold text-dark dark:text-white">
						{noun.singular.charAt(0).toUpperCase() + noun.singular.slice(1)} types <span className="text-red">*</span>
					</p>
					<button
						type="button"
						onClick={() => set("questionTypes", chosenTypes === types.length ? [] : types.map((type) => type.value))}
						className={linkButton}
					>
						{chosenTypes === types.length ? "Clear all" : "Choose all"}
					</button>
				</div>
				<p id={`${id}-types-hint`} className={cn("mb-2 text-xs", chosenTypes === 0 ? "font-medium text-red-dark" : "text-dark-5")} aria-live="polite">
					{chosenTypes === 0
						? `Choose at least one kind of ${noun.singular}.`
						: `Tap a type to add or remove it · ${chosenTypes} of ${types.length} chosen`}
				</p>
				<div className="flex flex-wrap gap-2">
					{types.map(({ value: type, label, icon: Icon, hint }) => {
						const on = value.questionTypes.includes(type);
						return (
							<button
								key={type}
								type="button"
								onClick={() => toggleType(type)}
								aria-pressed={on}
								title={hint}
								className={cn(chipBase, "inline-flex h-9 items-center gap-2 rounded-lg pl-2 pr-3 text-xs", on ? chipOn : chipOff)}
							>
								<span
									className={cn(
										"flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition",
										on ? "border-secondary-500 bg-secondary-500 text-white" : "border-gray-4 bg-white dark:border-dark-4 dark:bg-dark-2",
									)}
									aria-hidden
								>
									{on ? <Check className="h-2.5 w-2.5" strokeWidth={4} /> : null}
								</span>
								<Icon className={cn("h-3.5 w-3.5 shrink-0", on ? "text-secondary-500 dark:text-secondary-300" : "text-dark-5")} aria-hidden />
								{label}
							</button>
						);
					})}
				</div>
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div>
					<label htmlFor={`${id}-difficulty`} className={labelClass}>
						Difficulty
					</label>
					<Select inputId={`${id}-difficulty`} value={value.difficulty} options={DIFFICULTIES} onChange={(next) => set("difficulty", next)} />
				</div>
				<div>
					<label htmlFor={`${id}-audience`} className={labelClass}>
						Audience
					</label>
					<Select inputId={`${id}-audience`} value={value.audienceLevel} options={AUDIENCES} onChange={(next) => set("audienceLevel", next)} />
				</div>
			</div>

			<div>
				<label htmlFor={`${id}-focus`} className={labelClass}>
					Focus area <span className="font-normal text-dark-5">(optional)</span>
				</label>
				<input
					id={`${id}-focus`}
					value={value.focusArea}
					maxLength={300}
					onChange={(e) => set("focusArea", e.target.value)}
					placeholder="e.g. definitions and key formulas"
					className={fieldClass}
				/>
			</div>
		</div>
	);
}
