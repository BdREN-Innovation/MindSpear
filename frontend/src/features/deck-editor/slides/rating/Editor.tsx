"use client";

import type { RatingScale } from "@/features/deck/types";
import type { EditorProps } from "../types";
import { OptionListEditor, SegmentedField, ToggleField } from "../shared";

// rating editor (plan §5.4): the items to rate, the star scale (3 / 5 / 7 /
// 10, RatingSlideType::SCALES) and whether every item must be rated.

const SCALES: RatingScale[] = [3, 5, 7, 10];

export function RatingEditor({ slide, onChange, onOptionsChange, errors, disabled }: EditorProps<"rating">) {
	const scale = slide.config.scale ?? 5;

	return (
		<div className="flex flex-col gap-5">
			<OptionListEditor
				slide={slide}
				options={onOptionsChange}
				label="Items to rate"
				itemNoun="item"
				labelPlaceholder={(index) => `Item ${index + 1}`}
				allowImages
				errors={errors}
				disabled={disabled}
			/>

			<SegmentedField<RatingScale>
				label="Stars"
				value={scale}
				options={SCALES.map((value) => ({ value, label: `${value} ★` }))}
				onChange={(value) => onChange({ config: { scale: value } })}
				hint="How many stars participants choose from."
				error={errors?.["config.scale"]}
				disabled={disabled}
			/>

			<ToggleField
				label="Every item must be rated"
				description="Off: participants can submit after rating at least one item."
				checked={!!slide.config.require_all_items}
				onChange={(checked) => onChange({ config: { require_all_items: checked } })}
				error={errors?.["config.require_all_items"]}
				disabled={disabled}
			/>
		</div>
	);
}
