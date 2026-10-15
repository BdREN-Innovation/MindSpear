"use client";

import type { EditorProps } from "../types";
import { NumberField, ToggleField } from "../shared";
import { EditorGroup, QuestionField } from "../pollSingle/common";

export function WordCloudEditor({ slide, onChange, errors, disabled }: EditorProps<"word_cloud">) {
	const config = slide.config;
	const maxEntries = config.max_entries_per_participant ?? 3;

	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"word_cloud">
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
				placeholder="Describe this topic in one word…"
			/>

			<EditorGroup title="Entries">
				<div className="grid grid-cols-2 gap-3">
					<NumberField
						label="Words per person"
						value={maxEntries}
						min={1}
						max={10}
						debounceMs={400}
						onChange={(value) => onChange({ config: { max_entries_per_participant: value ?? 1 } })}
						error={errors?.["config.max_entries_per_participant"]}
						disabled={disabled}
					/>
					<NumberField
						label="Characters per word"
						value={config.max_entry_length ?? 25}
						min={1}
						max={100}
						debounceMs={400}
						onChange={(value) => onChange({ config: { max_entry_length: value ?? 25 } })}
						error={errors?.["config.max_entry_length"]}
						disabled={disabled}
					/>
				</div>
				<p className="-mt-2 text-xs text-dark-5 dark:text-dark-6">
					{config.allow_multiple_submissions
						? `People can come back and add words until they have sent ${maxEntries}.`
						: `People send up to ${maxEntries} ${maxEntries === 1 ? "word" : "words"} at once.`}{" "}
					“Allow multiple submissions” is on the Settings tab.
				</p>
				<ToggleField
					label="Filter profanity"
					description="Listed swear words are masked with * on the cloud."
					checked={config.profanity_filter_enabled ?? true}
					onChange={(profanity_filter_enabled) => onChange({ config: { profanity_filter_enabled } })}
					error={errors?.["config.profanity_filter_enabled"]}
					disabled={disabled}
				/>
			</EditorGroup>
		</div>
	);
}
