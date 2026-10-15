"use client";

import { useMemo, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParticipantProps } from "../types";
import { haptic, SubmitBar, SubmittedState } from "../shared";
import { useAnswerFlow, useDraft } from "../pinOnImage/answerFlow";

// points_allocation participant (plan §7.3): a slider, −/+ steppers and a
// number box per option; an option can never take more than what is left,
// the bar shows "x / total used", and Submit stays disabled until the sum is
// exactly config.total_points (PointsAllocationSlideType rejects anything
// else). Every option is sent, zeros included.

const FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--deck-focus,#C46620)] focus-visible:ring-offset-[color:var(--deck-bg,#fff)]";

type Allocation = Record<number, number>;

function storedAllocation(value: unknown): Allocation {
	const rows = (value as { allocations?: unknown } | null)?.allocations;
	const result: Allocation = {};
	if (!Array.isArray(rows)) return result;
	for (const row of rows) {
		const { option_id: id, points } = (row ?? {}) as { option_id?: unknown; points?: unknown };
		if (typeof id === "number" && typeof points === "number") result[id] = points;
	}
	return result;
}

function sumOf(values: Allocation, ids: number[]): number {
	return ids.reduce((sum, id) => sum + (values[id] ?? 0), 0);
}

export function PointsAllocationParticipant({ run, mySubmission, onSubmit, disabled, aggregate, mode }: ParticipantProps<"points_allocation">) {
	const total = Math.max(1, run.config.total_points ?? 100);
	const ids = useMemo(() => run.options.map((option) => option.id), [run.options]);
	const stored = useMemo(() => storedAllocation(mySubmission), [mySubmission]);
	const hasStored = Object.keys(stored).length > 0;
	const [values, setValues, markClean] = useDraft<Allocation>(stored, JSON.stringify(stored));
	const flow = useAnswerFlow(onSubmit, hasStored, markClean);
	const [announcement, setAnnouncement] = useState("");
	const review = mode === "review";
	const locked = disabled || flow.busy || review;
	const step = total >= 100 ? 5 : 1;

	const used = sumOf(values, ids);
	const remaining = total - used;

	const setValue = (id: number, next: number) => {
		if (locked) return;
		setValues((current) => {
			const others = sumOf(current, ids) - (current[id] ?? 0);
			const clamped = Math.max(0, Math.min(Math.round(Number.isFinite(next) ? next : 0), total - others));
			if (clamped === (current[id] ?? 0)) return current;
			return { ...current, [id]: clamped };
		});
	};

	const percentOf = (id: number) => aggregate?.options.find((row) => row.option_id === id)?.percentage ?? null;

	if (flow.showSubmitted || review) {
		const shown = flow.showSubmitted ? values : stored;
		const any = Object.keys(shown).length > 0;
		return (
			<SubmittedState
				title={review ? "Your points" : "Your points are in"}
				message={review ? (any ? null : "You didn't share points on this slide.") : "Waiting for the host to continue."}
				onEdit={!review && !disabled ? flow.edit : undefined}
				editLabel="Change my points"
				editHint={!review && !disabled ? "You can change them until voting closes." : undefined}
			>
				{any ? (
					<ul className="m-0 flex list-none flex-col gap-2 p-0 text-left">
						{run.options.map((option, index) => {
							const points = shown[option.id] ?? 0;
							const everyone = percentOf(option.id);
							return (
								<li key={option.id} className="flex flex-col gap-1">
									<div className="flex items-baseline justify-between gap-3 text-sm">
										<span className="min-w-0 break-words font-medium">{option.label?.trim() || `Option ${index + 1}`}</span>
										<span className="shrink-0 tabular-nums" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
											{points} pts{everyone !== null ? ` · everyone ${Math.round(everyone)}%` : ""}
										</span>
									</div>
									<span aria-hidden className="h-2 overflow-hidden rounded-full" style={{ background: "var(--deck-surface-muted, #F3F4F6)" }}>
										<span className="block h-full rounded-full" style={{ width: `${(points / total) * 100}%`, background: "var(--deck-primary, #F79945)" }} />
									</span>
								</li>
							);
						})}
					</ul>
				) : null}
			</SubmittedState>
		);
	}

	const hint =
		remaining === 0 ? (
			<span className="font-semibold" style={{ color: "var(--deck-success, #15803D)" }}>
				{used} / {total} points used. Ready to submit.
			</span>
		) : remaining > 0 ? (
			<span>
				<span className="font-semibold tabular-nums">{used} / {total}</span> points used · {remaining} left
			</span>
		) : (
			<span>
				{used} / {total} points used
			</span>
		);

	return (
		<div className="flex min-h-full w-full flex-col" style={{ color: "var(--deck-text, #111928)" }}>
			<div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-5">
				<div className="flex flex-col gap-1">
					<h2 className="m-0 break-words text-xl font-bold leading-snug">{run.title || "Distribute your points"}</h2>
					<p className="m-0 text-sm" style={{ color: "var(--deck-text-muted, #4B5563)" }}>
						Share exactly {total} points across the options.
					</p>
				</div>

				{/* Budget meter */}
				<div
					role="meter"
					aria-label="Points used"
					aria-valuemin={0}
					aria-valuemax={total}
					aria-valuenow={used}
					aria-valuetext={`${used} of ${total} points used`}
					className="h-2.5 overflow-hidden rounded-full"
					style={{ background: "var(--deck-surface-muted, #F3F4F6)" }}
				>
					<span
						className="block h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none"
						style={{ width: `${Math.min(100, (used / total) * 100)}%`, background: remaining === 0 ? "var(--deck-success, #15803D)" : "var(--deck-primary, #F79945)" }}
					/>
				</div>

				<ul className="m-0 flex list-none flex-col gap-3 p-0">
					{run.options.map((option, index) => {
						const value = values[option.id] ?? 0;
						const label = option.label?.trim() || `Option ${index + 1}`;
						const max = value + Math.max(0, remaining);
						const inputId = `points-${run.id}-${option.id}`;
						return (
							<li
								key={option.id}
								className="flex flex-col gap-2 rounded-xl border-2 p-3"
								style={{
									borderColor: value > 0 ? "var(--deck-primary, #F79945)" : "var(--deck-border, #E5E7EB)",
									background: "var(--deck-surface, #fff)",
								}}
							>
								<div className="flex items-center gap-3">
									<label htmlFor={inputId} className="min-w-0 flex-1 break-words text-base font-semibold leading-snug">
										{label}
									</label>
									<input
										id={inputId}
										type="number"
										inputMode="numeric"
										min={0}
										max={max}
										step={1}
										value={value}
										disabled={locked}
										onChange={(event) => setValue(option.id, Number(event.target.value))}
										onFocus={(event) => event.currentTarget.select()}
										className={cn("h-11 w-20 rounded-lg border px-2 text-center text-base font-semibold tabular-nums disabled:opacity-60", FOCUS_RING)}
										style={{ borderColor: "var(--deck-border, #E5E7EB)", background: "var(--deck-bg, #fff)", color: "var(--deck-text, #111928)" }}
									/>
								</div>
								<div className="flex items-center gap-2">
									<button
										type="button"
										aria-label={`Remove ${step} points from ${label}`}
										disabled={locked || value === 0}
										onClick={() => {
											setValue(option.id, value - step);
											haptic(10);
										}}
										className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40", FOCUS_RING)}
										style={{ background: "var(--deck-surface-muted, #F3F4F6)" }}
									>
										<Minus className="h-5 w-5" aria-hidden />
									</button>
									<input
										type="range"
										min={0}
										max={total}
										step={1}
										value={value}
										disabled={locked}
										aria-label={`${label} points`}
										aria-valuetext={`${value} points`}
										onChange={(event) => setValue(option.id, Number(event.target.value))}
										onPointerUp={() => setAnnouncement(`${label}: ${values[option.id] ?? 0} points. ${Math.max(0, total - sumOf(values, ids))} left.`)}
										className={cn("h-11 min-w-0 flex-1 cursor-pointer rounded-full disabled:cursor-not-allowed", FOCUS_RING)}
										style={{ accentColor: "var(--deck-primary, #F79945)" }}
									/>
									<button
										type="button"
										aria-label={`Add ${step} points to ${label}`}
										disabled={locked || remaining <= 0}
										onClick={() => {
											setValue(option.id, value + step);
											haptic(10);
										}}
										className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40", FOCUS_RING)}
										style={{ background: "var(--deck-surface-muted, #F3F4F6)" }}
									>
										<Plus className="h-5 w-5" aria-hidden />
									</button>
								</div>
							</li>
						);
					})}
				</ul>

				{used > 0 && !locked ? (
					<button
						type="button"
						onClick={() => {
							setValues({});
							setAnnouncement("All points cleared.");
						}}
						className={cn("mx-auto flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold", FOCUS_RING)}
						style={{ color: "var(--deck-text-muted, #4B5563)", background: "var(--deck-surface-muted, #F3F4F6)" }}
					>
						<RotateCcw className="h-4 w-4" aria-hidden />
						Start over
					</button>
				) : null}

				<p className="sr-only" aria-live="polite">
					{announcement}
				</p>
			</div>

			<SubmitBar
				label={flow.editing ? "Update points" : "Submit"}
				onClick={() => void flow.submit({ allocations: ids.map((id) => ({ option_id: id, points: values[id] ?? 0 })) })}
				loading={flow.busy}
				disabled={disabled || review || used !== total || ids.length === 0}
				hint={hint}
				error={flow.errorMessage}
			/>
		</div>
	);
}
