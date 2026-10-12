"use client";

import { useId } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuestionSelection } from "../../../types";
import { inputClass } from "../../shared/hostStyles";

type QuestionPoolSelectorProps = {
	/** Questions in the game (the pool). */
	poolSize: number;
	/** null = every player answers all of them. */
	perPlayer: number | null;
	selection: QuestionSelection;
	/** The pool's questions are worth different marks. */
	marksDiffer: boolean;
	onChange: (next: { perPlayer: number | null; selection: QuestionSelection }) => void;
	disabled?: boolean;
};

export function poolError(perPlayer: number | null, poolSize: number): string | null {
	if (perPlayer === null) return null;
	if (!Number.isInteger(perPlayer) || perPlayer < 1) return "Each player needs at least 1 question.";
	if (poolSize > 0 && perPlayer > poolSize) return `The game has only ${poolSize} questions.`;
	return null;
}

/** "Each player answers all / N of the questions" and, for N, same or different questions per player. */
export function QuestionPoolSelector({ poolSize, perPlayer, selection, marksDiffer, onChange, disabled }: QuestionPoolSelectorProps) {
	const id = useId();
	const usingPool = perPlayer !== null;
	const error = poolError(perPlayer, poolSize);
	const drawing = usingPool && !error && perPlayer < poolSize;

	return (
		<fieldset className="space-y-3">
			<legend className="mb-1 text-sm font-semibold text-dark dark:text-white">Questions per player</legend>
			<div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
				<label className="flex items-center gap-2">
					<input
						type="radio"
						name={`${id}-count`}
						checked={!usingPool}
						onChange={() => onChange({ perPlayer: null, selection })}
						disabled={disabled}
					/>
					<span className="text-dark dark:text-white">
						All <span className="font-mono tabular-nums">{poolSize}</span> questions
					</span>
				</label>
				<label className="flex items-center gap-2">
					<input
						type="radio"
						name={`${id}-count`}
						checked={usingPool}
						onChange={() => onChange({ perPlayer: Math.min(10, Math.max(1, poolSize)), selection })}
						disabled={disabled}
					/>
					<span className="text-dark dark:text-white">Random</span>
					<input
						type="number"
						inputMode="numeric"
						min={1}
						max={poolSize || undefined}
						value={perPlayer ?? ""}
						onChange={(e) => onChange({ perPlayer: Math.floor(Number(e.target.value) || 0), selection })}
						onFocus={() => !usingPool && onChange({ perPlayer: Math.min(10, Math.max(1, poolSize)), selection })}
						disabled={disabled}
						aria-label="Questions per player"
						aria-invalid={!!error}
						aria-describedby={`${id}-help`}
						className={`${inputClass} w-20 font-mono tabular-nums`}
					/>
					<span className="text-dark-5">
						of <span className="font-mono tabular-nums">{poolSize}</span>
					</span>
				</label>
			</div>

			{drawing ? (
				<div className="grid gap-2 md:grid-cols-2" role="radiogroup" aria-label="Which questions">
					{(
						[
							["same", "Same questions for everyone", `${perPlayer} questions are drawn at random when the game starts; every player gets those.`],
							["different", "Different questions for each player", `Each player gets their own random ${perPlayer} from the ${poolSize}.`],
						] as const
					).map(([value, title, body]) => (
						<label
							key={value}
							className={cn(
								"flex cursor-pointer items-start gap-3 rounded-lg border p-3",
								selection === value
									? "border-2 border-blue-dark bg-blue-light-5 dark:bg-dark-2"
									: "border-stroke dark:border-stroke-dark",
							)}
						>
							<input
								type="radio"
								name={`${id}-selection`}
								checked={selection === value}
								onChange={() => onChange({ perPlayer, selection: value })}
								disabled={disabled}
								className="mt-1"
							/>
							<span>
								<span className="block text-sm font-semibold text-dark dark:text-white">{title}</span>
								<span className="block text-xs text-dark-5">{body}</span>
							</span>
						</label>
					))}
				</div>
			) : null}

			{drawing && selection === "different" && marksDiffer ? (
				<p className="flex items-start gap-2 rounded-lg border border-urgent/30 bg-urgent-bg px-3 py-2 text-sm text-urgent-text">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
					Questions in the pool are worth different marks — with different questions per player, maximum scores will differ.
				</p>
			) : null}

			<p id={`${id}-help`} className={cn("text-sm", error ? "font-semibold text-red-dark" : "text-dark-5")} aria-live="polite">
				{error ??
					(drawing
						? `Each player answers ${perPlayer} of ${poolSize} questions.`
						: `Each player answers all ${poolSize} question${poolSize === 1 ? "" : "s"}.`)}
			</p>
		</fieldset>
	);
}
