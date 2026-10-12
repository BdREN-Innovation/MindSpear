"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import type { ScoringMode, TimerMode } from "../../../types";

type ScoringSelectorProps = {
	value: ScoringMode;
	onChange: (mode: ScoringMode) => void;
	shuffle: boolean;
	onShuffleChange: (shuffle: boolean) => void;
	timerMode: TimerMode;
	/** For the worked example. */
	secondsPerQuestion: number;
	totalSeconds: number;
	disabled?: boolean;
};

/** Shown under the timer: how answers are scored, with a worked example for the chosen timer. */
export function ScoringSelector({
	value,
	onChange,
	shuffle,
	onShuffleChange,
	timerMode,
	secondsPerQuestion,
	totalSeconds,
	disabled,
}: ScoringSelectorProps) {
	const id = useId();
	const example =
		timerMode === "perQuestion"
			? (() => {
					const T = secondsPerQuestion || 20;
					const fast = Math.round(1000 * (1 - 2 / (2 * T)));
					const slow = Math.round(1000 * (1 - Math.min(T - 1, T) / (2 * T)));
					return `1-mark question, ${T} s: correct after 2 s → ${fast} points, after ${T - 1} s → ${slow}. Wrong → 0.`;
				})()
			: (() => {
					const total = totalSeconds || 600;
					const used = Math.round(total * 0.4);
					const pts = Math.round(8000 * (1 - used / (2 * total)));
					return `8 correct 1-mark answers (8000) with all questions done in ${Math.round(used / 60)} of ${Math.round(
						total / 60,
					)} min → ${pts} points. Running out of time halves the total.`;
				})();

	const option = (mode: ScoringMode, title: string, body: React.ReactNode) => (
		<label
			className={cn(
				"flex cursor-pointer flex-col gap-1 rounded-xl border p-4 transition",
				value === mode ? "border-2 border-blue-dark bg-blue-light-5 dark:bg-dark-2" : "border-stroke hover:border-blue-light-3 dark:border-stroke-dark",
				disabled && "cursor-not-allowed opacity-60",
			)}
		>
			<span className="flex items-center gap-2">
				<input type="radio" name={`${id}-scoring`} checked={value === mode} onChange={() => onChange(mode)} disabled={disabled} />
				<span className="text-sm font-bold text-dark dark:text-white">{title}</span>
			</span>
			<span className="text-xs text-dark-5">{body}</span>
		</label>
	);

	return (
		<div className="space-y-3">
			<fieldset>
				<legend className="mb-2 text-sm font-semibold text-dark dark:text-white">Scoring</legend>
				<div className="grid gap-3 md:grid-cols-2">
					{option("marks", "Marks", "Correct answers earn the question's marks; wrong ones lose its penalty. Ties go to whoever finished faster.")}
					{option(
						"speed",
						"Speed points",
						timerMode === "perQuestion"
							? "Kahoot-style: a correct answer earns up to 1000 points per mark, dropping to half as its timer runs out. No penalty for wrong answers."
							: "A correct answer is worth 1000 points per mark; the total shrinks the longer a player takes for the whole quiz (down to half). No penalty for wrong answers.",
					)}
				</div>
			</fieldset>
			{value === "speed" ? (
				<p className="rounded-lg border border-stroke bg-gray-1 px-3 py-2 text-xs text-dark-4 dark:border-stroke-dark dark:bg-dark-2 dark:text-dark-6">
					Example: {example}
				</p>
			) : null}
			<label className="flex items-start gap-2 text-sm">
				<input type="checkbox" checked={shuffle} onChange={(e) => onShuffleChange(e.target.checked)} disabled={disabled} className="mt-1" />
				<span>
					<span className="font-semibold text-dark dark:text-white">Shuffle question order</span>
					<span className="block text-xs text-dark-5">Each player gets the questions in their own random order.</span>
				</span>
			</label>
		</div>
	);
}
