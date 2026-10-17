// Client twins of the backend text cleaning (PollText::stripInvisible,
// WordCloudSlideType::clean, OpenEndedSlideType::clean, LiveQaService
// trimming), so an entry that is only invisible characters is refused here
// instead of coming back as a 422 "cannot be blank".

/**
 * Characters that only hide or disguise text (soft hyphen, ALM, MVS, ZWSP,
 * LRM/RLM, bidi embeddings/overrides/isolates, word joiner and invisible
 * operators, BOM). ZWJ/ZWNJ stay (emoji sequences, Bengali, Persian).
 */
const INVISIBLE = /[\u00AD\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]+/g;
// ZWJ/ZWNJ touching ASCII join nothing. Two passes instead of a lookbehind
// (a lookbehind literal is a syntax error on Safari < 16.4).
const JOINER_AFTER_ASCII = /([\u0000-\u007F])[\u200C\u200D]+/g;
const JOINER_BEFORE_ASCII = /[\u200C\u200D]+(?=[\u0000-\u007F])/g;

export function stripInvisible(text: string): string {
	return text.replace(INVISIBLE, "").replace(JOINER_AFTER_ASCII, "$1").replace(JOINER_BEFORE_ASCII, "");
}

const CONTROL = /[\u0000-\u001F\u007F-\u009F]+/g;
const CONTROL_EXCEPT_NEWLINE_TAB = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/** word_cloud entry: controls → space, invisibles removed, whitespace collapsed, trimmed. */
export function cleanWord(text: string): string {
	return stripInvisible(text.replace(CONTROL, " ")).replace(/\s+/g, " ").trim();
}

/** open_ended response: unified line endings, controls (but \n \t) and invisibles removed, trimmed. */
export function cleanResponse(text: string): string {
	return stripInvisible(text.replace(/\r\n?/g, "\n").replace(CONTROL_EXCEPT_NEWLINE_TAB, "")).trim();
}

/** Q&A question: whitespace, separators and format characters trimmed from both ends. */
export function cleanQuestion(text: string): string {
	return text.replace(/^[\s\p{Z}\p{Cf}]+|[\s\p{Z}\p{Cf}]+$/gu, "");
}
