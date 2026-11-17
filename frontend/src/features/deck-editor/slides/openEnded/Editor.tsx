"use client";

import type { EditorProps } from "../types";
import { NumberField, ToggleField } from "../shared";
import { EditorGroup, QuestionField } from "../shared/editorKit";

export function OpenEndedEditor({ slide, onChange, errors, disabled }: EditorProps<"open_ended">) {
	const config = slide.config;
	const submissions = config.max_submissions_per_participant ?? 1;

	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"open_ended">
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
				placeholder="What would you like to ask?"
			/>

			<EditorGroup title="Responses">
				<NumberField
					label="Maximum length"
					value={config.max_length ?? 500}
					min={10}
					max={2000}
					debounceMs={400}
					suffix="characters"
					onChange={(value) => onChange({ config: { max_length: value ?? 500 } })}
					error={errors?.["config.max_length"]}
					disabled={disabled}
				/>
				<p className="-mt-2 text-xs text-dark-5 dark:text-dark-6">
					{submissions > 1 ? `Each person can send up to ${submissions} responses.` : "Each person sends one response (they can edit it while voting is open)."}{" "}
					Change this with “Allow multiple submissions” on the Settings tab.
				</p>
				<ToggleField
					label="Filter profanity"
					description="Listed swear words are masked with * on the card wall."
					checked={config.profanity_filter_enabled ?? true}
					onChange={(profanity_filter_enabled) => onChange({ config: { profanity_filter_enabled } })}
					error={errors?.["config.profanity_filter_enabled"]}
					disabled={disabled}
				/>
			</EditorGroup>
		</div>
	);
}
