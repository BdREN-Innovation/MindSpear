// JSON import file, version 1 (docs/design/quize/DESIGN_HANDOFF.md §5).
// These rules mirror ImportService::fromJson on the server, which checks again on import.

import type { HostImportRowStatus, ImportFileQuestionV1, TimerConfig } from "../types";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_QUESTIONS = 500;
export const MAX_OPTIONS = 10;
const PER_QUESTION = [5, 600] as const;
const TOTAL = [60, 6 * 3600] as const;

export interface JsonProblem {
	message: string;
	line?: number;
	column?: number;
	/** The offending line with a caret under the column. */
	snippet?: string;
}

export interface ParsedImportFile {
	title: string | null;
	/** The file's timer, if it has a valid one. Applied only when the host ticks it. */
	timer: TimerConfig | null;
	timerNote: string | null;
	questions: unknown[];
}

export type ParseResult = { ok: true; file: ParsedImportFile } | { ok: false; problem: JsonProblem };

function locate(text: string, position: number): Pick<JsonProblem, "line" | "column" | "snippet"> {
	const before = text.slice(0, position);
	const line = before.split("\n").length;
	const lineStart = before.lastIndexOf("\n") + 1;
	const column = position - lineStart + 1;
	const lineEnd = text.indexOf("\n", position);
	const lineText = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).replace(/\t/g, " ");
	return { line, column, snippet: `${lineText}\n${" ".repeat(Math.max(0, column - 1))}^` };
}

/** Turns the browser's JSON.parse message into line/column (Chrome, Firefox and Safari word it differently). */
function syntaxProblem(text: string, error: SyntaxError): JsonProblem {
	const msg = error.message;
	const lineCol = /line (\d+) column (\d+)/i.exec(msg);
	if (lineCol) {
		const line = Number(lineCol[1]);
		const column = Number(lineCol[2]);
		const lines = text.split("\n");
		const position = lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0) + column - 1;
		return { message: msg.replace(/^JSON\.parse: /, ""), ...locate(text, position) };
	}
	const pos = /position (\d+)/i.exec(msg);
	if (pos) return { message: msg.replace(/ in JSON at position \d+.*$/, "").replace(/\s*\(line.*$/, ""), ...locate(text, Number(pos[1])) };
	return { message: msg };
}

export function parseImportText(text: string): ParseResult {
	if (!text.trim()) return { ok: false, problem: { message: "The file is empty." } };
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (error) {
		return { ok: false, problem: syntaxProblem(text, error as SyntaxError) };
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return { ok: false, problem: { message: 'The file must be a JSON object with "version" and "questions".' } };
	}
	const file = data as Record<string, unknown>;
	if (file.version !== 1) {
		return { ok: false, problem: { message: `Unsupported "version": ${JSON.stringify(file.version ?? null)}. This importer reads version 1.` } };
	}
	if (!Array.isArray(file.questions) || file.questions.length === 0) {
		return { ok: false, problem: { message: '"questions" must be a list with at least one question.' } };
	}
	if (file.questions.length > MAX_QUESTIONS) {
		return { ok: false, problem: { message: `The file has ${file.questions.length} questions; the limit is ${MAX_QUESTIONS}.` } };
	}

	let timer: TimerConfig | null = null;
	let timerNote: string | null = null;
	const raw = (file.settings as { timer?: { mode?: unknown; seconds?: unknown } } | undefined)?.timer;
	if (raw) {
		const seconds = Number(raw.seconds);
		if (raw.mode === "total" && Number.isInteger(seconds) && seconds >= TOTAL[0] && seconds <= TOTAL[1]) {
			timer = { mode: "total", totalSeconds: seconds };
		} else if (raw.mode === "perQuestion" && Number.isInteger(seconds) && seconds >= PER_QUESTION[0] && seconds <= PER_QUESTION[1]) {
			timer = { mode: "perQuestion", secondsPerQuestion: seconds };
		} else {
			timerNote = "The file's timer setting isn't valid, so it can't be applied.";
		}
	}

	return {
		ok: true,
		file: { title: typeof file.title === "string" ? file.title : null, timer, timerNote, questions: file.questions },
	};
}

