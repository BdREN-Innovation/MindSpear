"use client";

import type { EditorProps } from "../types";
import { OptionListEditor } from "../shared";
import { EditorGroup, QuestionField } from "../shared/editorKit";

// Content tab: the question and 3–8 items in the CORRECT order (top = first;
// drag to reorder). Players get them shuffled. Time and points are in Settings.

export function CorrectOrderEditor({ slide, onChange, onOptionsChange, errors, disabled }: EditorProps<"correct_order">) {
	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"correct_order"> title={slide.title} onChange={onChange} errors={errors} disabled={disabled} placeholder="e.g. Order these planets from the Sun" />
			<EditorGroup title="Correct order">
				<OptionListEditor
					slide={slide}
					options={onOptionsChange}
					label="Items, in the correct order"
					itemNoun="item"
					labelPlaceholder={(index) => `Item ${index + 1}`}
					hint="Enter the items in the right order (top = first) — drag to reorder. Players see them shuffled; each item in its correct place earns part of the points."
					numbered
					allowImages
					errors={errors}
					disabled={disabled}
				/>
			</EditorGroup>
		</div>
	);
}
