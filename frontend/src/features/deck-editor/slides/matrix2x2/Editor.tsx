"use client";

import type { AxisLabels } from "@/features/deck/types";
import type { EditorProps } from "../types";
import { TextField } from "../shared";
import { QuestionField } from "../shared/editorKit";
import { MatrixPlane } from "./MatrixPlane";

// matrix_2x2 editor (plan §5.4): the question, the four axis labels (≤ 80 chars each,
// config x_axis / y_axis merge per key) and a small live preview of the
// plane; the canvas shows the full Presenter with sample dots.

const LABEL_MAX = 80;

type AxisKey = "x_axis" | "y_axis";

export function Matrix2x2Editor({ slide, onChange, errors, disabled }: EditorProps<"matrix_2x2">) {
	const xAxis = slide.config.x_axis ?? { low: "", high: "" };
	const yAxis = slide.config.y_axis ?? { low: "", high: "" };

	const field = (axis: AxisKey, end: keyof AxisLabels, label: string, placeholder: string) => {
		const value = (axis === "x_axis" ? xAxis : yAxis)[end] ?? "";
		return (
			<TextField
				label={label}
				value={value}
				placeholder={placeholder}
				maxLength={LABEL_MAX}
				showCount
				debounceMs={300}
				disabled={disabled}
				error={errors?.[`config.${axis}.${end}`] ?? errors?.[`config.${axis}`]}
				onChange={(next) => {
					const labels: Partial<AxisLabels> = end === "low" ? { low: next } : { high: next };
					onChange({ config: axis === "x_axis" ? { x_axis: labels } : { y_axis: labels } });
				}}
			/>
		);
	};

	return (
		<div className="flex flex-col gap-5">
			<QuestionField<"matrix_2x2">
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
				placeholder="Where does each idea sit on effort vs impact?"
			/>

			<fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
				<legend className="mb-2 text-sm font-semibold text-dark dark:text-white">Horizontal axis (X)</legend>
				<div className="grid gap-3 sm:grid-cols-2">
					{field("x_axis", "low", "Left end", "e.g. Low effort")}
					{field("x_axis", "high", "Right end", "e.g. High effort")}
				</div>
			</fieldset>

			<fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
				<legend className="mb-2 text-sm font-semibold text-dark dark:text-white">Vertical axis (Y)</legend>
				<div className="grid gap-3 sm:grid-cols-2">
					{field("y_axis", "low", "Bottom end", "e.g. Low impact")}
					{field("y_axis", "high", "Top end", "e.g. High impact")}
				</div>
			</fieldset>

			<div className="flex flex-col gap-2">
				<span className="text-sm font-medium text-dark dark:text-white">Preview</span>
				<MatrixPlane xAxis={xAxis} yAxis={yAxis} size="mini" placeholders className="w-full" style={{ aspectRatio: "1.6" }} />
				<p className="m-0 text-xs text-dark-5 dark:text-dark-6">Participants drag one dot onto this grid. Leave a label empty to hide it.</p>
			</div>
		</div>
	);
}