export interface RowCheck {
	status: Exclude<HostImportRowStatus, "skipped">;
	messages: string[];
}

const textKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Checks every row. `existing` holds the game's current question texts (only
 * relevant when adding to them); duplicates are a warning, never an error.
 */
export function checkRows(items: unknown[], existing: string[], defaultMarks: number): RowCheck[] {
	const existingKeys = existing.map(textKey);
	const seen = new Map<string, number>();
	return items.map((raw, i) => {
		const messages: string[] = [];
		let status = "ready" as RowCheck["status"];
		const error = (m: string) => {
			status = "error";
			messages.push(m);
		};
		const item = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
		const text = typeof item.text === "string" ? item.text.trim() : "";

		if (item.type === undefined || item.type === null) error('"type" is missing.');
		else if (item.type !== "single_choice") error(`Unknown type "${String(item.type)}". Only "single_choice" is supported.`);
		if (!text) error('"text" is empty.');
		else if (text.length > 2000) error('"text" is longer than 2000 characters.');

		const options = item.options;
		const validOptions = Array.isArray(options) && options.every((o) => typeof o === "string" && o.trim() !== "");
		if (!validOptions) error('"options" must be a list of non-empty strings.');
		else if (options.length < 2) error("Needs at least 2 options.");
		else if (options.length > MAX_OPTIONS) error(`At most ${MAX_OPTIONS} options.`);

		const answer = item.answer;
		if (typeof answer !== "number" || !Number.isInteger(answer)) error('"answer" must be the 0-based index of the correct option.');
		else if (validOptions && (answer < 0 || answer >= options.length)) {
			error(`"answer" is ${answer} but there are only ${options.length} options (0–${options.length - 1}).`);
		}
		for (const field of ["marks", "negative"] as const) {
			const v = item[field];
			if (v !== undefined && v !== null && (typeof v !== "number" || v < 0)) error(`"${field}" must be a number of 0 or more.`);
		}
		const image = item.image;
		if (image !== undefined && image !== null && (typeof image !== "string" || !/^https?:\/\/\S+$/i.test(image))) {
			error('"image" must be a URL or null.');
		}

		if (status !== "error") {
			if (item.marks === undefined || item.marks === null) {
				status = "check";
				messages.push(`No marks — the game default (${defaultMarks}) is used.`);
			}
			const key = textKey(text);
			const dup = existingKeys.indexOf(key);
			if (dup >= 0) {
				status = "check";
				messages.push(`Looks like a duplicate of question ${dup + 1} already in this game.`);
			} else if (seen.has(key)) {
				status = "check";
				messages.push(`Same text as row ${seen.get(key)! + 1} in this file.`);
			}
			if (!seen.has(key)) seen.set(key, i);
		}
		return { status, messages };
	});
}

/** A row as the inline editor works with it (always well-formed). */
export function toEditable(raw: unknown): ImportFileQuestionV1 {
	const item = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const options = Array.isArray(item.options) ? item.options.map((o) => (typeof o === "string" ? o : String(o ?? ""))) : ["", ""];
	while (options.length < 2) options.push("");
	const answer = typeof item.answer === "number" && Number.isInteger(item.answer) && item.answer >= 0 && item.answer < options.length ? item.answer : 0;
	return {
		type: "single_choice",
		text: typeof item.text === "string" ? item.text : "",
		options,
		answer,
		marks: typeof item.marks === "number" ? item.marks : undefined,
		negative: typeof item.negative === "number" ? item.negative : undefined,
		image: typeof item.image === "string" ? item.image : null,
	};
}

export const EXAMPLE_FILE = `{
  "version": 1,
  "title": "OS — Scheduling Drill",
  "settings": { "timer": { "mode": "total", "seconds": 1500 } },
  "questions": [
    {
      "type": "single_choice",
      "text": "What is a context switch?",
      "options": ["Saving and loading CPU state", "Switching users", "Paging to disk", "Changing kernel modules"],
      "answer": 0,
      "marks": 2,
      "negative": 0.5,
      "image": null
    }
  ]
}`;
