/** Route param → plain string; a malformed escape (%E0…) falls back to the raw value instead of throwing. */
export function decodeParam(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
