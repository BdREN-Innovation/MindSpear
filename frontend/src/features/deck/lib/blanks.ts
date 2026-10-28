import {
	QUIZ_LIMITS,
	type DragDropConfig,
	type FillBlankSettings,
	type FillBlanksConfig,
	type PublicBlank,
	type SentencePart,
	type SentenceRunConfig,
} from "../types";
import { cleanWord } from "./text";

// Client twin of the backend BlankText + AbstractBlanksType (fill_blanks /
// drag_drop): the sentence is plain text where each [bracketed] word is a
// blank and its answer. Empty, nested or multi-line brackets stay text.
// The editor preview builds the same public view a run gets from these.

const BRACKET = /\[([^[\]\n]*)\]/g;

export interface ParsedSentence {
	parts: SentencePart[];
	/** Each blank's answer (cleaned), in reading order. */
	answers: string[];
	/** Every bracketed answer, also the ones past `max` that stayed text. */
	brackets: number;
}

export function parseSentence(text: string, max: number = QUIZ_LIMITS.maxBlanks): ParsedSentence {
	const parts: SentencePart[] = [];
	const answers: string[] = [];
	let buffer = "";
	let offset = 0;
	let brackets = 0;

	for (const match of text.matchAll(BRACKET)) {
		const start = match.index ?? 0;
		buffer += text.slice(offset, start);
		offset = start + match[0].length;

		const answer = cleanWord(match[1]);
		if (answer !== "") brackets++;
		if (answer === "" || answers.length >= max) {
			buffer += match[0];
			continue;
		}
		if (buffer !== "") parts.push({ text: buffer });
		buffer = "";
		parts.push({ blank: answers.length });
		answers.push(answer);
	}

	buffer += text.slice(offset);
	if (buffer !== "") parts.push({ text: buffer });
	return { parts, answers, brackets };
}

/** Cleaned, non-empty, exact repeats dropped (BlankText::words). */
export function cleanWords(values: readonly unknown[] | null | undefined): string[] {
	const words: string[] = [];
	for (const value of values ?? []) {
		const word = typeof value === "string" ? cleanWord(value) : "";
		if (word !== "" && !words.includes(word)) words.push(word);
	}
	return words;
}

/** "a, b ,c" → ["a", "b", "c"] for the comma-separated word fields. */
export function splitWords(input: string): string[] {
	return cleanWords(input.split(","));
}

/** Comparison form of a typed answer (ShortAnswerSlideType::normalise). */
export function compareForm(value: string, caseSensitive: boolean): string {
	const clean = cleanWord(value).normalize("NFC");
	return caseSensitive ? clean : clean.toLocaleLowerCase();
}

export const DEFAULT_BLANK: FillBlankSettings = { mode: "type", alternatives: [], distractors: [] };

/**
 * fill_blanks settings for the blanks of `nextText`, carried over from the
 * blanks of `prevText`: a blank keeps the settings of the old blank with the
 * same answer (first unused), else of the old blank at its index (an answer
 * edited in place), else the defaults.
 */
export function alignBlankSettings(prevText: string, prevBlanks: readonly FillBlankSettings[], nextText: string): FillBlankSettings[] {
	const before = parseSentence(prevText).answers;
	const after = parseSentence(nextText).answers;
	const used = new Set<number>();
	const settingAt = (index: number) => ({ ...DEFAULT_BLANK, ...(prevBlanks[index] ?? {}) });

	const matched = after.map((answer) => {
		const index = before.findIndex((old, i) => old === answer && !used.has(i));
		if (index === -1) return null;
		used.add(index);
		return settingAt(index);
	});

	return matched.map((setting, index) => {
		if (setting) return setting;
		if (index < before.length && !used.has(index)) {
			used.add(index);
			return settingAt(index);
		}
		return { ...DEFAULT_BLANK };
	});
}

/** A stable stand-in shuffle for the editor preview (the server orders by a per-run HMAC). */
function previewOrder(values: string[], seed: string): string[] {
	const rank = (value: string, index: number) => {
		let hash = 2166136261;
		for (const char of `${seed}:${index}:${value}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
		return hash >>> 0;
	};
	return values.map((value, index) => ({ value, key: rank(value, index) })).sort((a, b) => a.key - b.key).map((row) => row.value);
}

/** The choices of a dropdown blank: its answer plus the wrong choices that differ from it. */
export function dropdownChoices(answer: string, setting: Partial<FillBlankSettings> | undefined, caseSensitive: boolean): string[] {
	const wrong = cleanWords(setting?.distractors)
		.slice(0, QUIZ_LIMITS.maxBlankDistractors)
		.filter((word) => compareForm(word, caseSensitive) !== compareForm(answer, caseSensitive));
	return [answer, ...wrong];
}

/** What a fill_blanks run shows participants, built from the authoring config (editor preview). */
export function fillBlanksPublicConfig(config: Partial<FillBlanksConfig>): SentenceRunConfig & { case_sensitive: boolean } {
	const caseSensitive = config.case_sensitive ?? false;
	const { parts, answers } = parseSentence(config.text ?? "");
	const blanks: PublicBlank[] = answers.map((answer, index) => {
		const setting = config.blanks?.[index];
		return setting?.mode === "dropdown"
			? { mode: "dropdown", choices: previewOrder(dropdownChoices(answer, setting, caseSensitive), `blank:${index}`) }
			: { mode: "type" };
	});
	return { parts, blanks, case_sensitive: caseSensitive };
}

/** The drag_drop word bank: every blank's answer, then the extra words that are not answers. */
export function dragBank(config: Partial<DragDropConfig>): string[] {
	const answers = parseSentence(config.text ?? "").answers;
	const extra = cleanWords(config.distractors)
		.slice(0, QUIZ_LIMITS.maxDragDistractors)
		.filter((word) => !answers.includes(word));
	return [...answers, ...extra];
}

/** What a drag_drop run shows participants (editor preview): the parts and one drop blank each; the bank goes in options. */
export function dragDropPublicConfig(config: Partial<DragDropConfig>): SentenceRunConfig & { bank: string[] } {
	const { parts, answers } = parseSentence(config.text ?? "");
	return { parts, blanks: answers.map(() => ({ mode: "drop" as const })), bank: previewOrder(dragBank(config), "bank") };
}

/** The blank indexes of a run's sentence, in reading order. */
export function blankCount(parts: readonly SentencePart[] | null | undefined): number {
	return (parts ?? []).filter((part) => "blank" in part).length;
}
