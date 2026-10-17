"use client";

import type { ReactNode } from "react";
import { DECK_LIMITS, type SlidePatch, type SlideTypeKey } from "@/features/deck/types";
import { TextField } from "./fields";

// Inspector pieces every live type's Editor shares.

/** The slide question (slides.title ≤ 280), debounced like every inspector field. */
export function QuestionField<K extends SlideTypeKey>({
	title,
	onChange,
	errors,
	disabled,
	placeholder = "Ask your audience something…",
	label = "Question",
	hint,
}: {
	title: string | null;
	onChange: (patch: SlidePatch<K>) => void;
	errors?: Record<string, string[]>;
	disabled?: boolean;
	placeholder?: string;
	label?: string;
	hint?: string;
}) {
	return (
		<TextField
			label={label}
			hint={hint}
			value={title ?? ""}
			onChange={(value) => onChange({ title: value.trim() === "" ? null : value } as SlidePatch<K>)}
			debounceMs={500}
			maxLength={DECK_LIMITS.maxSlideTitle}
			showCount
			placeholder={placeholder}
			error={errors?.title}
			disabled={disabled}
		/>
	);
}

/** A titled group of inspector fields. */
export function EditorGroup({ title, children }: { title: string; children: ReactNode }) {
	return (
		<fieldset className="flex min-w-0 flex-col gap-4 border-0 p-0">
			<legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">{title}</legend>
			{children}
		</fieldset>
	);
}
