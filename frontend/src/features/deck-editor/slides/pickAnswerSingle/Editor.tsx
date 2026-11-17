"use client";

import type { EditorProps } from "../types";
import { EditorGroup, QuestionField } from "../shared/editorKit";
import { ChoiceOptionsEditor } from "../shared/quizChoice";

// Content tab: the question and the answer options (label + image each),
// with one or more ticked correct. Several ticked: players select them all
// (all or nothing). Time and points are in Settings.

export function PickAnswerSingleEditor({ slide, onChange, onOptionsChange, errors, disabled }: EditorProps<"pick_answer_single">) {
	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"pick_answer_single"> title={slide.title} onChange={onChange} errors={errors} disabled={disabled} placeholder="Ask a question…" />
			<EditorGroup title="Answers">
				<ChoiceOptionsEditor slide={slide} api={onOptionsChange} mode="any" errors={errors} disabled={disabled} />
			</EditorGroup>
		</div>
	);
}
