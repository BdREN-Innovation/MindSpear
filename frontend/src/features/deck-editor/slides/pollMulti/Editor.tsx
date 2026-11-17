"use client";

import type { EditorProps } from "../types";
import { NumberField, OptionListEditor, SelectField } from "../shared";
import { EditorGroup, QuestionField } from "../shared/editorKit";
import { RESULT_LAYOUT_CHOICES, resultLayoutHint } from "../shared/PollResults";
import { MAX_SELECTIONS } from "./limits";

export function PollMultiEditor({ slide, onChange, onOptionsChange, errors, disabled }: EditorProps<"poll_multi">) {
	const config = slide.config;
	const min = config.min_selections ?? 1;
	const max = config.max_selections ?? null;
	const optionCount = slide.options.length;
	const capped = (max ?? optionCount) > optionCount || min > optionCount;

	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"poll_multi"> title={slide.title} onChange={onChange} errors={errors} disabled={disabled} />

			<OptionListEditor
				slide={slide}
				options={onOptionsChange}
				label="Options"
				itemNoun="option"
				labelPlaceholder={(index) => `Option ${index + 1}`}
				allowImages
				errors={errors}
				disabled={disabled}
			/>

			<EditorGroup title="Selections">
				<div className="grid grid-cols-2 gap-3">
					<NumberField
						label="At least"
						value={min}
						min={1}
						max={MAX_SELECTIONS}
						debounceMs={400}
						onChange={(value) => {
							const next = value ?? 1;
							// Keep max ≥ min in the same PATCH, or the backend rejects the pair.
							onChange({
								config: max !== null && max < next ? { min_selections: next, max_selections: next } : { min_selections: next },
							});
						}}
						error={errors?.["config.min_selections"]}
						disabled={disabled}
					/>
					<NumberField
						label="At most"
						value={max}
						min={min}
						max={MAX_SELECTIONS}
						allowEmpty
						placeholder="No limit"
						debounceMs={400}
						onChange={(value) => onChange({ config: { max_selections: value } })}
						error={errors?.["config.max_selections"]}
						disabled={disabled}
					/>
				</div>
				<p className="-mt-2 text-xs text-dark-5 dark:text-dark-6">
					Leave “At most” empty for no limit.
					{capped ? ` With ${optionCount} options, participants can pick at most ${optionCount}.` : ""}
				</p>
			</EditorGroup>

			<EditorGroup title="Results">
				<SelectField
					label="Chart"
					value={config.result_layout ?? "bars"}
					options={RESULT_LAYOUT_CHOICES}
					onChange={(result_layout) => onChange({ config: { result_layout } })}
					hint={resultLayoutHint(config.result_layout, "multi")}
					error={errors?.["config.result_layout"]}
					disabled={disabled}
				/>
			</EditorGroup>
		</div>
	);
}
