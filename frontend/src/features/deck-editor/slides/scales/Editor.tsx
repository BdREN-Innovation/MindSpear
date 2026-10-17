"use client";

import { useRef } from "react";
import type { EditorProps } from "../types";
import { OptionListEditor, SelectField, TextField, ToggleField } from "../shared";
import { EditorGroup, QuestionField } from "../shared/editorKit";
import { MAX_SCALE_LABEL, MAX_SCALE_POINTS, MIN_SCALE_POINTS, clampPoints, fitLabels } from "./scale";

const POINT_CHOICES = Array.from({ length: MAX_SCALE_POINTS - MIN_SCALE_POINTS + 1 }, (_, index) => {
	const value = MIN_SCALE_POINTS + index;
	return { value, label: `${value} points` };
});

export function ScalesEditor({ slide, onChange, onOptionsChange, errors, disabled }: EditorProps<"scales">) {
	const points = clampPoints(slide.config.scale_points);
	const labels = fitLabels(slide.config.scale_labels, points);

	const labelError = (index: number) =>
		errors?.[`config.scale_labels.${index}`] ?? (index === 0 ? errors?.["config.scale_labels"] : undefined);

	// Every patch carries scale_points with labels of exactly that length (the
	// backend 422s a mismatch, and the shell merges queued patches, so a label
	// typed just before a points change must not resend the old length).
	// Label fields commit after a debounce, possibly from a stale render, so
	// they read the current points / labels from a ref.
	const current = useRef({ points, labels });
	current.current = { points, labels };

	const setPoints = (next: number) => {
		const scale_points = clampPoints(next);
		onChange({ config: { scale_points, scale_labels: fitLabels(current.current.labels, scale_points) } });
	};

	/** `forPoints`: the point count the field was rendered for; a middle label typed for an old count is dropped. */
	const setLabel = (index: number | "high", value: string, forPoints?: number) => {
		const { points: now, labels: list } = current.current;
		if (forPoints !== undefined && forPoints !== now) return;
		const at = index === "high" ? now - 1 : index;
		if (at < 0 || at >= now) return;
		const next = list.slice();
		next[at] = value.trim() === "" ? null : value;
		onChange({ config: { scale_points: now, scale_labels: next } });
	};

	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"scales">
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
				placeholder="How much do you agree with these statements?"
			/>

			<OptionListEditor
				slide={slide}
				options={onOptionsChange}
				label="Statements"
				itemNoun="statement"
				labelPlaceholder={(index) => `Statement ${index + 1}`}
				errors={errors}
				disabled={disabled}
			/>

			<EditorGroup title="Scale">
				<SelectField
					label="Number of points"
					value={points}
					options={POINT_CHOICES}
					// With the labels resized the way the backend would (end labels kept, middle ones blanked).
					onChange={setPoints}
					error={errors?.["config.scale_points"]}
					disabled={disabled}
				/>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<TextField
						label="Label for 1 (low end)"
						value={labels[0] ?? ""}
						onChange={(value) => setLabel(0, value)}
						debounceMs={500}
						maxLength={MAX_SCALE_LABEL}
						placeholder="Strongly disagree"
						error={labelError(0)}
						disabled={disabled}
					/>
					<TextField
						label={`Label for ${points} (high end)`}
						value={labels[points - 1] ?? ""}
						onChange={(value) => setLabel("high", value)}
						debounceMs={500}
						maxLength={MAX_SCALE_LABEL}
						placeholder="Strongly agree"
						error={labelError(points - 1)}
						disabled={disabled}
					/>
				</div>
				{points > 2 ? (
					<details className="group rounded-lg border border-stroke px-3 py-2 dark:border-dark-3">
						<summary className="min-h-9 cursor-pointer select-none py-1 text-sm font-medium text-dark outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:text-white">
							Middle labels (optional)
						</summary>
						<div className="mt-2 flex flex-col gap-3">
							{labels.slice(1, -1).map((label, offset) => {
								const index = offset + 1;
								return (
									<TextField
										key={`${points}-${index}`}
										label={`Label for ${index + 1}`}
										value={label ?? ""}
										onChange={(value) => setLabel(index, value, points)}
										debounceMs={500}
										maxLength={MAX_SCALE_LABEL}
										placeholder="No label"
										error={labelError(index)}
										disabled={disabled}
									/>
								);
							})}
						</div>
					</details>
				) : null}
				<ToggleField
					label="Require every statement"
					description="Participants must rate all statements before they can submit."
					checked={slide.config.require_all_statements === true}
					onChange={(require_all_statements) => onChange({ config: { require_all_statements } })}
					error={errors?.["config.require_all_statements"]}
					disabled={disabled}
				/>
			</EditorGroup>
		</div>
	);
}
