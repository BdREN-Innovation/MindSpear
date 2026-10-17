// Deterministic sample numbers for the editor canvas previews
// (entry.sampleAggregate). No Math.random: previews must not flicker or
// mismatch on hydration.

const SAMPLE_SEQUENCE = [14, 9, 21, 6, 17, 11, 4, 19, 8, 13, 5, 16];

/** A stable pseudo-random sample count for item `index`. */
export function sampleCount(index: number, salt = 0): number {
	return SAMPLE_SEQUENCE[(index * 7 + salt * 5) % SAMPLE_SEQUENCE.length];
}

/** A fixed ISO time `minutesAgo` before a constant reference instant (stable across renders). */
export function sampleTime(minutesAgo: number): string {
	return new Date(Date.UTC(2026, 0, 1, 12, 0, 0) - minutesAgo * 60_000).toISOString();
}
