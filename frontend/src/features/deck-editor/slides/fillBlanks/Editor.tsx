"use client";

import { QUIZ_LIMITS, type FillBlankMode, type FillBlankSettings } from "@/features/deck/types";
import { alignBlankSettings, DEFAULT_BLANK, parseSentence } from "@/features/deck/lib/blanks";
import type { EditorProps } from "../types";
import { SegmentedField, ToggleField } from "../shared";
import { EditorGroup, QuestionField } from "../shared/editorKit";
import { SentenceField, WordListField, errorsUnder } from "../shared/blanksEditor";

// Content tab: an optional instruction, the sentence (each missing word in
// [brackets]) and, per blank, how players fill it: type it (with other
// accepted spellings) or choose it from a dropdown (with wrong choices).
// Editing the sentence carries each blank's settings along with its word.

const MODES: { value: FillBlankMode; label: string }[] = [
	{ value: "type", label: "Type it" },
	{ value: "dropdown", label: "Choose from a list" },
];

export function FillBlanksEditor({ slide, onChange, errors, disabled }: EditorProps<"fill_blanks">) {
	const config = slide.config;
	const text = config.text ?? "";
	const stored = config.blanks ?? [];
	const answers = parseSentence(text).answers;
	const settings: FillBlankSettings[] = answers.map((_, index) => ({ ...DEFAULT_BLANK, ...(stored[index] ?? {}) }));
	const caseSensitive = config.case_sensitive ?? false;

	const setText = (next: string) => onChange({ config: { text: next, blanks: alignBlankSettings(text, stored, next) } });
	const setBlank = (index: number, patch: Partial<FillBlankSettings>) =>
		onChange({ config: { blanks: settings.map((setting, i) => (i === index ? { ...setting, ...patch } : setting)) } });

	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"fill_blanks">
				label="Instruction"
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
				placeholder="Fill in the blanks"
				hint="Optional — shown above the sentence."
			/>

			<EditorGroup title="Sentence">
				<SentenceField value={text} onChange={setText} error={errors?.["config.text"]} disabled={disabled} />
			</EditorGroup>

			{answers.length > 0 ? (
				<EditorGroup title="Blanks">
					<ol className="m-0 flex list-none flex-col gap-3 p-0">
						{answers.map((answer, index) => {
							const setting = settings[index];
							return (
								<li key={`${index}-${answer}`} className="flex flex-col gap-3 rounded-lg border border-stroke p-3 dark:border-dark-3">
									<p className="m-0 flex min-w-0 items-center gap-2 text-sm">
										<span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
											{index + 1}
										</span>
										<span className="min-w-0 break-words font-semibold text-dark dark:text-white">{answer}</span>
									</p>
									<SegmentedField<FillBlankMode>
										label={`How players fill blank ${index + 1}`}
										hideLabel
										value={setting.mode}
										options={MODES}
										onChange={(mode) => setBlank(index, { mode })}
										disabled={disabled}
									/>
									{setting.mode === "type" ? (
										<WordListField
											label="Also accept"
											hint="Other spellings that count as right (optional)."
											words={setting.alternatives}
											onChange={(alternatives) => setBlank(index, { alternatives })}
											max={QUIZ_LIMITS.maxBlankAlternatives}
											error={errorsUnder(errors, `config.blanks.${index}.alternatives`)}
											disabled={disabled}
										/>
									) : (
										<WordListField
											label="Wrong choices"
											hint={`Players choose between “${answer}” and these.`}
											words={setting.distractors}
											onChange={(distractors) => setBlank(index, { distractors })}
											max={QUIZ_LIMITS.maxBlankDistractors}
											error={errorsUnder(errors, `config.blanks.${index}.distractors`)}
											disabled={disabled}
										/>
									)}
								</li>
							);
						})}
					</ol>
				</EditorGroup>
			) : null}

			<EditorGroup title="Matching">
				<ToggleField
					label="Case-sensitive"
					description={caseSensitive ? "“Paris” and “paris” are different answers." : "“paris” matches “Paris”."}
					checked={caseSensitive}
					onChange={(case_sensitive) => onChange({ config: { case_sensitive } })}
					error={errors?.["config.case_sensitive"]}
					disabled={disabled}
				/>
			</EditorGroup>
		</div>
	);
}
