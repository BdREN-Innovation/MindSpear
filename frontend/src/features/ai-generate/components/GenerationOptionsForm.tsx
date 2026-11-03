"use client";

import { useId } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { QUESTION_TYPES } from "../questionTypes";
import { MAX_QUESTIONS, TARGET_NOUN, type GenerationOptions, type GenerationTarget } from "../types";

const fieldClass =
	"w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-secondary focus:ring-2 focus:ring-secondary/20 dark:border-stroke-dark dark:bg-dark-2 dark:text-white";
const labelClass = "mb-1.5 block text-sm font-semibold text-dark dark:text-white";

/** A chosen chip: the MindSpear orchid, soft, so the orange stays with the main action. */
const chipOn = "border-secondary-200 bg-secondary-50 text-secondary-600 dark:border-secondary-700 dark:bg-secondary-900/40 dark:text-secondary-200";
const chipOff =
	"border-stroke bg-white text-dark-4 hover:border-secondary-200 hover:text-dark dark:border-stroke-dark dark:bg-dark-2 dark:text-dark-6 dark:hover:text-white";
const chipBase = "rounded-lg border font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/40";

/** One tap for the usual counts; the stepper covers the rest. */
const COUNT_PRESETS = [5, 10, 15, 20];

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
	const toggleType = (type: string) =>
		set("questionTypes", value.questionTypes.includes(type) ? value.questionTypes.filter((t) => t !== type) : [...value.questionTypes, type]);
	const stepClass =
		"flex w-9 items-center justify-center text-dark-4 transition hover:bg-gray-1 hover:text-dark disabled:pointer-events-none disabled:opacity-40 dark:text-dark-6 dark:hover:bg-dark-3 dark:hover:text-white";

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
					Number of {noun.plural} <span className="font-normal text-dark-5">(max {MAX_QUESTIONS})</span>
				</label>
				<div className="flex flex-wrap items-center gap-2">
					<div className="inline-flex h-10 overflow-hidden rounded-lg border border-stroke bg-white focus-within:border-secondary focus-within:ring-2 focus-within:ring-secondary/20 dark:border-stroke-dark dark:bg-dark-2">
						<button type="button" onClick={() => setCount(count - 1)} disabled={count <= 1} aria-label={`Fewer ${noun.plural}`} className={stepClass}>
							<Minus className="h-4 w-4" aria-hidden />
						</button>
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
							className="w-12 border-x border-stroke bg-transparent text-center text-sm font-semibold tabular-nums text-dark outline-none [appearance:textfield] dark:border-stroke-dark dark:text-white [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
						/>
						<button type="button" onClick={() => setCount(count + 1)} disabled={count >= MAX_QUESTIONS} aria-label={`More ${noun.plural}`} className={stepClass}>
							<Plus className="h-4 w-4" aria-hidden />
						</button>
					</div>
					<div className="flex gap-1.5" role="group" aria-label={`Common numbers of ${noun.plural}`}>
						{COUNT_PRESETS.map((preset) => (
							<button
								key={preset}
								type="button"
								onClick={() => setCount(preset)}
								aria-pressed={count === preset}
								className={cn(chipBase, "h-10 min-w-10 px-3 text-sm tabular-nums", count === preset ? chipOn : chipOff)}
							>
								{preset}
							</button>
						))}
					</div>
				</div>
			</div>

			<fieldset>
				<legend className={labelClass}>
					{noun.singular.charAt(0).toUpperCase() + noun.singular.slice(1)} types <span className="text-red">*</span>
				</legend>
				<div className="flex flex-wrap gap-2">
					{QUESTION_TYPES[target].map(({ value: type, label, icon: Icon, hint }) => {
						const on = value.questionTypes.includes(type);
						return (
							<button
								key={type}
								type="button"
								onClick={() => toggleType(type)}
								aria-pressed={on}
								title={hint}
								className={cn(chipBase, "inline-flex h-8 items-center gap-1.5 px-2.5 text-xs", on ? chipOn : chipOff)}
							>
								<Icon className={cn("h-3.5 w-3.5 shrink-0", on ? "text-secondary-500 dark:text-secondary-300" : "text-dark-5")} aria-hidden />
								{label}
							</button>
						);
					})}
				</div>
			</fieldset>

			<div className="grid grid-cols-2 gap-3">
				<div>
					<label htmlFor={`${id}-difficulty`} className={labelClass}>
						Difficulty
					</label>
					<select id={`${id}-difficulty`} value={value.difficulty} onChange={(e) => set("difficulty", e.target.value)} className={fieldClass}>
						<option value="Easy">Easy</option>
						<option value="Medium">Medium</option>
						<option value="Hard">Hard</option>
						<option value="Very Hard">Very hard</option>
					</select>
				</div>
				<div>
					<label htmlFor={`${id}-audience`} className={labelClass}>
						Audience
					</label>
					<select id={`${id}-audience`} value={value.audienceLevel} onChange={(e) => set("audienceLevel", e.target.value)} className={fieldClass}>
						<option value="Generic">General</option>
						<option value="School">School</option>
						<option value="College">College</option>
						<option value="Graduate">Graduate</option>
						<option value="PhD">Ph.D</option>
					</select>
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
