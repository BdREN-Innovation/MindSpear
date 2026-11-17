// Join codes (backend JoinCodeGenerator): 6 characters from an alphabet
// without the look-alikes O/0 and I/1. The backend ignores case, spaces and
// dashes; we normalise the same way before checking.
// Codes are unique across products: the product comes from the lookup
// (lookupSessionByCode), never from the code itself.

export const JOIN_CODE_LENGTH = 6;
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const ALPHABET_SET = new Set(JOIN_CODE_ALPHABET);

export interface SanitizedJoinCode {
	/** Upper case, alphabet characters only, at most JOIN_CODE_LENGTH. */
	code: string;
	/** Characters that were dropped (not spaces / dashes), upper-cased. */
	rejected: string[];
}

/** Keep only alphabet characters (upper-cased, spaces and dashes ignored), capped at 6. */
export function sanitizeJoinCode(raw: string): SanitizedJoinCode {
	const rejected: string[] = [];
	let code = "";
	for (const char of raw.toUpperCase()) {
		if (char === " " || char === "-" || /\s/.test(char)) continue;
		if (!ALPHABET_SET.has(char)) {
			rejected.push(char);
			continue;
		}
		if (code.length < JOIN_CODE_LENGTH) code += char;
	}
	return { code, rejected };
}

/** True when `raw` (after trimming, upper-casing and dropping spaces/dashes) is a full code. */
export function isCompleteJoinCode(raw: string): boolean {
	const normalised = raw.trim().toUpperCase().replace(/[\s-]+/g, "");
	return normalised.length === JOIN_CODE_LENGTH && [...normalised].every((char) => ALPHABET_SET.has(char));
}

/** The hint for characters a code can never contain. */
export function rejectedCharactersHint(rejected: string[]): string | null {
	if (rejected.length === 0) return null;
	if (rejected.some((char) => "O0I1".includes(char))) return "Codes never use O, 0, I or 1. Check the code on the screen.";
	return "Codes use only letters and numbers.";
}
