"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { MAX_QUESTIONS, QUESTION_TYPES, TARGET_NOUN, type GenerationOptions, type GenerationTarget } from "../types";

const fieldClass =
	"w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-stroke-dark dark:bg-dark-2 dark:text-white";
const labelClass = "mb-1 block text-sm font-semibold text-dark dark:text-white";

interface Props {
	target: GenerationTarget;
	value: GenerationOptions;
	onChange: (value: GenerationOptions) => void;
}

/** Topic, count, types, difficulty, audience and focus for AI generation. */
export function GenerationOptionsForm({ target, value, onChange }: Props) {
	const id = useId();
	const noun = TARGET_NOUN[target];
	const set = <K extends keyof GenerationOptions>(key: K, v: GenerationOptions[K]) => onChange({ ...value, [key]: v });
	const toggleType = (type: string) =>
		set("questionTypes", value.questionTypes.includes(type) ? value.questionTypes.filter((t) => t !== type) : [...value.questionTypes, type]);

	return (
		<div className="space-y-4">
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
				<div className="flex items-center gap-3">
					<input
						type="range"
						min={1}
						max={MAX_QUESTIONS}
						value={value.questionCount}
						onChange={(e) => set("questionCount", Number(e.target.value))}
						className="flex-1 accent-primary"
						aria-label={`Number of ${noun.plural}`}
					/>
					<input
						id={`${id}-count`}
						type="number"
						min={1}
						max={MAX_QUESTIONS}
						value={value.questionCount}
						onChange={(e) => set("questionCount", Math.max(1, Math.min(MAX_QUESTIONS, Number(e.target.value) || 1)))}
						className={cn(fieldClass, "w-20 text-center")}
					/>
				</div>
			</div>

			<fieldset>
				<legend className={labelClass}>
					{noun.singular.charAt(0).toUpperCase() + noun.singular.slice(1)} types <span className="text-red">*</span>
				</legend>
				<div className="flex flex-wrap gap-2">
					{QUESTION_TYPES[target].map((type) => {
						const on = value.questionTypes.includes(type.value);
						return (
							<button
								key={type.value}
								type="button"
								onClick={() => toggleType(type.value)}
								aria-pressed={on}
								title={type.hint}
								className={cn(
									"rounded-full border px-3 py-1.5 text-xs font-semibold transition",
									on ? "border-primary bg-primary text-white" : "border-stroke text-dark-4 hover:border-primary/60 dark:border-stroke-dark dark:text-dark-6",
								)}
							>
								{type.label}
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
