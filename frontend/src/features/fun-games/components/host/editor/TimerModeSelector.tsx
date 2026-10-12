"use client";

import { useId } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSeconds } from "../../../lib/format";
import type { HostTimerSettings, TimerMode } from "../../../types";
import { inputClass } from "../../shared/hostStyles";

export const PER_QUESTION_MIN = 5;
export const PER_QUESTION_MAX = 600;
export const TOTAL_MIN = 60;
export const TOTAL_MAX = 6 * 3600;

export function validateTimer(timer: HostTimerSettings): string | null {
	if (timer.mode === "perQuestion") {
		const s = timer.secondsPerQuestion;
		if (!Number.isInteger(s) || s < PER_QUESTION_MIN || s > PER_QUESTION_MAX) {
			return `Time per question must be between ${PER_QUESTION_MIN} and ${PER_QUESTION_MAX} seconds.`;
		}
		return null;
	}
	const t = timer.totalSeconds;
	if (!Number.isInteger(t) || t < TOTAL_MIN) return "The quiz timer must be at least 1 minute.";
	if (t > TOTAL_MAX) return "The quiz timer can be at most 6 hours.";
	return null;
}

const PRESETS = [10, 20, 30, 45, 60];

type TimerModeSelectorProps = {
	value: HostTimerSettings;
	onChange: (next: HostTimerSettings) => void;
	/** The mode saved on the server, to explain what switching does. */
	savedMode: TimerMode;
	questionCount: number;
	/** Per-question overrides currently set, for the summary. */
	overrides: number[];
	disabled?: boolean;
};

