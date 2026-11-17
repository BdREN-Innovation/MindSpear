"use client";

import type { EditorProps } from "../types";
import { OptionListEditor } from "../shared";
import { EditorGroup, QuestionField } from "../shared/editorKit";
import { CorrectMarker, EditorError, EditorWarning, useCorrectMarking } from "../shared/quizEditor";

// Content tab: the statement and its two answers (seeded True / False, which
// authors may rename, e.g. Yes / No or Fact / Myth), one marked correct by
// the radio. Exactly two answers, so there is no add or remove.

const DEFAULT_LABELS = ["True", "False"];

export function TrueFalseEditor({ slide, onChange, onOptionsChange, errors, disabled }: EditorProps<"true_false">) {
	const marking = useCorrectMarking(slide, onOptionsChange, "single");
	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"true_false">
				label="Statement"
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
				placeholder="e.g. Octopuses have three hearts."
			/>
			<EditorGroup title="Answers">
				<div className="flex flex-col gap-2">
					<OptionListEditor
						slide={slide}
						options={onOptionsChange}
						label="Answer options"
						itemNoun="answer"
						labelPlaceholder={(index) => DEFAULT_LABELS[index] ?? `Answer ${index + 1}`}
						hint="Select the circle next to the correct answer. Rename the answers if you like (Yes / No, Fact / Myth)."
						errors={errors}
						disabled={disabled}
						renderRowStart={(option, index) => (
							<CorrectMarker
								mode="single"
								checked={marking.isCorrect(option)}
								onToggle={() => void marking.toggle(option)}
								label={option.label?.trim() || DEFAULT_LABELS[index] || `Answer ${index + 1}`}
								disabled={disabled || marking.busy}
							/>
						)}
					/>
					{marking.error ? <EditorError>{marking.error}</EditorError> : null}
					{marking.correctCount === 0 ? <EditorWarning>Mark which answer is correct — without one, nobody can score on this slide.</EditorWarning> : null}
				</div>
			</EditorGroup>
		</div>
	);
}
