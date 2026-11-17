"use client";

import type { EditorProps } from "../types";
import { EditorGroup, QuestionField } from "../shared/editorKit";
import { ChoiceOptionsEditor } from "../shared/quizChoice";

// Content tab: the question and the options with a checkbox per correct
// answer. Scoring is ALL OR NOTHING (the hint says so). Time and points are in Settings.

export function PickAnswerMultiEditor({ slide, onChange, onOptionsChange, errors, disabled }: EditorProps<"pick_answer_multi">) {
	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"pick_answer_multi"> title={slide.title} onChange={onChange} errors={errors} disabled={disabled} placeholder="Ask a question…" />
			<EditorGroup title="Answers">
				<ChoiceOptionsEditor slide={slide} api={onOptionsChange} mode="multi" errors={errors} disabled={disabled} />
			</EditorGroup>
		</div>
	);
}
