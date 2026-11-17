"use client";

import { QUIZ_LIMITS } from "@/features/deck/types";
import { dragBank } from "@/features/deck/lib/blanks";
import type { EditorProps } from "../types";
import { EditorGroup, QuestionField } from "../shared/editorKit";
import { SentenceField, WordListField, errorsUnder } from "../shared/blanksEditor";

// Content tab: an optional instruction, the sentence (each missing word in
// [brackets]) and extra wrong words. Players drag words from the bank — the
// bracketed words plus the extras, shuffled — into the blanks.

export function DragDropEditor({ slide, onChange, errors, disabled }: EditorProps<"drag_drop">) {
	const config = slide.config;
	const bank = dragBank(config);
	return (
		<div className="flex flex-col gap-6">
			<QuestionField<"drag_drop">
				label="Instruction"
				title={slide.title}
				onChange={onChange}
				errors={errors}
				disabled={disabled}
				placeholder="Drag the words into the blanks"
				hint="Optional — shown above the sentence."
			/>

			<EditorGroup title="Sentence">
				<SentenceField value={config.text ?? ""} onChange={(text) => onChange({ config: { text } })} error={errors?.["config.text"]} disabled={disabled} />
			</EditorGroup>

			<EditorGroup title="Word bank">
				<WordListField
					label="Extra words"
					hint="Wrong words mixed in with the answers to make it harder (optional)."
					words={config.distractors ?? []}
					onChange={(distractors) => onChange({ config: { distractors } })}
					max={QUIZ_LIMITS.maxDragDistractors}
					error={errorsUnder(errors, "config.distractors")}
					disabled={disabled}
				/>
				{bank.length > 0 ? (
					<div className="flex flex-col gap-1.5">
						<p className="m-0 text-sm font-medium text-dark dark:text-white">Players drag from</p>
						<ul aria-label="Word bank" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
							{bank.map((word, index) => (
								<li key={`${word}-${index}`} className="rounded-md border border-stroke px-2 py-1 text-sm font-medium dark:border-dark-3">
									{word}
								</li>
							))}
						</ul>
						<p className="m-0 text-xs text-dark-5 dark:text-dark-6">Shuffled for every player.</p>
					</div>
				) : null}
			</EditorGroup>
		</div>
	);
}
