"use client";

import type { EditorProps } from "../types";
import { OptionListEditor, SegmentedField, SelectField } from "../shared";
import { EditorGroup, QuestionField } from "./common";
import { RESULT_LAYOUT_CHOICES } from "./PollResults";

const SUBMIT_MODES = [
	{ value: "instant" as const, label: "Tap to vote" },
	{ value: "confirm" as const, label: "Tap, then submit" },
];

export function PollSingleEditor({ slide, onChange, onOptionsChange, errors, disabled }: EditorProps<"poll_single">) {
	const config = slide.config;
	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"poll_single"> title={slide.title} onChange={onChange} errors={errors} disabled={disabled} />

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

			<EditorGroup title="Voting">
				<SegmentedField
					label="How people vote"
					value={config.submit_mode ?? "instant"}
					options={SUBMIT_MODES}
					onChange={(submit_mode) => onChange({ config: { submit_mode } })}
					hint={
						config.submit_mode === "confirm"
							? "People pick an option and confirm with a Submit button."
							: "A tap on an option sends the vote straight away."
					}
					error={errors?.["config.submit_mode"]}
					disabled={disabled}
				/>
			</EditorGroup>

			<EditorGroup title="Results">
				<SelectField
					label="Chart"
					value={config.result_layout ?? "bars"}
					options={RESULT_LAYOUT_CHOICES}
					onChange={(result_layout) => onChange({ config: { result_layout } })}
					error={errors?.["config.result_layout"]}
					disabled={disabled}
				/>
			</EditorGroup>
		</div>
	);
}