function splitHms(total: number) {
	return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

export function TimerModeSelector({ value, onChange, savedMode, questionCount, overrides, disabled }: TimerModeSelectorProps) {
	const id = useId();
	const error = validateTimer(value);
	const hms = splitHms(value.totalSeconds);
	const setHms = (part: "h" | "m" | "s", raw: string) => {
		const n = Math.max(0, Math.floor(Number(raw) || 0));
		const next = { ...hms, [part]: n };
		onChange({ ...value, totalSeconds: next.h * 3600 + next.m * 60 + next.s });
	};

	const perQuestionTotal =
		questionCount > 0
			? overrides.reduce((sum, s) => sum + s, 0) + (questionCount - overrides.length) * value.secondsPerQuestion
			: 0;
	const summary =
		questionCount === 0
			? "Add questions to see how long the game runs."
			: value.mode === "perQuestion"
				? `${questionCount} question${questionCount === 1 ? "" : "s"} · ${formatSeconds(value.secondsPerQuestion)} each${
						overrides.length ? ` (${overrides.length} with their own time)` : ""
					} · about ${formatSeconds(perQuestionTotal)} in all, plus short pauses between questions.`
				: `${formatSeconds(value.totalSeconds)} for ${questionCount} question${questionCount === 1 ? "" : "s"} · about ${formatSeconds(
						Math.max(1, Math.round(value.totalSeconds / questionCount)),
					)} per question.`;

	const card = (mode: TimerMode, title: string, body: string, diagram: React.ReactNode) => (
		<label
			className={cn(
				"flex cursor-pointer flex-col gap-2 rounded-xl border p-4 transition",
				value.mode === mode
					? "border-2 border-blue-dark bg-blue-light-5 dark:bg-dark-2"
					: "border-stroke hover:border-blue-light-3 dark:border-stroke-dark",
				disabled && "cursor-not-allowed opacity-60",
			)}
		>
			<span className="flex items-center gap-2">
				<input
					type="radio"
					name={`${id}-mode`}
					checked={value.mode === mode}
					onChange={() => onChange({ ...value, mode })}
					disabled={disabled}
				/>
				<span className="text-sm font-bold text-dark dark:text-white">{title}</span>
			</span>
			<span className="text-xs text-dark-5">{body}</span>
			<span aria-hidden className="mt-1 flex gap-1">
				{diagram}
			</span>
		</label>
	);

	return (
		<div className="space-y-4">
			<fieldset>
				<legend className="sr-only">Timer mode</legend>
				<div className="grid gap-3 md:grid-cols-2">
					{card(
						"total",
						"Total quiz timer",
						"One countdown for the whole quiz. Each player answers the questions one at a time and finishes when they're done or time runs out.",
						<span className="h-2 flex-1 rounded-full bg-primary" />,
					)}
					{card(
						"perQuestion",
						"Per-question timer",
						"Each question has its own countdown. Players answer one at a time at their own pace; an unanswered question moves on when its time runs out.",
						[0, 1, 2, 3, 4].map((i) => <span key={i} className="h-2 flex-1 rounded-full bg-primary" />),
					)}
				</div>
			</fieldset>

			{value.mode !== savedMode ? (
				<p className="flex items-start gap-2 rounded-lg border border-blue-light-4 bg-blue-light-5 px-3 py-2 text-sm text-blue-dark">
					<Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
					Switching modes doesn&apos;t convert the time — each mode keeps its own setting. Check the value below, then save.
				</p>
			) : null}

			{value.mode === "total" ? (
				<div className="space-y-3">
					<fieldset>
						<legend className="mb-1 text-sm font-semibold text-dark dark:text-white">Quiz duration</legend>
						<div className="flex flex-wrap items-center gap-2">
							{(["h", "m", "s"] as const).map((part) => (
								<label key={part} className="flex items-center gap-1 text-sm text-dark-5">
									<input
										type="number"
										inputMode="numeric"
										min={0}
										max={part === "h" ? 6 : 59}
										value={hms[part]}
										onChange={(e) => setHms(part, e.target.value)}
										disabled={disabled}
										aria-invalid={!!error}
										aria-describedby={`${id}-help`}
										className={`${inputClass} w-20 font-mono tabular-nums`}
									/>
									{part === "h" ? "hours" : part === "m" ? "minutes" : "seconds"}
								</label>
							))}
						</div>
					</fieldset>
				</div>
			) : (
				<div className="space-y-2">
					<label htmlFor={`${id}-pq`} className="text-sm font-semibold text-dark dark:text-white">
						Time per question
					</label>
					<div className="flex flex-wrap items-center gap-2">
						<input
							id={`${id}-pq`}
							type="number"
							inputMode="numeric"
							min={PER_QUESTION_MIN}
							max={PER_QUESTION_MAX}
							value={value.secondsPerQuestion}
							onChange={(e) => onChange({ ...value, secondsPerQuestion: Math.floor(Number(e.target.value) || 0) })}
							disabled={disabled}
							aria-invalid={!!error}
							aria-describedby={`${id}-help`}
							className={`${inputClass} w-24 font-mono tabular-nums`}
						/>
						<span className="text-sm text-dark-5">seconds</span>
						<span className="ml-2 flex flex-wrap gap-1" role="group" aria-label="Quick picks">
							{PRESETS.map((s) => (
								<button
									key={s}
									type="button"
									onClick={() => onChange({ ...value, secondsPerQuestion: s })}
									disabled={disabled}
									aria-pressed={value.secondsPerQuestion === s}
									className={cn(
										"h-8 rounded-md border px-2 font-mono text-xs tabular-nums",
										value.secondsPerQuestion === s
											? "border-blue-dark bg-blue-light-5 text-blue-dark dark:bg-dark-2"
											: "border-stroke text-dark-4 hover:bg-gray-2 dark:border-stroke-dark dark:text-dark-6",
									)}
								>
									{s}s
								</button>
							))}
						</span>
					</div>
					<p className="text-xs text-dark-5">
						Give calculation-heavy questions more time with “Own time” in the question editor.
					</p>
				</div>
			)}

			<p id={`${id}-help`} className={cn("text-sm", error ? "font-semibold text-red-dark" : "text-dark-4 dark:text-dark-6")} aria-live="polite">
				{error ?? summary}
			</p>
		</div>
	);
}
