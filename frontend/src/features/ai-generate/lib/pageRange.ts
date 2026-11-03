/**
 * Reads what the user typed into the page box: "1-5, 8", "1,3,5" or "5". Commas,
 * semicolons or spaces separate the entries; a hyphen or dash makes a range, in
 * either order. Returns the numbers that exist, and the entries that matched none.
 */
export function parsePageSelection(input: string, available: number[]): { numbers: number[]; unmatched: string[] } {
	const entries = input
		.replace(/\s*[-–—]\s*/g, "-")
		.split(/[\s,;]+/)
		.filter(Boolean);
	const found = new Set<number>();
	const unmatched: string[] = [];

	for (const entry of entries) {
		const match = /^(\d+)(?:-(\d+))?$/.exec(entry);
		const first = match ? Number(match[1]) : NaN;
		const last = match?.[2] ? Number(match[2]) : first;
		const inRange = available.filter((n) => n >= Math.min(first, last) && n <= Math.max(first, last));
		if (inRange.length === 0) unmatched.push(entry);
		inRange.forEach((n) => found.add(n));
	}

	return { numbers: [...found].sort((a, b) => a - b), unmatched };
}
