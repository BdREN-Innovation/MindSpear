"use client";

import type { EditorProps } from "../types";
import { OptionListEditor, ToggleField } from "../shared";
import { EditorGroup, QuestionField } from "../shared/editorKit";

export function RankingEditor({ slide, onChange, onOptionsChange, errors, disabled }: EditorProps<"ranking">) {
	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"ranking">
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
				placeholder="Rank these from most to least important"
			/>

			<OptionListEditor
				slide={slide}
				options={onOptionsChange}
				label="Items"
				itemNoun="item"
				labelPlaceholder={(index) => `Item ${index + 1}`}
				numbered
				errors={errors}
				disabled={disabled}
			/>

			<EditorGroup title="Ranking">
				<ToggleField
					label="Rank every item"
					description={
						slide.config.require_full_ranking === false
							? "Participants may rank only their top choices and leave the rest out."
							: "Participants must place every item before they can submit."
					}
					checked={slide.config.require_full_ranking !== false}
					onChange={(require_full_ranking) => onChange({ config: { require_full_ranking } })}
					error={errors?.["config.require_full_ranking"]}
					disabled={disabled}
				/>
			</EditorGroup>
		</div>
	);
}
