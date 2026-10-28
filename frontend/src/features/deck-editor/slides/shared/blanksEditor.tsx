"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { QUIZ_LIMITS } from "@/features/deck/types";
import { parseSentence, splitWords } from "@/features/deck/lib/blanks";
import { CharCount } from "./fields";
import { useDebouncedValue } from "./hooks";
import { EditorWarning } from "./quizEditor";

// Inspector pieces of fill_blanks / drag_drop: the sentence (answers in
// [square brackets], with an "Add blank" button that brackets the selected
// word) and word lists edited as chips.

const inputClass =
	"w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition placeholder:text-dark-6 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-dark-3 dark:bg-dark-2 dark:text-white";

function firstError(error: string[] | string | undefined): string | null {
	if (!error) return null;
	return Array.isArray(error) ? (error[0] ?? null) : error;
}

/** The sentence textarea, debounced; "Add blank" wraps the selection in brackets (or inserts "[answer]"). */
export function SentenceField({
	value,
	onChange,
	error,
	disabled,
	placeholder = "e.g. The sun rises in the [east] and sets in the [west].",
}: {
	value: string;
	onChange: (text: string) => void;
	error?: string[] | string;
	disabled?: boolean;
	placeholder?: string;
}) {
	const id = useId();
	const ref = useRef<HTMLTextAreaElement>(null);
	const { local, setLocal, flush } = useDebouncedValue(value, onChange, 600);
	const message = firstError(error);
	const parsed = parseSentence(local, Number.MAX_SAFE_INTEGER);

	const addBlank = () => {
		const area = ref.current;
		const start = area?.selectionStart ?? local.length;
		const end = area?.selectionEnd ?? local.length;
		const selected = local.slice(start, end);
		const word = selected.trim() === "" ? "answer" : selected.trim();
		const lead = selected.length - selected.trimStart().length;
		const trail = selected.length - selected.trimEnd().length;
		const before = local.slice(0, start) + selected.slice(0, lead);
		const after = (trail > 0 ? selected.slice(selected.length - trail) : "") + local.slice(end);
		const spaceBefore = before !== "" && !/\s$/.test(before) && selected.trim() === "" ? " " : "";
		const next = `${before}${spaceBefore}[${word}]${after}`;
		setLocal(next);
		// Select the answer inside the new brackets so the author can type over it.
		const from = before.length + spaceBefore.length + 1;
		requestAnimationFrame(() => {
			ref.current?.focus();
			ref.current?.setSelectionRange(from, from + word.length);
		});
	};

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-2">
				<label htmlFor={id} className="text-sm font-medium text-dark dark:text-white">
					Sentence
				</label>
				<CharCount length={local.length} max={QUIZ_LIMITS.maxSentenceLength} />
			</div>
			<textarea
				id={id}
				ref={ref}
				value={local}
				rows={4}
				maxLength={QUIZ_LIMITS.maxSentenceLength + 50}
				placeholder={placeholder}
				disabled={disabled}
				aria-invalid={message ? true : undefined}
				aria-describedby={`${id}-hint`}
				onChange={(event) => setLocal(event.target.value)}
				onBlur={flush}
				className={cn(inputClass, "min-h-24 resize-y leading-relaxed", message && "border-red focus-visible:border-red focus-visible:ring-red/30")}
			/>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p id={`${id}-hint`} className="m-0 text-xs text-dark-5 dark:text-dark-6">
					Put each missing word in [square brackets] — select a word and press Add blank.
				</p>
				<button
					type="button"
					onClick={addBlank}
					disabled={disabled || parsed.brackets >= QUIZ_LIMITS.maxBlanks}
					className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-stroke px-3 text-sm font-semibold text-dark transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-3 dark:text-white"
				>
					<Plus className="h-4 w-4" aria-hidden />
					Add blank
				</button>
			</div>
			{message ? (
				<p role="alert" className="m-0 text-sm font-medium text-red">
					{message}
				</p>
			) : parsed.brackets === 0 && local.trim() !== "" ? (
				<EditorWarning>No blanks yet — put the missing word in [square brackets].</EditorWarning>
			) : parsed.brackets > QUIZ_LIMITS.maxBlanks ? (
				<EditorWarning>Use at most {QUIZ_LIMITS.maxBlanks} blanks.</EditorWarning>
			) : null}
		</div>
	);
}

/** Words as removable chips; type one and press Enter or a comma to add it. */
export function WordListField({
	label,
	hint,
	words,
	onChange,
	max,
	placeholder = "Type a word, then Enter",
	error,
	disabled,
}: {
	label: string;
	hint?: string;
	words: readonly string[];
	onChange: (words: string[]) => void;
	max: number;
	placeholder?: string;
	error?: string[] | string;
	disabled?: boolean;
}) {
	const id = useId();
	const [draft, setDraft] = useState("");
	const message = firstError(error);
	const full = words.length >= max;

	const add = (input: string) => {
		const fresh = splitWords(input).filter((word) => !words.includes(word));
		setDraft("");
		if (fresh.length === 0) return;
		onChange([...words, ...fresh].slice(0, max));
	};
	const remove = (index: number) => onChange(words.filter((_, i) => i !== index));

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter" || event.key === ",") {
			event.preventDefault();
			add(draft);
		} else if (event.key === "Backspace" && draft === "" && words.length > 0) {
			remove(words.length - 1);
		}
	};

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-2">
				<label htmlFor={id} className="text-sm font-medium text-dark dark:text-white">
					{label}
				</label>
				<span className="text-xs tabular-nums text-dark-5 dark:text-dark-6">
					{words.length} / {max}
				</span>
			</div>
			<div className={cn(inputClass, "flex min-h-11 flex-wrap items-center gap-1.5 py-1.5", message && "border-red")}>
				{words.map((word, index) => (
					<span key={`${word}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-gray-2 py-0.5 pl-2 pr-1 text-sm font-medium dark:bg-dark-3">
						<span className="min-w-0 break-words">{word}</span>
						<button
							type="button"
							onClick={() => remove(index)}
							disabled={disabled}
							aria-label={`Remove ${word}`}
							className="flex h-6 w-6 items-center justify-center rounded text-dark-5 hover:text-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
						>
							<X className="h-3.5 w-3.5" aria-hidden />
						</button>
					</span>
				))}
				<input
					id={id}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={onKeyDown}
					onBlur={() => draft.trim() !== "" && add(draft)}
					disabled={disabled || full}
					maxLength={QUIZ_LIMITS.maxBlankAnswer * 2}
					placeholder={full ? "" : words.length === 0 ? placeholder : "Add another"}
					aria-describedby={hint ? `${id}-hint` : undefined}
					className="min-w-24 flex-1 border-0 bg-transparent p-1 text-sm outline-none placeholder:text-dark-6"
				/>
			</div>
			{hint ? (
				<p id={`${id}-hint`} className="m-0 text-xs text-dark-5 dark:text-dark-6">
					{hint}
				</p>
			) : null}
			{message ? (
				<p role="alert" className="m-0 text-sm font-medium text-red">
					{message}
				</p>
			) : null}
		</div>
	);
}

/** "config.blanks.2.distractors.0" style errors under `prefix`, flattened to one message. */
export function errorsUnder(errors: Record<string, string[]> | undefined, prefix: string): string[] | undefined {
	if (!errors) return undefined;
	const messages = Object.entries(errors)
		.filter(([key]) => key === prefix || key.startsWith(`${prefix}.`))
		.flatMap(([, value]) => value);
	return messages.length > 0 ? messages : undefined;
}
