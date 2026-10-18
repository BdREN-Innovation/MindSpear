"use client";

import { QUIZ_LIMITS } from "@/features/deck/types";
import type { EditorProps } from "../types";
import { NumberField, OptionListEditor, ToggleField } from "../shared";
import { EditorGroup, QuestionField } from "../shared/editorKit";
import { EditorWarning } from "../shared/quizEditor";
import { codePointLength } from "../shared/quizLabels";
import { cleanWord } from "../shared/text";

// Content tab: the question, 1–5 accepted answers (the option labels, never
// shown to players) and how answers are compared. Matching trims and
// collapses spaces and ignores case unless case-sensitive; no fuzzy match.

export function ShortAnswerEditor({ slide, onChange, onOptionsChange, errors, disabled }: EditorProps<"short_answer">) {
	const config = slide.config;
	const caseSensitive = config.case_sensitive ?? false;
	const maxLength = config.max_length ?? QUIZ_LIMITS.shortAnswerDefaultMaxLength;
	const accepted = slide.options.map((option) => cleanWord(option.label ?? "")).filter(Boolean);
	// Code points, like the server's mb_strlen and the phone's counter.
	const tooLong = accepted.filter((answer) => codePointLength(answer) > maxLength);

	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"short_answer"> title={slide.title} onChange={onChange} errors={errors} disabled={disabled} placeholder="Ask a question…" />

			<EditorGroup title="Accepted answers">
				<OptionListEditor
					slide={slide}
					options={onOptionsChange}
					label="Accepted answers"
					itemNoun="answer"
					labelPlaceholder={(index) => (index === 0 ? "The correct answer" : "Another accepted spelling")}
					hint="Players score when their answer matches one of these exactly (extra spaces don't count). Add other spellings players might use."
					errors={errors}
					disabled={disabled}
				/>
				{accepted.length === 0 ? <EditorWarning>Add an accepted answer — without one, nobody can score on this slide.</EditorWarning> : null}
				{tooLong.length > 0 ? (
					<EditorWarning>
						{tooLong.length === 1 ? "One accepted answer is" : `${tooLong.length} accepted answers are`} longer than the {maxLength}-character answer limit, so players can&apos;t type {tooLong.length === 1 ? "it" : "them"}.
					</EditorWarning>
				) : null}
			</EditorGroup>

			<EditorGroup title="Matching">
				<ToggleField
					label="Case-sensitive"
					description={caseSensitive ? "“Paris” and “paris” are different answers." : "“paris” matches “Paris”."}
					checked={caseSensitive}
					onChange={(case_sensitive) => onChange({ config: { case_sensitive } })}
					error={errors?.["config.case_sensitive"]}
					disabled={disabled}
				/>
				<NumberField
					label="Maximum answer length"
					value={maxLength}
					min={1}
					max={QUIZ_LIMITS.shortAnswerMaxLength}
					suffix="characters"
					debounceMs={500}
					onChange={(value) => onChange({ config: { max_length: value ?? QUIZ_LIMITS.shortAnswerDefaultMaxLength } })}
					error={errors?.["config.max_length"]}
					disabled={disabled}
				/>
				<ToggleField
					label="Hide offensive answers"
					description="Masks bad words in wrong answers on the results screen."
					checked={config.profanity_filter_enabled ?? true}
					onChange={(profanity_filter_enabled) => onChange({ config: { profanity_filter_enabled } })}
					error={errors?.["config.profanity_filter_enabled"]}
					disabled={disabled}
				/>
			</EditorGroup>
		</div>
	);
}
