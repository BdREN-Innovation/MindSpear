"use client";

import type { EditorProps } from "../types";
import { OptionListEditor, SegmentedField } from "../shared";

// points_allocation editor (plan §5.4): the options points go to, and the
// budget (preset 50 / 100 / 200; the backend accepts 1..1000, so a value set
// elsewhere, e.g. by bulk import, stays selectable).

const PRESETS = [50, 100, 200];

export function PointsAllocationEditor({ slide, onChange, onOptionsChange, errors, disabled }: EditorProps<"points_allocation">) {
	const total = slide.config.total_points ?? 100;
	const values = PRESETS.includes(total) ? PRESETS : [...PRESETS, total].sort((a, b) => a - b);

	return (
		<div className="flex flex-col gap-5">
			<OptionListEditor
				slide={slide}
				options={onOptionsChange}
				label="Options"
				itemNoun="option"
				labelPlaceholder={(index) => `Option ${index + 1}`}
				errors={errors}
				disabled={disabled}
			/>

			<SegmentedField
				label="Points to distribute"
				value={total}
				options={values.map((value) => ({ value, label: `${value} points` }))}
				onChange={(value) => onChange({ config: { total_points: value } })}
				hint="Each participant splits exactly this many points across the options."
				error={errors?.["config.total_points"]}
				disabled={disabled}
			/>
		</div>
	);
}
